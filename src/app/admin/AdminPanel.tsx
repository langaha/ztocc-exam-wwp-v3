"use client";

import Link from "next/link";
import { useState } from "react";

export function AdminPanel() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState("");

  return (
    <section className="wt-card">
      <div className="wt-card-hd">
        <h1 className="wt-card-title">后台配置</h1>
      </div>
      <div className="grid gap-3 px-4 py-4">
        <div className="wt-muted">当前提供两类运营动作：批量造数、手工触发 cron 流转。</div>
        {msg ? <div className="text-sm text-ink-700">{msg}</div> : null}
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/qc-rules" className="wt-btn">
            打开品控规则管理
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="wt-btn wt-btn-primary"
            disabled={loading === "seed"}
            onClick={async () => {
              setLoading("seed");
              setMsg("");
              try {
                const res = await fetch("/api/admin/seed", { method: "POST" });
                const j = (await res.json().catch(() => null)) as { error?: unknown; created?: unknown } | null;
                if (!res.ok) {
                  setMsg(`造数失败：${String(j?.error ?? res.status)}`);
                  return;
                }
                setMsg(`造数完成：${String(j?.created ?? 0)} 条`);
              } finally {
                setLoading("");
              }
            }}
          >
            {loading === "seed" ? "执行中…" : "生成 200 条工单"}
          </button>

          <button
            className="wt-btn"
            disabled={loading === "cron"}
            onClick={async () => {
              const secret = window.prompt("输入 CRON_SECRET");
              if (!secret) return;
              setLoading("cron");
              setMsg("");
              try {
                const res = await fetch("/api/cron", {
                  method: "POST",
                  headers: { "x-cron-secret": secret },
                });
                const j = (await res.json().catch(() => null)) as
                  | { error?: unknown; escalated?: unknown; autoRejected?: unknown; qcEscalated?: unknown; reassigned?: unknown }
                  | null;
                if (!res.ok) {
                  setMsg(`cron 失败：${String(j?.error ?? res.status)}`);
                  return;
                }
                setMsg(
                  `cron 完成：升级 ${String(j?.escalated ?? 0)}，自动驳回 ${String(j?.autoRejected ?? 0)}，品控升级 ${String(
                    j?.qcEscalated ?? 0
                  )}，兜底转交 ${String(j?.reassigned ?? 0)}`
                );
              } finally {
                setLoading("");
              }
            }}
          >
            {loading === "cron" ? "执行中…" : "手工触发 cron"}
          </button>
        </div>
      </div>
    </section>
  );
}
