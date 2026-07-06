import { NextResponse } from "next/server";
import { ensureDb, getDbClient } from "@/lib/db";
import { newToken, sha256Hex } from "@/lib/crypto";

export async function POST(req: Request) {
  await ensureDb();
  const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = String(body?.userId ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const db = getDbClient();
  const userRes = await db.execute({
    sql: `SELECT id, enabled FROM v3_users WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  const row = userRes.rows[0] as { id?: unknown; enabled?: unknown } | undefined;
  if (!row) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (Number(row.enabled ?? 0) !== 1) return NextResponse.json({ error: "user disabled" }, { status: 403 });

  const token = newToken();
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.execute({
    sql: `INSERT INTO v3_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), userId, tokenHash, expiresAt, now.toISOString()],
  });

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set("v3_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: String(process.env.NODE_ENV ?? "").toLowerCase() === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
  return res;
}

