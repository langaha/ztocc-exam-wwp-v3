"use client";

import { useState } from "react";

export function ScanForm() {
  const [externalCode, setExternalCode] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [scannedQty, setScannedQty] = useState("1");
  const [claimAmount, setClaimAmount] = useState("0");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  function formatScanError(error: unknown) {
    const text = String(error ?? "").trim();
    if (!text) return "提交失败，请稍后重试";
    if (text === "网络请求失败") return "网络请求失败，请稍后重试";
    if (text.startsWith("未查询到")) return text;
    return `失败：${text}`;
  }

  return (
    <section className="wt-card">
      <div className="wt-card-hd">
        <h1 className="wt-card-title">扫描品控</h1>
      </div>
      <div className="grid gap-3 px-4 py-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-sm text-ink-700">运单号 externalCode</span>
            <input className="wt-input" value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-ink-700">SKU</span>
            <input className="wt-input" value={skuCode} onChange={(e) => setSkuCode(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-ink-700">扫描数量 scannedQty</span>
            <input className="wt-input" value={scannedQty} onChange={(e) => setScannedQty(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-ink-700">预估追偿金额 claimAmount（可选）</span>
            <input className="wt-input" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} />
          </label>
        </div>

        {msg ? <div className="text-sm text-ink-700">{msg}</div> : null}

        <div className="flex items-center gap-2">
          <button
            className="wt-btn wt-btn-primary"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              setMsg("");
              try {
                const res = await fetch("/api/scan", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    externalCode,
                    skuCode,
                    scannedQty: Number(scannedQty),
                    claimAmount: Number(claimAmount),
                  }),
                });
                const j = (await res.json().catch(() => null)) as
                  | { error?: unknown; result?: unknown; ticketId?: unknown; existed?: unknown }
                  | null;
                if (!res.ok) {
                  setMsg(formatScanError(j?.error ?? res.status));
                  return;
                }
                if (j?.result === "PASS") {
                  setMsg("判定结果：通过（PASS）");
                } else {
                  const ticketId = String(j?.ticketId ?? "");
                  const existed = Boolean(j?.existed);
                  setMsg(`判定结果：暂扣（HOLD），${existed ? "复用已有工单" : "创建新工单"}：${ticketId}`);
                }
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "提交失败");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "提交中…" : "提交扫描"}
          </button>
        </div>

        <div className="wt-muted">
          需要先在 /login 登录（cookie session）。后端会实时调用 V2 校验 SKU 归属，并记录接口调用日志到 v3_api_call_logs。
        </div>
      </div>
    </section>
  );
}
