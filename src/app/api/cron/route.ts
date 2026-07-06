import { NextResponse } from "next/server";
import { ensureDb, getDbClient, withTx } from "@/lib/db";
import { pickApprover } from "@/lib/ticketService";

function isAuthorized(req: Request) {
  const expected = String(process.env.CRON_SECRET ?? "").trim();
  const got = String(req.headers.get("x-cron-secret") ?? "").trim();
  return expected && got && expected === got;
}

async function findAdminUserId() {
  const db = getDbClient();
  const res = await db.execute({
    sql: `SELECT id FROM v3_users WHERE enabled = 1 AND (roles_json::jsonb ? ?) ORDER BY created_at ASC LIMIT 1`,
    args: ["admin"],
  });
  const row = res.rows[0] as { id?: unknown } | undefined;
  return String(row?.id ?? "").trim() || null;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureDb();
  const db = getDbClient();
  const nowIso = new Date().toISOString();
  const l2ApproverId = await pickApprover(2);
  const adminUserId = await findAdminUserId();
  const systemActorId = adminUserId || l2ApproverId || "system-cron";

  let escalated = 0;
  let autoRejected = 0;
  let qcEscalated = 0;
  let reassigned = 0;

  const ticketRes = await db.execute({
    sql: `
      SELECT id, status, version
      FROM v3_tickets
      WHERE due_at IS NOT NULL
        AND due_at < ?
        AND status IN ('PENDING', 'L1_APPROVING', 'L2_APPROVING')
      ORDER BY due_at ASC
      LIMIT 200
    `,
    args: [nowIso],
  });

  for (const row of ticketRes.rows) {
    const id = String(row.id ?? "");
    const status = String(row.status ?? "");
    const version = Number(row.version ?? 0);
    if (!id || !status || !version) continue;

    await withTx(async (tx) => {
      if (status === "L2_APPROVING") {
        const updateRes = await tx.execute({
          sql: `
            UPDATE v3_tickets
            SET status = ?, version = version + 1, last_action_at = ?, updated_at = ?
            WHERE id = ? AND version = ? AND status = ?
            RETURNING id
          `,
          args: ["AUTO_REJECTED_TIMEOUT", nowIso, nowIso, id, version, status],
        });
        if (updateRes.rows[0]) {
          autoRejected++;
          await tx.execute({
            sql: `
              INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [crypto.randomUUID(), id, 2, systemActorId, "AUTO_REJECT_TIMEOUT", "cron timeout", crypto.randomUUID(), nowIso],
          });
        }
        return;
      }

      const updateRes = await tx.execute({
        sql: `
          UPDATE v3_tickets
          SET status = ?, current_level = 2, assigned_l2_user_id = ?, version = version + 1, last_action_at = ?, updated_at = ?, due_at = ?
          WHERE id = ? AND version = ? AND status = ?
          RETURNING id
        `,
        args: ["L2_APPROVING", l2ApproverId, nowIso, nowIso, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), id, version, status],
      });
      if (updateRes.rows[0]) {
        escalated++;
        await tx.execute({
          sql: `
            INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [crypto.randomUUID(), id, 2, systemActorId, "AUTO_ESCALATE_TIMEOUT", "cron timeout", crypto.randomUUID(), nowIso],
        });
      }
    });
  }

  const qcRes = await db.execute({
    sql: `
      SELECT qb.id as batch_id, qb.ticket_id, t.version, t.status
      FROM v3_qc_batches qb
      JOIN v3_tickets t ON t.id = qb.ticket_id
      WHERE qb.hold_due_at IS NOT NULL
        AND qb.hold_due_at < ?
        AND qb.status IN ('HOLD', 'LINKED_TICKET')
        AND t.status IN ('PENDING', 'L1_APPROVING')
      LIMIT 200
    `,
    args: [nowIso],
  });

  for (const row of qcRes.rows) {
    const ticketId = String(row.ticket_id ?? "");
    const version = Number(row.version ?? 0);
    const status = String(row.status ?? "");
    if (!ticketId || !version || !status) continue;

    await withTx(async (tx) => {
      const updateRes = await tx.execute({
        sql: `
          UPDATE v3_tickets
          SET status = ?, current_level = 2, assigned_l2_user_id = ?, version = version + 1, last_action_at = ?, updated_at = ?, due_at = ?
          WHERE id = ? AND version = ? AND status = ?
          RETURNING id
        `,
        args: ["L2_APPROVING", l2ApproverId, nowIso, nowIso, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), ticketId, version, status],
      });
      if (updateRes.rows[0]) {
        qcEscalated++;
        await tx.execute({
          sql: `
            INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [crypto.randomUUID(), ticketId, 2, systemActorId, "QC_HOLD_TIMEOUT_ESCALATE", "cron qc hold timeout", crypto.randomUUID(), nowIso],
        });
      }
    });
  }

  const disabledAssignRes = await db.execute(`
    SELECT t.id, t.status, t.version
    FROM v3_tickets t
    LEFT JOIN v3_users l1 ON l1.id = t.assigned_l1_user_id
    LEFT JOIN v3_users l2 ON l2.id = t.assigned_l2_user_id
    WHERE (t.status = 'L1_APPROVING' AND COALESCE(l1.enabled, 0) = 0)
       OR (t.status = 'L2_APPROVING' AND COALESCE(l2.enabled, 0) = 0)
    LIMIT 200
  `);

  for (const row of disabledAssignRes.rows) {
    const id = String(row.id ?? "");
    const status = String(row.status ?? "");
    const version = Number(row.version ?? 0);
    if (!id || !status || !version) continue;

    await withTx(async (tx) => {
      const nextStatus = "L2_APPROVING";
      const updateRes = await tx.execute({
        sql: `
          UPDATE v3_tickets
          SET status = ?, current_level = 2, assigned_l2_user_id = ?, version = version + 1, last_action_at = ?, updated_at = ?, due_at = ?
          WHERE id = ? AND version = ? AND status = ?
          RETURNING id
        `,
        args: [nextStatus, l2ApproverId, nowIso, nowIso, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), id, version, status],
      });
      if (updateRes.rows[0]) {
        reassigned++;
        await tx.execute({
          sql: `
            INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [crypto.randomUUID(), id, 2, systemActorId, "REASSIGN_DISABLED_APPROVER", "cron disabled approver fallback", crypto.randomUUID(), nowIso],
        });
      }
    });
  }

  return NextResponse.json({ ok: true, escalated, autoRejected, qcEscalated, reassigned }, { status: 200 });
}
