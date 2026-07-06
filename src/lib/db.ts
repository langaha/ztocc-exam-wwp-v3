import { Pool, type PoolClient } from "pg";

export type DbValue = string | number | bigint | boolean | null | Uint8Array | Date;
export type DbArgs = Array<DbValue>;
export type DbStatement = { sql: string; args?: DbArgs } | string;
export type DbResultSet = { rows: Array<Record<string, unknown>> };

export type DbClient = {
  execute(stmtOrSql: DbStatement, args?: DbArgs): Promise<DbResultSet>;
};

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getDatabaseUrlRaw(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.PRISMA_DATABASE_URL ?? "";
  return String(url).trim();
}

function shouldUseSsl(url: string) {
  const u = url.toLowerCase();
  return u.includes("sslmode=require") || u.includes("ssl=true");
}

function stripSslModeParam(url: string): string {
  const v = url.trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.searchParams.has("sslmode")) u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return v
      .replace(/([?&])sslmode=[^&]*(&|$)/gi, (_m, p1, p2) => (p2 ? p1 : ""))
      .replace(/[?&]$/, "");
  }
}

function getPool(): Pool {
  if (pool) return pool;
  const rawUrl = getDatabaseUrlRaw();
  if (!rawUrl) {
    const keys = ["DATABASE_URL", "POSTGRES_URL", "PRISMA_DATABASE_URL"] as const;
    const present = keys.filter((k) => String(process.env[k] ?? "").trim().length > 0);
    const env = String(process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "").trim() || "unknown";
    throw new Error(
      `DATABASE_URL/POSTGRES_URL/PRISMA_DATABASE_URL is required. env=${env}, present=${present.join(",") || "none"}`
    );
  }
  const url = stripSslModeParam(rawUrl);
  pool = new Pool({
    connectionString: url,
    ssl: shouldUseSsl(rawUrl) ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  return pool;
}

function convertQuestionMarksToPostgres(sql: string): string {
  let out = "";
  let inSingle = false;
  let paramIndex = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;

    if (ch === "'") {
      if (inSingle && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }

    if (ch === "?" && !inSingle) {
      paramIndex++;
      out += `$${paramIndex}`;
      continue;
    }

    out += ch;
  }

  return out;
}

const client: DbClient = {
  async execute(stmtOrSql: DbStatement, args?: DbArgs) {
    const p = getPool();

    if (typeof stmtOrSql === "string") {
      const res = await p.query(stmtOrSql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    }

    const sql = convertQuestionMarksToPostgres(stmtOrSql.sql);
    const a = stmtOrSql.args ?? args ?? [];
    const res = await p.query(sql, a);
    return { rows: res.rows as Array<Record<string, unknown>> };
  },
};

export function getDbClient(): DbClient {
  return client;
}

function createClientFromPoolClient(c: PoolClient): DbClient {
  return {
    async execute(stmtOrSql: DbStatement, args?: DbArgs) {
      if (typeof stmtOrSql === "string") {
        const res = await c.query(stmtOrSql);
        return { rows: res.rows as Array<Record<string, unknown>> };
      }
      const sql = convertQuestionMarksToPostgres(stmtOrSql.sql);
      const a = stmtOrSql.args ?? args ?? [];
      const res = await c.query(sql, a);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
  };
}

export async function withTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  const p = getPool();
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const tx = createClientFromPoolClient(c);
    const res = await fn(tx);
    await c.query("COMMIT");
    return res;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    c.release();
  }
}

async function migrate(db: DbClient) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_waybill_snapshots (
      id TEXT PRIMARY KEY,
      external_code TEXT NOT NULL UNIQUE,
      receiver_store TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      receiver_address TEXT,
      estimated_amount DOUBLE PRECISION,
      v2_created_at TEXT,
      fetched_from_v2_at TEXT NOT NULL,
      v2_request_id TEXT,
      raw_json TEXT
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_waybill_snapshots_fetched ON v3_waybill_snapshots(fetched_from_v2_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_api_call_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      target_system TEXT NOT NULL,
      api_name TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      request_summary TEXT,
      response_status INTEGER,
      duration_ms INTEGER,
      ok INTEGER NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_api_call_logs_created_at ON v3_api_call_logs(created_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_api_call_logs_request_id ON v3_api_call_logs(request_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_sessions_token_hash ON v3_sessions(token_hash)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_approval_rules (
      id TEXT PRIMARY KEY,
      ticket_type TEXT NOT NULL,
      min_amount DOUBLE PRECISION NOT NULL,
      max_amount DOUBLE PRECISION,
      target_level INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_approval_rules_type ON v3_approval_rules(ticket_type, enabled)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_qc_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subtype TEXT NOT NULL,
      severity INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      condition_json TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_tickets (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      external_code TEXT NOT NULL,
      sku_code TEXT,
      description TEXT,
      claim_amount DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      current_level INTEGER NOT NULL,
      reporter_user_id TEXT NOT NULL,
      assigned_l1_user_id TEXT,
      assigned_l2_user_id TEXT,
      resubmit_count INTEGER NOT NULL,
      last_action_at TEXT NOT NULL,
      due_at TEXT,
      version INTEGER NOT NULL,
      qc_batch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_tickets_status ON v3_tickets(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_tickets_external_code ON v3_tickets(external_code)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_tickets_assigned_l1 ON v3_tickets(assigned_l1_user_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_tickets_assigned_l2 ON v3_tickets(assigned_l2_user_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_tickets_due_at ON v3_tickets(due_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_approvals (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      comment TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_approvals_idem ON v3_approvals(ticket_id, action, idempotency_key)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_approvals_ticket ON v3_approvals(ticket_id, created_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_compensations (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      approval_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_comp_ticket ON v3_compensations(ticket_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_comp_approval ON v3_compensations(approval_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_inventory_items (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL UNIQUE,
      available_qty DOUBLE PRECISION NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_inventory_locks (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      external_code TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      locked_qty DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_inventory_lock_active ON v3_inventory_locks(external_code, sku_code, status)`
  );

  await db.execute(`ALTER TABLE v3_tickets ADD COLUMN IF NOT EXISTS sku_code TEXT`);
  await db.execute(`ALTER TABLE v3_tickets ADD COLUMN IF NOT EXISTS description TEXT`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_inventory_ledger (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      delta_qty DOUBLE PRECISION NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_inventory_ledger_once ON v3_inventory_ledger(approval_id, sku_code, reason)`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_qc_batches (
      id TEXT PRIMARY KEY,
      external_code TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      status TEXT NOT NULL,
      ticket_id TEXT,
      locked_at TEXT,
      hold_due_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(external_code, sku_code)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS v3_scan_records (
      id TEXT PRIMARY KEY,
      external_code TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      scanned_qty DOUBLE PRECISION NOT NULL,
      expected_qty DOUBLE PRECISION,
      result TEXT NOT NULL,
      matched_rule_id TEXT,
      rule_reason TEXT,
      qc_batch_id TEXT,
      ticket_id TEXT,
      operator_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_scan_records_external_sku ON v3_scan_records(external_code, sku_code, created_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_v3_scan_records_ticket ON v3_scan_records(ticket_id)`);

  const now = new Date().toISOString();

  const userCountRes = await db.execute(`SELECT COUNT(*) as cnt FROM v3_users`);
  const userCnt = Number((userCountRes.rows[0] as { cnt?: unknown } | undefined)?.cnt ?? 0);
  if (userCnt === 0) {
    const users = [
      { id: crypto.randomUUID(), name: "上报人A", roles: ["reporter"] },
      { id: crypto.randomUUID(), name: "一级审批A", roles: ["approver_l1"] },
      { id: crypto.randomUUID(), name: "二级审批A", roles: ["approver_l2"] },
      { id: crypto.randomUUID(), name: "品控主管A", roles: ["qc_supervisor"] },
      { id: crypto.randomUUID(), name: "管理员", roles: ["admin"] },
    ];
    for (const u of users) {
      await db.execute({
        sql: `INSERT INTO v3_users (id, name, roles_json, enabled, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: [u.id, u.name, JSON.stringify(u.roles), 1, now],
      });
    }
  }

  const approvalRuleCountRes = await db.execute(`SELECT COUNT(*) as cnt FROM v3_approval_rules`);
  const approvalRuleCnt = Number((approvalRuleCountRes.rows[0] as { cnt?: unknown } | undefined)?.cnt ?? 0);
  if (approvalRuleCnt === 0) {
    const rules = [
      { ticketType: "LOGISTICS", min: 0, max: 500, level: 1 },
      { ticketType: "LOGISTICS", min: 500.0000001, max: 2000, level: 2 },
      { ticketType: "LOGISTICS", min: 2000.0000001, max: null, level: 2 },
      { ticketType: "QC", min: 0, max: 1000, level: 1 },
      { ticketType: "QC", min: 1000.0000001, max: null, level: 2 },
    ];
    for (const r of rules) {
      await db.execute({
        sql: `INSERT INTO v3_approval_rules (id, ticket_type, min_amount, max_amount, target_level, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), r.ticketType, r.min, r.max, r.level, 1, now],
      });
    }
  }

  const qcRuleCountRes = await db.execute(`SELECT COUNT(*) as cnt FROM v3_qc_rules`);
  const qcRuleCnt = Number((qcRuleCountRes.rows[0] as { cnt?: unknown } | undefined)?.cnt ?? 0);
  if (qcRuleCnt === 0) {
    await db.execute({
      sql: `INSERT INTO v3_qc_rules (id, name, subtype, severity, enabled, condition_json, decision_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        "数量差异>=2%",
        "QTY_MISMATCH",
        1,
        1,
        JSON.stringify({ kind: "qty_diff_ratio", gte: 0.02 }),
        JSON.stringify({ result: "HOLD", targetLevel: 1 }),
        now,
      ],
    });
    await db.execute({
      sql: `INSERT INTO v3_qc_rules (id, name, subtype, severity, enabled, condition_json, decision_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        "数量差异>=10%",
        "QTY_MISMATCH",
        3,
        1,
        JSON.stringify({ kind: "qty_diff_ratio", gte: 0.1 }),
        JSON.stringify({ result: "HOLD", targetLevel: 2 }),
        now,
      ],
    });
  }
}

export async function ensureDb() {
  if (!ready) ready = migrate(getDbClient());
  await ready;
}

