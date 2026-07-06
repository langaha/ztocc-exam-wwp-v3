import { ensureDb, getDbClient } from "@/lib/db";

export type QcRule = {
  id: string;
  name: string;
  subtype: string;
  severity: number;
  enabled: boolean;
  conditionJsonText: string;
  decisionJsonText: string;
  updatedAt: string;
};

function mapQcRule(row: Record<string, unknown>): QcRule {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    subtype: String(row.subtype ?? ""),
    severity: Number(row.severity ?? 0),
    enabled: Number(row.enabled ?? 0) === 1,
    conditionJsonText: String(row.condition_json ?? "{}"),
    decisionJsonText: String(row.decision_json ?? "{}"),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function assertValidJsonText(text: string, fieldName: string) {
  try {
    JSON.parse(text);
  } catch {
    throw new Error(`${fieldName} 不是合法 JSON`);
  }
}

export async function listQcRules() {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute(`
    SELECT id, name, subtype, severity, enabled, condition_json, decision_json, updated_at
    FROM v3_qc_rules
    ORDER BY enabled DESC, severity DESC, updated_at DESC
  `);
  return res.rows.map((row) => mapQcRule(row));
}

export async function getQcRuleById(id: string) {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute({
    sql: `
      SELECT id, name, subtype, severity, enabled, condition_json, decision_json, updated_at
      FROM v3_qc_rules
      WHERE id = ?
      LIMIT 1
    `,
    args: [id],
  });
  const row = res.rows[0];
  return row ? mapQcRule(row) : null;
}

export async function createQcRule(args: {
  name: string;
  subtype: string;
  severity: number;
  enabled: boolean;
  conditionJsonText: string;
  decisionJsonText: string;
}) {
  await ensureDb();
  assertValidJsonText(args.conditionJsonText, "conditionJson");
  assertValidJsonText(args.decisionJsonText, "decisionJson");

  const db = getDbClient();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO v3_qc_rules (id, name, subtype, severity, enabled, condition_json, decision_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      args.name.trim(),
      args.subtype.trim(),
      args.severity,
      args.enabled ? 1 : 0,
      args.conditionJsonText,
      args.decisionJsonText,
      now,
    ],
  });
  return getQcRuleById(id);
}

export async function updateQcRule(args: {
  id: string;
  name: string;
  subtype: string;
  severity: number;
  enabled: boolean;
  conditionJsonText: string;
  decisionJsonText: string;
}) {
  await ensureDb();
  assertValidJsonText(args.conditionJsonText, "conditionJson");
  assertValidJsonText(args.decisionJsonText, "decisionJson");

  const db = getDbClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      UPDATE v3_qc_rules
      SET name = ?, subtype = ?, severity = ?, enabled = ?, condition_json = ?, decision_json = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [
      args.name.trim(),
      args.subtype.trim(),
      args.severity,
      args.enabled ? 1 : 0,
      args.conditionJsonText,
      args.decisionJsonText,
      now,
      args.id,
    ],
  });
  return getQcRuleById(args.id);
}

export async function deleteQcRule(id: string) {
  await ensureDb();
  const db = getDbClient();
  await db.execute({
    sql: `DELETE FROM v3_qc_rules WHERE id = ?`,
    args: [id],
  });
}

