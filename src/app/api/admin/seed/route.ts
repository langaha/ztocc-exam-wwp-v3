import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/auth";
import { ensureDb, getDbClient, withTx } from "@/lib/db";

const logisticsSubtypes = ["LOST", "DAMAGED", "REFUSED", "TIMEOUT", "ADDRESS_ERROR"] as const;
const qcSubtypes = ["QTY_MISMATCH", "LABEL_ERROR", "BATCH_EXCEPTION"] as const;
const statuses = ["L1_APPROVING", "L2_APPROVING", "REJECTED_NEED_RESUBMIT", "DONE"] as const;

export async function POST(req: Request) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.roles.includes("admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await ensureDb();
  const db = getDbClient();
  const userRes = await db.execute(`SELECT id, roles_json FROM v3_users WHERE enabled = 1 ORDER BY created_at ASC`);
  let reporterId = "";
  let l1Id = "";
  let l2Id = "";
  let qcId = "";

  for (const row of userRes.rows) {
    const id = String(row.id ?? "");
    let roles: string[] = [];
    try {
      roles = JSON.parse(String(row.roles_json ?? "[]")) as string[];
    } catch {
      roles = [];
    }
    if (!reporterId && roles.includes("reporter")) reporterId = id;
    if (!l1Id && roles.includes("approver_l1")) l1Id = id;
    if (!l2Id && roles.includes("approver_l2")) l2Id = id;
    if (!qcId && roles.includes("qc_supervisor")) qcId = id;
  }

  const now = Date.now();
  let created = 0;

  for (let i = 0; i < 200; i++) {
    const isQc = i % 3 === 0;
    const ticketId = crypto.randomUUID();
    const externalCode = `SEED-${now}-${String(i).padStart(4, "0")}`;
    const skuCode = isQc ? `SKU-${(i % 20) + 1}` : `SKU-${(i % 15) + 1}`;
    const status = statuses[i % statuses.length];
    const createdAt = new Date(Date.now() - i * 60 * 60 * 1000).toISOString();
    const dueAt = new Date(Date.now() + ((i % 6) - 2) * 60 * 60 * 1000).toISOString();
    const subtype = isQc ? qcSubtypes[i % qcSubtypes.length] : logisticsSubtypes[i % logisticsSubtypes.length];
    const claimAmount = isQc ? 100 + (i % 5) * 200 : 50 + (i % 10) * 120;
    const batchId = isQc ? crypto.randomUUID() : null;

    await withTx(async (tx) => {
      await tx.execute({
        sql: `
          INSERT INTO v3_waybill_snapshots (
            id, external_code, receiver_store, receiver_name, receiver_phone, receiver_address,
            estimated_amount, v2_created_at, fetched_from_v2_at, v2_request_id, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (external_code) DO NOTHING
        `,
        args: [
          crypto.randomUUID(),
          externalCode,
          "Seed门店",
          `收件人${i}`,
          "13800000000",
          `演示地址${i}`,
          claimAmount,
          createdAt,
          createdAt,
          null,
          JSON.stringify({ externalCode, skuCode }),
        ],
      });

      await tx.execute({
        sql: `
          INSERT INTO v3_tickets (
            id, source, type, subtype, external_code, sku_code, description, claim_amount,
            status, current_level, reporter_user_id, assigned_l1_user_id, assigned_l2_user_id,
            resubmit_count, last_action_at, due_at, version, qc_batch_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          ticketId,
          isQc ? "SCAN" : "MANUAL",
          isQc ? "QC" : "LOGISTICS",
          subtype,
          externalCode,
          skuCode,
          `Seed ticket ${i}`,
          claimAmount,
          status,
          status === "L2_APPROVING" ? 2 : 1,
          reporterId || user.id,
          l1Id || null,
          l2Id || null,
          status === "REJECTED_NEED_RESUBMIT" ? 1 : 0,
          createdAt,
          dueAt,
          1,
          batchId,
          createdAt,
          createdAt,
        ],
      });

      if (isQc && batchId) {
        await tx.execute({
          sql: `
            INSERT INTO v3_qc_batches (id, external_code, sku_code, status, ticket_id, locked_at, hold_due_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [
            batchId,
            externalCode,
            skuCode,
            status === "DONE" ? "PASS" : "LINKED_TICKET",
            ticketId,
            createdAt,
            dueAt,
            createdAt,
          ],
        });
      }

      await tx.execute({
        sql: `
          INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          crypto.randomUUID(),
          ticketId,
          status === "L2_APPROVING" ? 2 : 1,
          isQc ? qcId || reporterId || user.id : l1Id || user.id,
          status === "DONE" ? "APPROVE" : status === "REJECTED_NEED_RESUBMIT" ? "REJECT" : "SUBMIT",
          "seed",
          crypto.randomUUID(),
          createdAt,
        ],
      });

      if (status === "DONE" && claimAmount > 0) {
        await tx.execute({
          sql: `
            INSERT INTO v3_compensations (id, ticket_id, approval_id, direction, amount, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (ticket_id) DO NOTHING
          `,
          args: [
            crypto.randomUUID(),
            ticketId,
            crypto.randomUUID(),
            isQc ? "SUPPLIER" : "CUSTOMER",
            claimAmount,
            "CREATED",
            createdAt,
          ],
        });
      }
    });

    created++;
  }

  return NextResponse.json({ ok: true, created }, { status: 200 });
}

