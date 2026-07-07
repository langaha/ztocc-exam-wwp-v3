import { NextResponse } from "next/server";
import { ensureDb, getDbClient, withTx } from "@/lib/db";
import { getSessionUserFromRequest } from "@/lib/auth";
import { callV2Json, isV2NetworkFailure } from "@/lib/v2Client";
import { fetchAndUpsertWaybillSnapshot } from "@/lib/waybillSnapshot";
import { addHoursISO, addMinutesISO, calcApprovalLevel, createOrRefreshInventoryLock, isTerminalTicketStatus, pickApprover } from "@/lib/ticketService";

type QcRuleRow = {
  id: string;
  subtype: string;
  severity: number;
  conditionJson: unknown;
  decisionJson: unknown;
};

type QcRuleCondition = {
  kind?: string;
  gte?: number;
};

type QcRuleDecision = {
  result?: string;
  targetLevel?: number;
};

type ValidateSkuResult = {
  ok?: boolean;
  reason?: string;
};

type WaybillItem = {
  skuCode: string;
  skuQuantity: number;
};

function toWaybillLookupError(externalCode: string, res: { requestId: string; status: number | null; errorMessage: string }) {
  if (res.status === 404) {
    return { error: `未查询到${externalCode}的运单`, requestId: res.requestId, status: 404 };
  }
  if (isV2NetworkFailure({ ok: false, requestId: res.requestId, status: res.status, durationMs: 0, errorMessage: res.errorMessage })) {
    return { error: "网络请求失败", requestId: res.requestId, status: 502 };
  }
  return { error: "V2请求失败", requestId: res.requestId, status: 502 };
}

function calcQtyDiffRatio(scanned: number, expected: number) {
  if (!Number.isFinite(scanned) || !Number.isFinite(expected) || expected <= 0) return 0;
  return Math.abs(scanned - expected) / expected;
}

function evalRule(rule: QcRuleRow, ctx: { scannedQty: number; expectedQty: number }) {
  const cond = (rule.conditionJson ?? {}) as QcRuleCondition;
  const decision = (rule.decisionJson ?? {}) as QcRuleDecision;
  const kind = String(cond?.kind ?? "");

  if (kind === "qty_diff_ratio") {
    const gte = Number(cond?.gte ?? NaN);
    const ratio = calcQtyDiffRatio(ctx.scannedQty, ctx.expectedQty);
    if (Number.isFinite(gte) && ratio >= gte) {
      return {
        matched: true,
        result: String(decision?.result ?? "HOLD"),
        targetLevel: Number(decision?.targetLevel ?? 1) || 1,
        reason: `qty_diff_ratio=${ratio.toFixed(4)} >= ${gte}`,
      };
    }
  }

  return { matched: false as const };
}

export async function POST(req: Request) {
  await ensureDb();
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.enabled) return NextResponse.json({ error: "user disabled" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { externalCode?: unknown; skuCode?: unknown; scannedQty?: unknown; claimAmount?: unknown }
    | null;
  const externalCode = String(body?.externalCode ?? "").trim();
  const skuCode = String(body?.skuCode ?? "").trim();
  const scannedQty = Number(body?.scannedQty ?? NaN);
  const claimAmount = Number(body?.claimAmount ?? 0);

  if (!externalCode || !skuCode || !Number.isFinite(scannedQty) || scannedQty <= 0) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  await fetchAndUpsertWaybillSnapshot(externalCode);

  const validateRes = await callV2Json<ValidateSkuResult>({
    apiName: "waybills.validateSku",
    method: "POST",
    path: `/api/v3-bridge/waybills/validate-sku`,
    body: { externalCode, skuCode },
    requestSummary: JSON.stringify({ externalCode, skuCode }),
  });

  if (!validateRes.ok) {
    const err = toWaybillLookupError(externalCode, validateRes);
    return NextResponse.json({ error: err.error, requestId: err.requestId }, { status: err.status });
  }
  if (!validateRes.data.ok) {
    const reason = String(validateRes.data.reason ?? "").trim();
    if (reason.toLowerCase().includes("waybill")) {
      return NextResponse.json({ error: `未查询到${externalCode}的运单`, requestId: validateRes.requestId }, { status: 404 });
    }
    return NextResponse.json({ error: "未查询到该运单下的SKU", reason }, { status: 400 });
  }

  const itemsRes = await callV2Json<{ items?: WaybillItem[] }>({
    apiName: "waybills.items",
    method: "GET",
    path: `/api/v3-bridge/waybills/${encodeURIComponent(externalCode)}/items`,
    requestSummary: JSON.stringify({ externalCode }),
  });

  if (!itemsRes.ok) {
    const err = toWaybillLookupError(externalCode, itemsRes);
    return NextResponse.json({ error: err.error, requestId: err.requestId }, { status: err.status });
  }

  const items = Array.isArray(itemsRes.data.items) ? itemsRes.data.items : [];
  const matched = items.find((it) => String(it?.skuCode ?? "").trim() === skuCode);
  const expectedQty = Number(matched?.skuQuantity ?? NaN);

  const db = getDbClient();
  const ruleRes = await db.execute(
    `SELECT id, subtype, severity, condition_json, decision_json FROM v3_qc_rules WHERE enabled = 1 ORDER BY severity DESC, updated_at DESC`
  );
  const rules: QcRuleRow[] = ruleRes.rows.map((r) => {
    const row = r as { id?: unknown; subtype?: unknown; severity?: unknown; condition_json?: unknown; decision_json?: unknown };
    let conditionJson: unknown = null;
    let decisionJson: unknown = null;
    try {
      conditionJson = JSON.parse(String(row.condition_json ?? "null"));
    } catch {
      conditionJson = null;
    }
    try {
      decisionJson = JSON.parse(String(row.decision_json ?? "null"));
    } catch {
      decisionJson = null;
    }
    return {
      id: String(row.id ?? ""),
      subtype: String(row.subtype ?? ""),
      severity: Number(row.severity ?? 0),
      conditionJson,
      decisionJson,
    };
  });

  let result: "PASS" | "HOLD" = "PASS";
  let matchedRuleId: string | null = null;
  let ruleReason: string | null = null;
  let ticketTargetLevel: 1 | 2 = 1;

  for (const rule of rules) {
    const ev = evalRule(rule, { scannedQty, expectedQty: Number.isFinite(expectedQty) ? expectedQty : 0 });
    if (ev.matched) {
      result = ev.result === "PASS" ? "PASS" : "HOLD";
      matchedRuleId = rule.id;
      ruleReason = ev.reason;
      ticketTargetLevel = ev.targetLevel === 2 ? 2 : 1;
      break;
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const batchRes = await db.execute({
    sql: `SELECT id, ticket_id FROM v3_qc_batches WHERE external_code = ? AND sku_code = ? LIMIT 1`,
    args: [externalCode, skuCode],
  });
  const batchRow = batchRes.rows[0] as { id?: unknown; ticket_id?: unknown } | undefined;
  const existingBatchId = String(batchRow?.id ?? "").trim() || null;
  const existingTicketId = String(batchRow?.ticket_id ?? "").trim() || null;

  let activeTicketId: string | null = null;
  if (existingTicketId) {
    const ticketRes = await db.execute({ sql: `SELECT status FROM v3_tickets WHERE id = ? LIMIT 1`, args: [existingTicketId] });
    const ticketRow = ticketRes.rows[0] as { status?: unknown } | undefined;
    const status = String(ticketRow?.status ?? "").trim();
    if (status && !isTerminalTicketStatus(status)) activeTicketId = existingTicketId;
  }

  if (result === "PASS") {
    const batchId = existingBatchId ?? crypto.randomUUID();
    await db.execute({
      sql: `
        INSERT INTO v3_qc_batches (id, external_code, sku_code, status, ticket_id, locked_at, hold_due_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (external_code, sku_code) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      args: [batchId, externalCode, skuCode, "PASS", null, null, null, nowIso],
    });

    await db.execute({
      sql: `
        INSERT INTO v3_scan_records (
          id, external_code, sku_code, scanned_qty, expected_qty, result,
          matched_rule_id, rule_reason, qc_batch_id, ticket_id, operator_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        externalCode,
        skuCode,
        scannedQty,
        Number.isFinite(expectedQty) ? expectedQty : null,
        "PASS",
        matchedRuleId,
        ruleReason,
        batchId,
        null,
        user.id,
        nowIso,
      ],
    });

    return NextResponse.json({ ok: true, result: "PASS" }, { status: 200 });
  }

  if (activeTicketId) {
    await db.execute({
      sql: `
        INSERT INTO v3_scan_records (
          id, external_code, sku_code, scanned_qty, expected_qty, result,
          matched_rule_id, rule_reason, qc_batch_id, ticket_id, operator_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        externalCode,
        skuCode,
        scannedQty,
        Number.isFinite(expectedQty) ? expectedQty : null,
        "HOLD",
        matchedRuleId,
        ruleReason,
        existingBatchId,
        activeTicketId,
        user.id,
        nowIso,
      ],
    });
    return NextResponse.json({ ok: true, result: "HOLD", existed: true, ticketId: activeTicketId }, { status: 200 });
  }

  const batchId = existingBatchId ?? crypto.randomUUID();
  const level = await calcApprovalLevel("QC", Number.isFinite(claimAmount) && claimAmount > 0 ? claimAmount : 0);
  const targetLevel = ticketTargetLevel === 2 ? 2 : level;
  const ticketId = crypto.randomUUID();
  const assignedL1 = targetLevel === 1 ? await pickApprover(1) : null;
  const assignedL2 = targetLevel === 2 ? await pickApprover(2) : null;
  const status = targetLevel === 1 ? "L1_APPROVING" : "L2_APPROVING";
  const dueAt = status === "L1_APPROVING" ? addHoursISO(now, 4) : addHoursISO(now, 8);

  try {
    await withTx(async (tx) => {
      await tx.execute({
      sql: `
        INSERT INTO v3_tickets (
          id, source, type, subtype, external_code, sku_code, description, claim_amount,
          status, current_level,
          reporter_user_id, assigned_l1_user_id, assigned_l2_user_id,
          resubmit_count, last_action_at, due_at, version,
          qc_batch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        ticketId,
        "SCAN",
        "QC",
        matchedRuleId ? rules.find((r) => r.id === matchedRuleId)?.subtype ?? null : null,
        externalCode,
        skuCode,
        ruleReason,
        Number.isFinite(claimAmount) ? Math.max(0, claimAmount) : 0,
        status,
        targetLevel,
        user.id,
        assignedL1,
        assignedL2,
        0,
        nowIso,
        dueAt,
        1,
        batchId,
        nowIso,
        nowIso,
      ],
      });

      await tx.execute({
      sql: `
        INSERT INTO v3_qc_batches (id, external_code, sku_code, status, ticket_id, locked_at, hold_due_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (external_code, sku_code) DO UPDATE SET
          status = excluded.status,
          ticket_id = excluded.ticket_id,
          locked_at = excluded.locked_at,
          hold_due_at = excluded.hold_due_at,
          updated_at = excluded.updated_at
      `,
      args: [batchId, externalCode, skuCode, "LINKED_TICKET", ticketId, nowIso, addMinutesISO(now, 30), nowIso],
      });

      await tx.execute({
      sql: `
        INSERT INTO v3_scan_records (
          id, external_code, sku_code, scanned_qty, expected_qty, result,
          matched_rule_id, rule_reason, qc_batch_id, ticket_id, operator_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        externalCode,
        skuCode,
        scannedQty,
        Number.isFinite(expectedQty) ? expectedQty : null,
        "HOLD",
        matchedRuleId,
        ruleReason,
        batchId,
        ticketId,
        user.id,
        nowIso,
      ],
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await createOrRefreshInventoryLock({
    ticketId,
    externalCode,
    skuCode,
    lockedQty: scannedQty,
  });

  return NextResponse.json({ ok: true, result: "HOLD", existed: false, ticketId }, { status: 200 });
}
