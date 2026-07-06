import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/auth";
import { deleteQcRule, getQcRuleById, updateQcRule } from "@/lib/qcRuleService";

function isAdmin(roles: string[]) {
  return roles.includes("admin");
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const rule = await getQcRuleById(id);
  if (!rule) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  return NextResponse.json({ rule }, { status: 200 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.enabled) return NextResponse.json({ error: "user disabled" }, { status: 403 });
  if (!isAdmin(user.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | {
        name?: unknown;
        subtype?: unknown;
        severity?: unknown;
        enabled?: unknown;
        conditionJsonText?: unknown;
        decisionJsonText?: unknown;
      }
    | null;

  const name = String(body?.name ?? "").trim();
  const subtype = String(body?.subtype ?? "").trim();
  const severity = Number(body?.severity ?? NaN);
  const enabled = Boolean(body?.enabled);
  const conditionJsonText = String(body?.conditionJsonText ?? "").trim();
  const decisionJsonText = String(body?.decisionJsonText ?? "").trim();

  if (!name || !subtype || !Number.isFinite(severity) || !conditionJsonText || !decisionJsonText) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  try {
    const rule = await updateQcRule({
      id,
      name,
      subtype,
      severity,
      enabled,
      conditionJsonText,
      decisionJsonText,
    });
    if (!rule) return NextResponse.json({ error: "rule not found" }, { status: 404 });
    return NextResponse.json({ ok: true, rule }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.enabled) return NextResponse.json({ error: "user disabled" }, { status: 403 });
  if (!isAdmin(user.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  await deleteQcRule(id);
  return NextResponse.json({ ok: true }, { status: 200 });
}

