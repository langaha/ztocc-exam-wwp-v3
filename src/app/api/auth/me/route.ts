import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user }, { status: 200 });
}

