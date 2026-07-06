import type { DbClient } from "@/lib/db";
import { ensureDb, getDbClient, withTx } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

export const TERMINAL_TICKET_STATUSES = ["DONE", "AUTO_REJECTED_TIMEOUT"] as const;

export type TicketRow = {
  id: string;
  source: string;
  type: string;
  subtype: string | null;
  externalCode: string;
  skuCode: string | null;
  description: string | null;
  claimAmount: number;
  status: string;
  currentLevel: number;
  reporterUserId: string;
  assignedL1UserId: string | null;
  assignedL2UserId: string | null;
  resubmitCount: number;
  lastActionAt: string;
  dueAt: string | null;
  version: number;
  qcBatchId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isTerminalTicketStatus(status: string) {
  return TERMINAL_TICKET_STATUSES.includes(status as (typeof TERMINAL_TICKET_STATUSES)[number]);
}

export function addMinutesISO(now: Date, mins: number) {
  return new Date(now.getTime() + mins * 60 * 1000).toISOString();
}

export function addHoursISO(now: Date, hours: number) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function mapTicketRow(row: Record<string, unknown>): TicketRow {
  return {
    id: String(row.id ?? ""),
    source: String(row.source ?? ""),
    type: String(row.type ?? ""),
    subtype: row.subtype === null || row.subtype === undefined ? null : String(row.subtype),
    externalCode: String(row.external_code ?? ""),
    skuCode: row.sku_code === null || row.sku_code === undefined ? null : String(row.sku_code),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    claimAmount: Number(row.claim_amount ?? 0),
    status: String(row.status ?? ""),
    currentLevel: Number(row.current_level ?? 0),
    reporterUserId: String(row.reporter_user_id ?? ""),
    assignedL1UserId: row.assigned_l1_user_id === null || row.assigned_l1_user_id === undefined ? null : String(row.assigned_l1_user_id),
    assignedL2UserId: row.assigned_l2_user_id === null || row.assigned_l2_user_id === undefined ? null : String(row.assigned_l2_user_id),
    resubmitCount: Number(row.resubmit_count ?? 0),
    lastActionAt: String(row.last_action_at ?? ""),
    dueAt: row.due_at === null || row.due_at === undefined ? null : String(row.due_at),
    version: Number(row.version ?? 0),
    qcBatchId: row.qc_batch_id === null || row.qc_batch_id === undefined ? null : String(row.qc_batch_id),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function pickApprover(level: 1 | 2) {
  await ensureDb();
  const db = getDbClient();
  const role = level === 1 ? "approver_l1" : "approver_l2";
  const res = await db.execute({
    sql: `SELECT id FROM v3_users WHERE enabled = 1 AND (roles_json::jsonb ? ?) ORDER BY created_at ASC LIMIT 1`,
    args: [role],
  });
  const row = res.rows[0] as { id?: unknown } | undefined;
  return String(row?.id ?? "").trim() || null;
}

export async function calcApprovalLevel(ticketType: string, claimAmount: number): Promise<1 | 2> {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute({
    sql: `
      SELECT min_amount, max_amount, target_level
      FROM v3_approval_rules
      WHERE enabled = 1 AND ticket_type = ?
      ORDER BY min_amount ASC
    `,
    args: [ticketType],
  });
  for (const r of res.rows) {
    const row = r as { min_amount?: unknown; max_amount?: unknown; target_level?: unknown };
    const min = Number(row.min_amount ?? 0);
    const max = row.max_amount === null || row.max_amount === undefined ? null : Number(row.max_amount);
    const level = Number(row.target_level ?? 1) === 2 ? 2 : 1;
    if (claimAmount >= min && (max === null || claimAmount <= max)) return level;
  }
  return 1;
}

export async function getTicketById(id: string, db: DbClient = getDbClient()): Promise<TicketRow | null> {
  const res = await db.execute({
    sql: `SELECT * FROM v3_tickets WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = res.rows[0];
  return row ? mapTicketRow(row) : null;
}

export async function findOpenSameTypeTicket(args: { externalCode: string; type: string; subtype: string | null }) {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute({
    sql: `
      SELECT *
      FROM v3_tickets
      WHERE external_code = ?
        AND type = ?
        AND ((subtype IS NULL AND ? IS NULL) OR subtype = ?)
        AND status NOT IN ('DONE', 'AUTO_REJECTED_TIMEOUT')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [args.externalCode, args.type, args.subtype, args.subtype],
  });
  return res.rows[0] ? mapTicketRow(res.rows[0]) : null;
}

export async function createManualTicket(args: {
  externalCode: string;
  skuCode?: string | null;
  subtype: string;
  description: string;
  claimAmount: number;
  reporterUserId: string;
}) {
  await ensureDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const targetLevel = await calcApprovalLevel("LOGISTICS", args.claimAmount);
  const assignedL1 = targetLevel === 1 ? await pickApprover(1) : null;
  const assignedL2 = targetLevel === 2 ? await pickApprover(2) : null;
  const status = targetLevel === 1 ? "L1_APPROVING" : "L2_APPROVING";
  const dueAt = status === "L1_APPROVING" ? addHoursISO(now, 4) : addHoursISO(now, 8);
  const ticketId = crypto.randomUUID();

  await withTx(async (tx) => {
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
        "MANUAL",
        "LOGISTICS",
        args.subtype,
        args.externalCode,
        args.skuCode ?? null,
        args.description,
        args.claimAmount,
        status,
        targetLevel,
        args.reporterUserId,
        assignedL1,
        assignedL2,
        0,
        nowIso,
        dueAt,
        1,
        null,
        nowIso,
        nowIso,
      ],
    });
  });

  return getTicketById(ticketId);
}

export function canApproveTicket(ticket: TicketRow, user: SessionUser) {
  if (ticket.reporterUserId === user.id) return { ok: false, message: "cannot approve own ticket" };
  if (ticket.status === "L1_APPROVING") {
    if (!user.roles.includes("approver_l1")) return { ok: false, message: "forbidden" };
    if (ticket.assignedL1UserId && ticket.assignedL1UserId !== user.id) return { ok: false, message: "not assigned" };
    return { ok: true };
  }
  if (ticket.status === "L2_APPROVING") {
    if (!user.roles.includes("approver_l2")) return { ok: false, message: "forbidden" };
    if (ticket.assignedL2UserId && ticket.assignedL2UserId !== user.id) return { ok: false, message: "not assigned" };
    return { ok: true };
  }
  return { ok: false, message: "ticket not pending approval" };
}

function shouldCreateCustomerCompensation(ticket: TicketRow) {
  return ticket.type === "LOGISTICS" && ["LOST", "DAMAGED"].includes(String(ticket.subtype ?? ""));
}

function shouldCreateSupplierCompensation(ticket: TicketRow) {
  return ticket.type === "QC" && ticket.claimAmount > 0;
}

async function ensureApprovalIdempotency(tx: DbClient, args: { ticketId: string; action: string; idempotencyKey: string }) {
  const existingRes = await tx.execute({
    sql: `SELECT id FROM v3_approvals WHERE ticket_id = ? AND action = ? AND idempotency_key = ? LIMIT 1`,
    args: [args.ticketId, args.action, args.idempotencyKey],
  });
  const existing = existingRes.rows[0] as { id?: unknown } | undefined;
  return existing ? String(existing.id ?? "") : null;
}

export async function approveOrRejectTicket(args: {
  ticketId: string;
  actor: SessionUser;
  expectedVersion: number;
  idempotencyKey: string;
  comment: string;
  action: "APPROVE" | "REJECT";
}) {
  await ensureDb();
  return withTx(async (tx) => {
    const ticket = await getTicketById(args.ticketId, tx);
    if (!ticket) return { ok: false as const, status: 404, error: "ticket not found" };

    const perm = canApproveTicket(ticket, args.actor);
    if (!perm.ok) return { ok: false as const, status: perm.message === "cannot approve own ticket" ? 403 : 400, error: perm.message };

    if (ticket.version !== args.expectedVersion) {
      return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };
    }

    const actionName = args.action === "APPROVE" ? "APPROVE" : "REJECT";
    const existingApprovalId = await ensureApprovalIdempotency(tx, {
      ticketId: ticket.id,
      action: actionName,
      idempotencyKey: args.idempotencyKey,
    });
    if (existingApprovalId) {
      const latest = await getTicketById(ticket.id, tx);
      return { ok: true as const, ticket: latest, approvalId: existingApprovalId, idempotent: true };
    }

    const approvalId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const level = ticket.status === "L1_APPROVING" ? 1 : 2;

    await tx.execute({
      sql: `
        INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [approvalId, ticket.id, level, args.actor.id, actionName, args.comment || null, args.idempotencyKey, nowIso],
    });

    if (args.action === "REJECT") {
      const rejectRes = await tx.execute({
        sql: `
          UPDATE v3_tickets
          SET status = ?, resubmit_count = resubmit_count + 1, version = version + 1, last_action_at = ?, updated_at = ?
          WHERE id = ? AND version = ? AND status = ?
          RETURNING version
        `,
        args: ["REJECTED_NEED_RESUBMIT", nowIso, nowIso, ticket.id, args.expectedVersion, ticket.status],
      });
      if (!rejectRes.rows[0]) {
        return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };
      }
      const latest = await getTicketById(ticket.id, tx);
      return { ok: true as const, ticket: latest, approvalId, idempotent: false };
    }

    const updateRes = await tx.execute({
      sql: `
        UPDATE v3_tickets
        SET status = ?, version = version + 1, last_action_at = ?, updated_at = ?
        WHERE id = ? AND version = ? AND status = ?
        RETURNING version
      `,
      args: ["DONE", nowIso, nowIso, ticket.id, args.expectedVersion, ticket.status],
    });
    if (!updateRes.rows[0]) {
      return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };
    }

    if (shouldCreateCustomerCompensation(ticket) && ticket.claimAmount > 0) {
      await tx.execute({
        sql: `
          INSERT INTO v3_compensations (id, ticket_id, approval_id, direction, amount, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (ticket_id) DO NOTHING
        `,
        args: [crypto.randomUUID(), ticket.id, approvalId, "CUSTOMER", ticket.claimAmount, "CREATED", nowIso],
      });
    }

    if (shouldCreateSupplierCompensation(ticket)) {
      await tx.execute({
        sql: `
          INSERT INTO v3_compensations (id, ticket_id, approval_id, direction, amount, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (ticket_id) DO NOTHING
        `,
        args: [crypto.randomUUID(), ticket.id, approvalId, "SUPPLIER", ticket.claimAmount, "CREATED", nowIso],
      });
    }

    if (ticket.type === "QC" && ticket.qcBatchId) {
      await tx.execute({
        sql: `UPDATE v3_qc_batches SET status = ?, updated_at = ? WHERE id = ?`,
        args: ["PASS", nowIso, ticket.qcBatchId],
      });
      if (ticket.skuCode) {
        await tx.execute({
          sql: `
            UPDATE v3_inventory_locks
            SET status = ?
            WHERE ticket_id = ? AND external_code = ? AND sku_code = ? AND status = ?
          `,
          args: ["RELEASED", ticket.id, ticket.externalCode, ticket.skuCode, "ACTIVE"],
        });
      }
    }

    const latest = await getTicketById(ticket.id, tx);
    return { ok: true as const, ticket: latest, approvalId, idempotent: false };
  });
}

export async function fastReleaseQcTicket(args: {
  ticketId: string;
  actor: SessionUser;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
}) {
  await ensureDb();
  return withTx(async (tx) => {
    const ticket = await getTicketById(args.ticketId, tx);
    if (!ticket) return { ok: false as const, status: 404, error: "ticket not found" };
    if (ticket.type !== "QC" || ticket.source !== "SCAN") return { ok: false as const, status: 400, error: "only qc scan ticket supports fast release" };
    if (!args.actor.roles.includes("qc_supervisor")) return { ok: false as const, status: 403, error: "forbidden" };
    if (!args.reason.trim()) return { ok: false as const, status: 400, error: "reason is required" };
    if (ticket.version !== args.expectedVersion) return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };

    const existingApprovalId = await ensureApprovalIdempotency(tx, {
      ticketId: ticket.id,
      action: "FAST_RELEASE",
      idempotencyKey: args.idempotencyKey,
    });
    if (existingApprovalId) {
      const latest = await getTicketById(ticket.id, tx);
      return { ok: true as const, ticket: latest, approvalId: existingApprovalId, idempotent: true };
    }

    const approvalId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await tx.execute({
      sql: `
        INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [approvalId, ticket.id, ticket.currentLevel, args.actor.id, "FAST_RELEASE", args.reason, args.idempotencyKey, nowIso],
    });

    const updateRes = await tx.execute({
      sql: `
        UPDATE v3_tickets
        SET status = ?, version = version + 1, last_action_at = ?, updated_at = ?
        WHERE id = ? AND version = ? AND status NOT IN ('DONE', 'AUTO_REJECTED_TIMEOUT')
        RETURNING version
      `,
      args: ["DONE", nowIso, nowIso, ticket.id, args.expectedVersion],
    });
    if (!updateRes.rows[0]) return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };

    if (ticket.qcBatchId) {
      await tx.execute({
        sql: `UPDATE v3_qc_batches SET status = ?, updated_at = ? WHERE id = ?`,
        args: ["FAST_RELEASED", nowIso, ticket.qcBatchId],
      });
    }
    if (ticket.skuCode) {
      await tx.execute({
        sql: `
          UPDATE v3_inventory_locks
          SET status = ?
          WHERE ticket_id = ? AND external_code = ? AND sku_code = ? AND status = ?
        `,
        args: ["RELEASED", ticket.id, ticket.externalCode, ticket.skuCode, "ACTIVE"],
      });
    }

    const latest = await getTicketById(ticket.id, tx);
    return { ok: true as const, ticket: latest, approvalId, idempotent: false };
  });
}

export async function createOrRefreshInventoryLock(args: {
  ticketId: string;
  externalCode: string;
  skuCode: string;
  lockedQty: number;
}) {
  await ensureDb();
  const db = getDbClient();
  const nowIso = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO v3_inventory_locks (id, ticket_id, external_code, sku_code, locked_qty, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (external_code, sku_code, status) DO UPDATE SET
        locked_qty = excluded.locked_qty,
        ticket_id = excluded.ticket_id
    `,
    args: [crypto.randomUUID(), args.ticketId, args.externalCode, args.skuCode, args.lockedQty, "ACTIVE", nowIso],
  });
}

export async function listTickets(args: {
  status?: string;
  type?: string;
  externalCode?: string;
  assignedUserId?: string;
  page: number;
  pageSize: number;
}) {
  await ensureDb();
  const db = getDbClient();
  const where: string[] = [];
  const queryArgs: Array<string | number | null> = [];

  if (args.status) {
    where.push(`status = ?`);
    queryArgs.push(args.status);
  }
  if (args.type) {
    where.push(`type = ?`);
    queryArgs.push(args.type);
  }
  if (args.externalCode) {
    where.push(`external_code ILIKE ?`);
    queryArgs.push(`%${args.externalCode}%`);
  }
  if (args.assignedUserId) {
    where.push(`(assigned_l1_user_id = ? OR assigned_l2_user_id = ?)`);
    queryArgs.push(args.assignedUserId, args.assignedUserId);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (args.page - 1) * args.pageSize;

  const totalRes = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM v3_tickets ${whereSql}`,
    args: queryArgs,
  });
  const total = Number((totalRes.rows[0] as { cnt?: unknown } | undefined)?.cnt ?? 0);

  const listRes = await db.execute({
    sql: `
      SELECT t.*, ru.name as reporter_name, l1.name as assigned_l1_name, l2.name as assigned_l2_name
      FROM v3_tickets t
      LEFT JOIN v3_users ru ON ru.id = t.reporter_user_id
      LEFT JOIN v3_users l1 ON l1.id = t.assigned_l1_user_id
      LEFT JOIN v3_users l2 ON l2.id = t.assigned_l2_user_id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [...queryArgs, args.pageSize, offset],
  });

  return {
    total,
    list: listRes.rows.map((row) => ({
      ...mapTicketRow(row),
      reporterName: row.reporter_name === null || row.reporter_name === undefined ? null : String(row.reporter_name),
      assignedL1Name: row.assigned_l1_name === null || row.assigned_l1_name === undefined ? null : String(row.assigned_l1_name),
      assignedL2Name: row.assigned_l2_name === null || row.assigned_l2_name === undefined ? null : String(row.assigned_l2_name),
    })),
  };
}

export async function listApprovals(ticketId: string) {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute({
    sql: `
      SELECT a.*, u.name as actor_name
      FROM v3_approvals a
      LEFT JOIN v3_users u ON u.id = a.actor_user_id
      WHERE a.ticket_id = ?
      ORDER BY a.created_at DESC
    `,
    args: [ticketId],
  });
  return res.rows.map((row) => ({
    id: String(row.id ?? ""),
    level: Number(row.level ?? 0),
    actorUserId: String(row.actor_user_id ?? ""),
    actorName: row.actor_name === null || row.actor_name === undefined ? null : String(row.actor_name),
    action: String(row.action ?? ""),
    comment: row.comment === null || row.comment === undefined ? null : String(row.comment),
    createdAt: String(row.created_at ?? ""),
  }));
}

export async function getWaybillSnapshotByExternalCode(externalCode: string, db: DbClient = getDbClient()) {
  const res = await db.execute({
    sql: `SELECT * FROM v3_waybill_snapshots WHERE external_code = ? LIMIT 1`,
    args: [externalCode],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    externalCode: String(row.external_code ?? ""),
    receiverStore: row.receiver_store === null || row.receiver_store === undefined ? null : String(row.receiver_store),
    receiverName: row.receiver_name === null || row.receiver_name === undefined ? null : String(row.receiver_name),
    receiverPhone: row.receiver_phone === null || row.receiver_phone === undefined ? null : String(row.receiver_phone),
    receiverAddress: row.receiver_address === null || row.receiver_address === undefined ? null : String(row.receiver_address),
    estimatedAmount: row.estimated_amount === null || row.estimated_amount === undefined ? null : Number(row.estimated_amount),
    v2CreatedAt: row.v2_created_at === null || row.v2_created_at === undefined ? null : String(row.v2_created_at),
    fetchedFromV2At: String(row.fetched_from_v2_at ?? ""),
    v2RequestId: row.v2_request_id === null || row.v2_request_id === undefined ? null : String(row.v2_request_id),
  };
}

export async function getTicketDetail(ticketId: string, db: DbClient = getDbClient()) {
  const ticket = await getTicketById(ticketId, db);
  if (!ticket) return null;
  const [snapshot, approvals] = await Promise.all([
    getWaybillSnapshotByExternalCode(ticket.externalCode, db),
    listApprovals(ticketId),
  ]);
  return { ticket, snapshot, approvals };
}

export function canResubmitTicket(ticket: TicketRow, user: SessionUser) {
  if (ticket.status !== "REJECTED_NEED_RESUBMIT") return { ok: false, message: "ticket not waiting resubmit" };
  if (ticket.reporterUserId !== user.id) return { ok: false, message: "only reporter can resubmit" };
  return { ok: true };
}

export async function resubmitTicket(args: {
  ticketId: string;
  actor: SessionUser;
  expectedVersion: number;
  description: string;
  claimAmount: number;
  idempotencyKey: string;
}) {
  await ensureDb();
  return withTx(async (tx) => {
    const ticket = await getTicketById(args.ticketId, tx);
    if (!ticket) return { ok: false as const, status: 404, error: "ticket not found" };

    const perm = canResubmitTicket(ticket, args.actor);
    if (!perm.ok) return { ok: false as const, status: 400, error: perm.message };
    if (ticket.version !== args.expectedVersion) {
      return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };
    }

    const existingApprovalId = await ensureApprovalIdempotency(tx, {
      ticketId: ticket.id,
      action: "RESUBMIT",
      idempotencyKey: args.idempotencyKey,
    });
    if (existingApprovalId) {
      const latest = await getTicketById(ticket.id, tx);
      return { ok: true as const, ticket: latest, approvalId: existingApprovalId, idempotent: true };
    }

    const approvalId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();
    const exceedLimit = ticket.resubmitCount >= 2;
    const nextStatus = exceedLimit ? "L2_APPROVING" : "L1_APPROVING";
    const nextLevel = exceedLimit ? 2 : 1;
    const dueAt = exceedLimit ? addHoursISO(now, 8) : addHoursISO(now, 4);
    const assignedL1 = exceedLimit ? null : await pickApprover(1);
    const assignedL2 = await pickApprover(2);

    await tx.execute({
      sql: `
        INSERT INTO v3_approvals (id, ticket_id, level, actor_user_id, action, comment, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [approvalId, ticket.id, nextLevel, args.actor.id, "RESUBMIT", args.description || null, args.idempotencyKey, nowIso],
    });

    const updateRes = await tx.execute({
      sql: `
        UPDATE v3_tickets
        SET status = ?, current_level = ?, claim_amount = ?, description = ?, assigned_l1_user_id = ?, assigned_l2_user_id = ?,
            version = version + 1, last_action_at = ?, updated_at = ?, due_at = ?
        WHERE id = ? AND version = ? AND status = ?
        RETURNING version
      `,
      args: [
        nextStatus,
        nextLevel,
        args.claimAmount,
        args.description,
        assignedL1,
        assignedL2,
        nowIso,
        nowIso,
        dueAt,
        ticket.id,
        args.expectedVersion,
        ticket.status,
      ],
    });
    if (!updateRes.rows[0]) {
      return { ok: false as const, status: 409, error: "ticket already changed, please refresh" };
    }

    const latest = await getTicketById(ticket.id, tx);
    return { ok: true as const, ticket: latest, approvalId, idempotent: false };
  });
}
