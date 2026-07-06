import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/auth";
import { fetchAndUpsertWaybillSnapshot } from "@/lib/waybillSnapshot";
import { callV2Json } from "@/lib/v2Client";
import { createManualTicket, findOpenSameTypeTicket, listTickets } from "@/lib/ticketService";

function toPositiveInt(v: string | null, fallback: number, max: number) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

export async function GET(req: Request) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = String(url.searchParams.get("status") ?? "").trim() || undefined;
  const type = String(url.searchParams.get("type") ?? "").trim() || undefined;
  const externalCode = String(url.searchParams.get("externalCode") ?? "").trim() || undefined;
  const assignedToMe = String(url.searchParams.get("assignedToMe") ?? "").trim() === "1";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 100000);
  const pageSize = toPositiveInt(url.searchParams.get("pageSize"), 20, 100);

  const data = await listTickets({
    status,
    type,
    externalCode,
    assignedUserId: assignedToMe ? user.id : undefined,
    page,
    pageSize,
  });

  return NextResponse.json({ ...data, page, pageSize }, { status: 200 });
}

export async function POST(req: Request) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.enabled) return NextResponse.json({ error: "user disabled" }, { status: 403 });
  if (!user.roles.includes("reporter")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { externalCode?: unknown; skuCode?: unknown; subtype?: unknown; description?: unknown; claimAmount?: unknown }
    | null;
  const externalCode = String(body?.externalCode ?? "").trim();
  const skuCode = String(body?.skuCode ?? "").trim() || null;
  const subtype = String(body?.subtype ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const claimAmount = Number(body?.claimAmount ?? NaN);

  if (!externalCode || !subtype || !description || !Number.isFinite(claimAmount) || claimAmount < 0) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const waybillRes = await callV2Json<{ waybill?: unknown }>({
    apiName: "waybills.get",
    method: "GET",
    path: `/api/v3-bridge/waybills/${encodeURIComponent(externalCode)}`,
    requestSummary: JSON.stringify({ externalCode }),
  });
  if (!waybillRes.ok) {
    return NextResponse.json({ error: "v2 call failed", requestId: waybillRes.requestId }, { status: 502 });
  }
  if (!(waybillRes.data as { waybill?: unknown } | null)?.waybill) {
    return NextResponse.json({ error: "waybill not found" }, { status: 404 });
  }

  await fetchAndUpsertWaybillSnapshot(externalCode);

  const existed = await findOpenSameTypeTicket({
    externalCode,
    type: "LOGISTICS",
    subtype,
  });
  if (existed) {
    return NextResponse.json(
      { error: "same type open ticket exists", ticketId: existed.id, status: existed.status },
      { status: 409 }
    );
  }

  const ticket = await createManualTicket({
    externalCode,
    skuCode,
    subtype,
    description,
    claimAmount,
    reporterUserId: user.id,
  });

  return NextResponse.json({ ok: true, ticket }, { status: 200 });
}

