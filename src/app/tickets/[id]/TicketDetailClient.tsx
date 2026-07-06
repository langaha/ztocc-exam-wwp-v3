"use client";

import Link from "next/link";
import { useState } from "react";

type CurrentUser = {
  id: string;
  name: string;
  roles: string[];
};

type Ticket = {
  id: string;
  source: string;
  type: string;
  subtype: string | null;
  externalCode: string;
  skuCode: string | null;
  description: string | null;
  claimAmount: number;
  status: string;
  currentLevel: number;
  reporterUserId: string;
  assignedL1UserId: string | null;
  assignedL2UserId: string | null;
  resubmitCount: number;
  dueAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type Snapshot = {
  externalCode: string;
  receiverStore: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  estimatedAmount: number | null;
  v2CreatedAt: string | null;
  fetchedFromV2At: string;
  v2RequestId: string | null;
} | null;

type Approval = {
  id: string;
  level: number;
  actorUserId: string;
  actorName: string | null;
  action: string;
  comment: string | null;
  createdAt: string;
};

function genIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

export function TicketDetailClient(props: {
  currentUser: CurrentUser;
  ticket: Ticket;
  snapshot: Snapshot;
  approvals: Approval[];
}) {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState("");

  const ticket = props.ticket;

  async function submitApproval(action: "APPROVE" | "REJECT") {
    const comment = window.prompt(action === "APPROVE" ? "审批意见" : "拒绝原因", action === "APPROVE" ? "通过" : "请补充材料");
    if (comment === null) return;
    setLoading(action);
    setMsg("");
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          comment,
          expectedVersion: ticket.version,
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setMsg(`操作失败：${String(j?.error ?? res.status)}`);
        return;
      }
      window.location.reload();
    } finally {
      setLoading("");
    }
  }

  async function submitFastRelease() {
    const reason = window.prompt("快速放行原因", "误判，允许放行");
    if (reason === null || !reason.trim()) return;
    setLoading("FAST_RELEASE");
    setMsg("");
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/fast-release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason,
          expectedVersion: ticket.version,
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setMsg(`快速放行失败：${String(j?.error ?? res.status)}`);
        return;
      }
      window.location.reload();
    } finally {
      setLoading("");
    }
  }

  async function submitResubmit() {
    const description = window.prompt("重提说明", ticket.description ?? "补充材料后重新提交");
    if (description === null || !description.trim()) return;
    const claimAmountText = window.prompt("新的理赔金额", String(ticket.claimAmount));
    if (claimAmountText === null) return;
    const claimAmount = Number(claimAmountText);
    if (!Number.isFinite(claimAmount) || claimAmount < 0) {
      setMsg("理赔金额无效");
      return;
    }
    setLoading("RESUBMIT");
    setMsg("");
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/resubmit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          claimAmount,
          expectedVersion: ticket.version,
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setMsg(`重提失败：${String(j?.error ?? res.status)}`);
        return;
      }
      window.location.reload();
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <div>
            <h1 className="wt-card-title">工单详情</h1>
            <div className="wt-muted">{ticket.id}</div>
          </div>
          <Link href="/tickets" className="wt-btn">
            返回列表
          </Link>
        </div>
        <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
          <div className="grid gap-2">
            <div><span className="font-medium">状态：</span>{ticket.status}</div>
            <div><span className="font-medium">类型：</span>{ticket.type} / {ticket.subtype ?? "-"}</div>
            <div><span className="font-medium">来源：</span>{ticket.source}</div>
            <div><span className="font-medium">运单号：</span>{ticket.externalCode}</div>
            <div><span className="font-medium">SKU：</span>{ticket.skuCode ?? "-"}</div>
            <div><span className="font-medium">金额：</span>{ticket.claimAmount}</div>
            <div><span className="font-medium">重提次数：</span>{ticket.resubmitCount}</div>
            <div><span className="font-medium">到期时间：</span>{ticket.dueAt ?? "-"}</div>
          </div>
          <div className="grid gap-2">
            <div><span className="font-medium">描述：</span>{ticket.description ?? "-"}</div>
            <div><span className="font-medium">创建时间：</span>{ticket.createdAt}</div>
            <div><span className="font-medium">更新时间：</span>{ticket.updatedAt}</div>
            <div><span className="font-medium">当前用户：</span>{props.currentUser.name}（{props.currentUser.roles.join(", ")}）</div>
          </div>
        </div>
        {msg ? <div className="px-4 pb-4 text-sm text-rose-700">{msg}</div> : null}
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {(ticket.status === "L1_APPROVING" || ticket.status === "L2_APPROVING") ? (
            <>
              <button className="wt-btn wt-btn-primary" disabled={Boolean(loading)} onClick={() => submitApproval("APPROVE")}>
                {loading === "APPROVE" ? "提交中…" : "审批通过"}
              </button>
              <button className="wt-btn" disabled={Boolean(loading)} onClick={() => submitApproval("REJECT")}>
                {loading === "REJECT" ? "提交中…" : "审批拒绝"}
              </button>
            </>
          ) : null}
          {ticket.type === "QC" && props.currentUser.roles.includes("qc_supervisor") && ticket.status !== "DONE" ? (
            <button className="wt-btn" disabled={Boolean(loading)} onClick={submitFastRelease}>
              {loading === "FAST_RELEASE" ? "提交中…" : "快速放行"}
            </button>
          ) : null}
          {ticket.status === "REJECTED_NEED_RESUBMIT" && props.currentUser.id === ticket.reporterUserId ? (
            <button className="wt-btn wt-btn-primary" disabled={Boolean(loading)} onClick={submitResubmit}>
              {loading === "RESUBMIT" ? "提交中…" : "重提"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="wt-card">
        <div className="wt-card-hd">
          <h2 className="wt-card-title">运单快照</h2>
          <div className="wt-muted">
            {props.snapshot ? `使用本地快照，同步于 ${props.snapshot.fetchedFromV2At}` : "暂无快照"}
          </div>
        </div>
        <div className="grid gap-2 px-4 py-4 md:grid-cols-2">
          <div><span className="font-medium">门店：</span>{props.snapshot?.receiverStore ?? "-"}</div>
          <div><span className="font-medium">收件人：</span>{props.snapshot?.receiverName ?? "-"}</div>
          <div><span className="font-medium">电话：</span>{props.snapshot?.receiverPhone ?? "-"}</div>
          <div><span className="font-medium">地址：</span>{props.snapshot?.receiverAddress ?? "-"}</div>
          <div><span className="font-medium">预估金额：</span>{props.snapshot?.estimatedAmount ?? "-"}</div>
          <div><span className="font-medium">V2 RequestId：</span>{props.snapshot?.v2RequestId ?? "-"}</div>
        </div>
      </section>

      <section className="wt-card">
        <div className="wt-card-hd">
          <h2 className="wt-card-title">审批历史</h2>
        </div>
        <div className="overflow-auto">
          <table className="wt-table">
            <thead>
              <tr>
                <th className="wt-th">时间</th>
                <th className="wt-th">层级</th>
                <th className="wt-th">动作</th>
                <th className="wt-th">操作人</th>
                <th className="wt-th">意见</th>
              </tr>
            </thead>
            <tbody>
              {props.approvals.map((approval) => (
                <tr key={approval.id}>
                  <td className="wt-td whitespace-nowrap">{approval.createdAt}</td>
                  <td className="wt-td whitespace-nowrap">{approval.level}</td>
                  <td className="wt-td whitespace-nowrap">{approval.action}</td>
                  <td className="wt-td whitespace-nowrap">{approval.actorName ?? approval.actorUserId}</td>
                  <td className="wt-td">{approval.comment ?? "-"}</td>
                </tr>
              ))}
              {props.approvals.length === 0 ? (
                <tr>
                  <td className="wt-td" colSpan={5}>
                    暂无审批历史
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

