import { cookies } from "next/headers";
import { ensureDb, getDbClient } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

export type SessionUser = {
  id: string;
  name: string;
  roles: string[];
  enabled: boolean;
};

export async function getServerSessionUser(): Promise<SessionUser | null> {
  const token = String((await cookies()).get("v3_session")?.value ?? "").trim();
  if (!token) return null;
  return getSessionUserByToken(token);
}

export async function getSessionUserFromRequest(req: Request): Promise<SessionUser | null> {
  const cookie = String(req.headers.get("cookie") ?? "");
  const m = cookie.match(/(?:^|;\s*)v3_session=([^;]+)/);
  const token = decodeURIComponent(String(m?.[1] ?? "").trim());
  if (!token) return null;
  return getSessionUserByToken(token);
}

async function getSessionUserByToken(token: string): Promise<SessionUser | null> {
  await ensureDb();
  const tokenHash = sha256Hex(token);
  const db = getDbClient();
  const now = new Date().toISOString();
  const res = await db.execute({
    sql: `
      SELECT
        u.id as user_id,
        u.name as user_name,
        u.roles_json,
        u.enabled
      FROM v3_sessions s
      JOIN v3_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
      LIMIT 1
    `,
    args: [tokenHash, now],
  });
  const row = res.rows[0] as { user_id?: unknown; user_name?: unknown; roles_json?: unknown; enabled?: unknown } | undefined;
  if (!row) return null;

  const enabled = Number(row.enabled ?? 0) === 1;
  let roles: string[] = [];
  try {
    roles = JSON.parse(String(row.roles_json ?? "[]")) as string[];
  } catch {
    roles = [];
  }

  return {
    id: String(row.user_id ?? ""),
    name: String(row.user_name ?? ""),
    roles: Array.isArray(roles) ? roles.map((x) => String(x)) : [],
    enabled,
  };
}

export function hasRole(user: SessionUser | null, role: string) {
  if (!user) return false;
  return user.roles.includes(role);
}

