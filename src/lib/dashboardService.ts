import { ensureDb, getDbClient } from "@/lib/db";

type StatusCount = { status: string; count: number };

function toIso(d: Date) {
  return d.toISOString();
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toIso(d);
}

function addMinutesIso(mins: number) {
  return toIso(new Date(Date.now() + mins * 60 * 1000));
}

async function statusBreakdown(whereSql: string, args: Array<string | number | null>) {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute({
    sql: `
      SELECT status, COUNT(*)::int AS cnt
      FROM v3_tickets
      WHERE ${whereSql}
      GROUP BY status
      ORDER BY cnt DESC, status ASC
    `,
    args,
  });
  return res.rows.map((r) => {
    const row = r as { status?: unknown; cnt?: unknown };
    return { status: String(row.status ?? ""), count: Number(row.cnt ?? 0) } satisfies StatusCount;
  });
}

async function countTickets(whereSql: string, args: Array<string | number | null>) {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute({
    sql: `SELECT COUNT(*)::int AS cnt FROM v3_tickets WHERE ${whereSql}`,
    args,
  });
  const row = res.rows[0] as { cnt?: unknown } | undefined;
  return Number(row?.cnt ?? 0);
}

export async function getReporterDashboard(userId: string) {
  const nowIso = toIso(new Date());
  const dueSoonIso = addMinutesIso(60);
  const todayIso = startOfTodayIso();

  const [openCount, resubmitCount, dueSoonCount, createdTodayCount, breakdown] = await Promise.all([
    countTickets(`reporter_user_id = ? AND status NOT IN ('DONE', 'AUTO_REJECTED_TIMEOUT')`, [userId]),
    countTickets(`reporter_user_id = ? AND status = 'REJECTED_NEED_RESUBMIT'`, [userId]),
    countTickets(
      `reporter_user_id = ? AND due_at IS NOT NULL AND due_at <= ? AND status IN ('L1_APPROVING','L2_APPROVING')`,
      [userId, dueSoonIso]
    ),
    countTickets(`reporter_user_id = ? AND created_at >= ?`, [userId, todayIso]),
    statusBreakdown(`reporter_user_id = ?`, [userId]),
  ]);

  return {
    role: "reporter",
    nowIso,
    openCount,
    resubmitCount,
    dueSoonCount,
    createdTodayCount,
    breakdown,
  };
}

export async function getApproverDashboard(level: 1 | 2, userId: string) {
  const todayIso = startOfTodayIso();
  const dueSoonIso = addMinutesIso(60);
  await ensureDb();
  const db = getDbClient();

  const status = level === 1 ? "L1_APPROVING" : "L2_APPROVING";
  const assignedCol = level === 1 ? "assigned_l1_user_id" : "assigned_l2_user_id";

  const [pendingCount, dueSoonCount, breakdown, processedTodayCount] = await Promise.all([
    countTickets(`${assignedCol} = ? AND status = ?`, [userId, status]),
    countTickets(`${assignedCol} = ? AND status = ? AND due_at IS NOT NULL AND due_at <= ?`, [userId, status, dueSoonIso]),
    statusBreakdown(`${assignedCol} = ?`, [userId]),
    (async () => {
      const res = await db.execute({
        sql: `
          SELECT COUNT(*)::int AS cnt
          FROM v3_approvals
          WHERE actor_user_id = ?
            AND level = ?
            AND action IN ('APPROVE','REJECT')
            AND created_at >= ?
        `,
        args: [userId, level, todayIso],
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
  ]);

  return {
    role: level === 1 ? "approver_l1" : "approver_l2",
    pendingCount,
    dueSoonCount,
    processedTodayCount,
    breakdown,
  };
}

export async function getQcSupervisorDashboard(userId: string) {
  const todayIso = startOfTodayIso();
  const holdDueSoonIso = addMinutesIso(10);
  const nowIso = toIso(new Date());

  await ensureDb();
  const db = getDbClient();

  const [linkedTicketBatches, holdDueSoonBatches, holdOverdueBatches, qcOpenTickets, fastReleaseTodayCount] = await Promise.all([
    (async () => {
      const res = await db.execute({
        sql: `SELECT COUNT(*)::int AS cnt FROM v3_qc_batches WHERE status = 'LINKED_TICKET'`,
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
    (async () => {
      const res = await db.execute({
        sql: `
          SELECT COUNT(*)::int AS cnt
          FROM v3_qc_batches
          WHERE status = 'LINKED_TICKET'
            AND hold_due_at IS NOT NULL
            AND hold_due_at <= ?
            AND hold_due_at > ?
        `,
        args: [holdDueSoonIso, nowIso],
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
    (async () => {
      const res = await db.execute({
        sql: `
          SELECT COUNT(*)::int AS cnt
          FROM v3_qc_batches
          WHERE status = 'LINKED_TICKET'
            AND hold_due_at IS NOT NULL
            AND hold_due_at <= ?
        `,
        args: [nowIso],
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
    countTickets(`type = 'QC' AND status NOT IN ('DONE', 'AUTO_REJECTED_TIMEOUT')`, []),
    (async () => {
      const res = await db.execute({
        sql: `
          SELECT COUNT(*)::int AS cnt
          FROM v3_approvals
          WHERE actor_user_id = ?
            AND action = 'FAST_RELEASE'
            AND created_at >= ?
        `,
        args: [userId, todayIso],
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
  ]);

  const breakdown = await statusBreakdown(`type = 'QC'`, []);

  return {
    role: "qc_supervisor",
    linkedTicketBatches,
    holdDueSoonBatches,
    holdOverdueBatches,
    qcOpenTickets,
    fastReleaseTodayCount,
    breakdown,
  };
}

export async function getAdminDashboard() {
  const todayIso = startOfTodayIso();
  const dueSoonIso = addMinutesIso(60);
  const lastHourIso = addMinutesIso(-60);

  await ensureDb();
  const db = getDbClient();

  const [totalTickets, openTickets, dueSoonTickets, breakdownOpen, apiLastHourAgg, apiLatest, qcHoldBatches, approvalsToday] = await Promise.all([
    countTickets(`1=1`, []),
    countTickets(`status NOT IN ('DONE', 'AUTO_REJECTED_TIMEOUT')`, []),
    countTickets(`due_at IS NOT NULL AND due_at <= ? AND status IN ('L1_APPROVING','L2_APPROVING')`, [dueSoonIso]),
    statusBreakdown(`status NOT IN ('DONE', 'AUTO_REJECTED_TIMEOUT')`, []),
    (async () => {
      const res = await db.execute({
        sql: `
          SELECT COUNT(*)::int AS total, COALESCE(SUM(ok),0)::int AS ok
          FROM v3_api_call_logs
          WHERE created_at >= ?
        `,
        args: [lastHourIso],
      });
      const row = res.rows[0] as { total?: unknown; ok?: unknown } | undefined;
      const total = Number(row?.total ?? 0);
      const ok = Number(row?.ok ?? 0);
      return { total, ok, fail: Math.max(0, total - ok) };
    })(),
    (async () => {
      const res = await db.execute({
        sql: `
          SELECT request_id, api_name, response_status, ok, error_message, created_at
          FROM v3_api_call_logs
          ORDER BY created_at DESC
          LIMIT 1
        `,
      });
      const row = res.rows[0] as
        | { request_id?: unknown; api_name?: unknown; response_status?: unknown; ok?: unknown; error_message?: unknown; created_at?: unknown }
        | undefined;
      if (!row) return null;
      return {
        requestId: String(row.request_id ?? ""),
        apiName: String(row.api_name ?? ""),
        responseStatus: row.response_status === null || row.response_status === undefined ? null : Number(row.response_status),
        ok: Number(row.ok ?? 0) === 1,
        errorMessage: row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
        createdAt: String(row.created_at ?? ""),
      };
    })(),
    (async () => {
      const res = await db.execute({
        sql: `SELECT COUNT(*)::int AS cnt FROM v3_qc_batches WHERE status = 'LINKED_TICKET'`,
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
    (async () => {
      const res = await db.execute({
        sql: `SELECT COUNT(*)::int AS cnt FROM v3_approvals WHERE created_at >= ?`,
        args: [todayIso],
      });
      const row = res.rows[0] as { cnt?: unknown } | undefined;
      return Number(row?.cnt ?? 0);
    })(),
  ]);

  return {
    role: "admin",
    totalTickets,
    openTickets,
    dueSoonTickets,
    qcHoldBatches,
    approvalsToday,
    breakdownOpen,
    apiLastHourAgg,
    apiLatest,
  };
}

