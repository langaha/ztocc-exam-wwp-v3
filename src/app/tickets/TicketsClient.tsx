"use client";

import Link from "next/link";
import { useState } from "react";

type CurrentUser = {
  id: string;
  name: string;
  roles: string[];
};

type TicketItem = {
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
  reporterName?: string | null;
  assignedL1Name?: string | null;
  assignedL2Name?: string | null;
  dueAt: string | null;
  version: number;
  createdAt: string;
};

function genIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

function isDueSoon(dueAt: string | null) {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  return due > now && due - now <= 60 * 60 * 1000;
}

export function TicketsClient(props: {
  currentUser: CurrentUser;
  tickets: TicketItem[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const [externalCode, setExternalCode] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [subtype, setSubtype] = useState("LOST");
  const [description, setDescription] = useState("");
  const [claimAmount, setClaimAmount] = useState("0");
  const [msg, setMsg] = useState("");
  const [loadingId, setLoadingId] = useState("");

  type ApiJson = { error?: unknown; ticket?: { id?: unknown } | null };

  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">异常工单</h1>
          <div className="wt-muted">
            当前用户：{props.currentUser.name}（{props.currentUser.roles.join(", ")}）
          </div>
        </div>
        <div className="grid gap-3 px-4 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">运单号</span>
              <input className="wt-input" value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">SKU（可选）</span>
              <input className="wt-input" value={skuCode} onChange={(e) => setSkuCode(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">物流异常类型</span>
              <select className="wt-select" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                <option value="LOST">丢件</option>
                <option value="DAMAGED">破损</option>
                <option value="REFUSED">客户拒收</option>
                <option value="TIMEOUT">超时未签收</option>
                <option value="ADDRESS_ERROR">收货地址错误</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">理赔金额</span>
              <input className="wt-input" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-sm text-ink-700">异常描述</span>
            <textarea className="wt-input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {msg ? <div className="text-sm text-ink-700">{msg}</div> : null}
          <div className="flex items-center gap-2">
            <button
              className="wt-btn wt-btn-primary"
              onClick={async () => {
                setMsg("");
                setLoadingId("create");
                try {
                  const res = await fetch("/api/tickets", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      externalCode,
                      skuCode,
                      subtype,
                      description,
                      claimAmount: Number(claimAmount),
                    }),
                  });
                  const j = (await res.json().catch(() => null)) as ApiJson | null;
                  if (!res.ok) {
                    setMsg(`上报失败：${String(j?.error ?? res.status)}`);
                    return;
                  }
                  setMsg(`上报成功：${String(j?.ticket?.id ?? "")}`);
                  window.location.reload();
                } finally {
                  setLoadingId("");
                }
              }}
              disabled={loadingId === "create"}
            >
              {loadingId === "create" ? "提交中…" : "手工上报"}
            </button>
          </div>
        </div>
      </section>

      <section className="wt-card">
        <div className="wt-card-hd">
          <h2 className="wt-card-title">工单列表</h2>
          <div className="wt-muted">
            共 {props.total} 条，当前第 {props.page} 页，每页 {props.pageSize} 条
          </div>
        </div>
        <div className="overflow-auto">
          <table className="wt-table">
            <thead>
              <tr>
                <th className="wt-th">工单</th>
                <th className="wt-th">类型</th>
                <th className="wt-th">运单/SKU</th>
                <th className="wt-th">金额</th>
                <th className="wt-th">状态</th>
                <th className="wt-th">处理人</th>
                <th className="wt-th">到期</th>
                <th className="wt-th">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="wt-td">
                    <div className="font-medium">
                      <Link href={`/tickets/${ticket.id}`} className="text-brand-700 hover:text-brand-900">
                        {ticket.id.slice(0, 8)}
                      </Link>
                    </div>
                    <div className="wt-muted">{ticket.description ?? ""}</div>
                  </td>
                  <td className="wt-td">
                    <div>{ticket.type}</div>
                    <div className="wt-muted">{ticket.subtype ?? "-"}</div>
                  </td>
                  <td className="wt-td">
                    <div>{ticket.externalCode}</div>
                    <div className="wt-muted">{ticket.skuCode ?? "-"}</div>
                  </td>
                  <td className="wt-td">{ticket.claimAmount}</td>
                  <td className="wt-td">
                    <div className={isDueSoon(ticket.dueAt) ? "font-medium text-amber-700" : ""}>{ticket.status}</div>
                  </td>
                  <td className="wt-td">
                    <div>L1: {ticket.assignedL1Name ?? "-"}</div>
                    <div className="wt-muted">L2: {ticket.assignedL2Name ?? "-"}</div>
                  </td>
                  <td className="wt-td">
                    <div className={isDueSoon(ticket.dueAt) ? "font-medium text-amber-700" : ""}>{ticket.dueAt ?? "-"}</div>
                  </td>
                  <td className="wt-td">
                    <div className="flex flex-wrap gap-2">
                      {(ticket.status === "L1_APPROVING" || ticket.status === "L2_APPROVING") ? (
                        <>
                          <button
                            className="wt-btn wt-btn-primary"
                            disabled={loadingId === ticket.id}
                            onClick={async () => {
                              const comment = window.prompt("审批意见", "通过");
                              if (comment === null) return;
                              setLoadingId(ticket.id);
                              try {
                                const res = await fetch(`/api/tickets/${ticket.id}/approve`, {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    action: "APPROVE",
                                    comment,
                                    expectedVersion: ticket.version,
                                    idempotencyKey: genIdempotencyKey(),
                                  }),
                                });
                                const j = (await res.json().catch(() => null)) as ApiJson | null;
                                if (!res.ok) {
                                  alert(`通过失败：${String(j?.error ?? res.status)}`);
                                  return;
                                }
                                window.location.reload();
                              } finally {
                                setLoadingId("");
                              }
                            }}
                          >
                            通过
                          </button>
                          <button
                            className="wt-btn"
                            disabled={loadingId === ticket.id}
                            onClick={async () => {
                              const comment = window.prompt("拒绝原因", "请补充材料");
                              if (comment === null) return;
                              setLoadingId(ticket.id);
                              try {
                                const res = await fetch(`/api/tickets/${ticket.id}/approve`, {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    action: "REJECT",
                                    comment,
                                    expectedVersion: ticket.version,
                                    idempotencyKey: genIdempotencyKey(),
                                  }),
                                });
                                const j = (await res.json().catch(() => null)) as ApiJson | null;
                                if (!res.ok) {
                                  alert(`拒绝失败：${String(j?.error ?? res.status)}`);
                                  return;
                                }
                                window.location.reload();
                              } finally {
                                setLoadingId("");
                              }
                            }}
                          >
                            拒绝
                          </button>
                        </>
                      ) : null}

                      {ticket.type === "QC" && props.currentUser.roles.includes("qc_supervisor") ? (
                        <button
                          className="wt-btn"
                          disabled={loadingId === ticket.id}
                          onClick={async () => {
                            const reason = window.prompt("快速放行原因", "误判，允许放行");
                            if (reason === null || !reason.trim()) return;
                            setLoadingId(ticket.id);
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
                              const j = (await res.json().catch(() => null)) as ApiJson | null;
                              if (!res.ok) {
                                alert(`快速放行失败：${String(j?.error ?? res.status)}`);
                                return;
                              }
                              window.location.reload();
                            } finally {
                              setLoadingId("");
                            }
                          }}
                        >
                          快速放行
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {props.tickets.length === 0 ? (
                <tr>
                  <td className="wt-td" colSpan={8}>
                    暂无工单
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
