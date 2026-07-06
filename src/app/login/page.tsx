import { ensureDb, getDbClient } from "@/lib/db";
import { LoginForm, type LoginUserOption } from "@/app/login/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await ensureDb();
  const db = getDbClient();
  const res = await db.execute(`SELECT id, name, roles_json, enabled FROM v3_users ORDER BY created_at ASC`);
  const users: LoginUserOption[] = res.rows.map((r) => {
    const row = r as { id?: unknown; name?: unknown; roles_json?: unknown; enabled?: unknown };
    let roles: string[] = [];
    try {
      roles = JSON.parse(String(row.roles_json ?? "[]")) as string[];
    } catch {
      roles = [];
    }
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      roles: Array.isArray(roles) ? roles.map((x) => String(x)) : [],
      enabled: Number(row.enabled ?? 0) === 1,
    };
  });

  return <LoginForm users={users} />;
}
