import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/auth";
import { resubmitTicket } from "@/lib/ticketService";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.enabled) return NextResponse.json({ error: "user disabled" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { description?: unknown; claimAmount?: unknown; expectedVersion?: unknown; idempotencyKey?: unknown }
    | null;

  const description = String(body?.description ?? "").trim();
  const claimAmount = Number(body?.claimAmount ?? NaN);
  const expectedVersion = Number(body?.expectedVersion ?? NaN);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim() || crypto.randomUUID();

  if (!description || !Number.isFinite(claimAmount) || claimAmount < 0 || !Number.isFinite(expectedVersion) || expectedVersion <= 0) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const result = await resubmitTicket({
    ticketId: id,
    actor: user,
    expectedVersion,
    description,
    claimAmount,
    idempotencyKey,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ticket: result.ticket, approvalId: result.approvalId, idempotent: result.idempotent });
}

