import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/auth";
import { getTicketDetail } from "@/lib/ticketService";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const detail = await getTicketDetail(id);
  if (!detail) return NextResponse.json({ error: "ticket not found" }, { status: 404 });

  return NextResponse.json(detail, { status: 200 });
}
