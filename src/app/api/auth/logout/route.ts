import { NextResponse } from "next/server";
import { ensureDb, getDbClient } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

export async function POST(req: Request) {
  await ensureDb();
  const cookie = String(req.headers.get("cookie") ?? "");
  const m = cookie.match(/(?:^|;\s*)v3_session=([^;]+)/);
  const token = decodeURIComponent(String(m?.[1] ?? "").trim());

  if (token) {
    const tokenHash = sha256Hex(token);
    const db = getDbClient();
    await db.execute({ sql: `DELETE FROM v3_sessions WHERE token_hash = ?`, args: [tokenHash] });
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set("v3_session", "", { httpOnly: true, path: "/", expires: new Date(0) });
  return res;
}

