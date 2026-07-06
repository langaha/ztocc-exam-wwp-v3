"use client";

import { useMemo, useState } from "react";

type QcRuleItem = {
  id: string;
  name: string;
  subtype: string;
  severity: number;
  enabled: boolean;
  conditionJsonText: string;
  decisionJsonText: string;
  updatedAt: string;
};

const defaultCondition = `{
  "kind": "qty_diff_ratio",
  "gte": 0.02
}`;

const defaultDecision = `{
  "result": "HOLD",
  "targetLevel": 1
}`;

export function QcRulesClient(props: { initialRules: QcRuleItem[] }) {
  const [rules, setRules] = useState(props.initialRules);
  const [editingId, setEditingId] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState("");
  const editingRule = useMemo(() => rules.find((it) => it.id === editingId) ?? null, [rules, editingId]);

  const [form, setForm] = useState({
    name: "",
    subtype: "QTY_MISMATCH",
    severity: "1",
    enabled: true,
    conditionJsonText: defaultCondition,
    decisionJsonText: defaultDecision,
  });

  function resetForm() {
    setEditingId("");
    setForm({
      name: "",
      subtype: "QTY_MISMATCH",
      severity: "1",
      enabled: true,
      conditionJsonText: defaultCondition,
      decisionJsonText: defaultDecision,
    });
  }

  async function reloadRules() {
    const res = await fetch("/api/admin/qc-rules");
    const json = (await res.json().catch(() => null)) as { list?: QcRuleItem[]; error?: unknown } | null;
    if (!res.ok) throw new Error(String(json?.error ?? res.status));
    setRules(Array.isArray(json?.list) ? json.list : []);
  }

  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">品控规则管理</h1>
          <div className="wt-muted">调整后，扫描接口会直接按新规则执行，不需要改代码。</div>
        </div>
        <div className="grid gap-3 px-4 py-4">
          {msg ? <div className="text-sm text-ink-700">{msg}</div> : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">规则名</span>
              <input className="wt-input" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">异常子类型</span>
              <input className="wt-input" value={form.subtype} onChange={(e) => setForm((s) => ({ ...s, subtype: e.target.value }))} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-ink-700">严重度</span>
              <input className="wt-input" value={form.severity} onChange={(e) => setForm((s) => ({ ...s, severity: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 pt-7 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
              />
              启用规则
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-sm text-ink-700">条件 JSON（condition_json）</span>
            <textarea
              className="wt-input min-h-32 font-mono"
              value={form.conditionJsonText}
              onChange={(e) => setForm((s) => ({ ...s, conditionJsonText: e.target.value }))}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-ink-700">决策 JSON（decision_json）</span>
            <textarea
              className="wt-input min-h-28 font-mono"
              value={form.decisionJsonText}
              onChange={(e) => setForm((s) => ({ ...s, decisionJsonText: e.target.value }))}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              className="wt-btn wt-btn-primary"
              disabled={loading === "save"}
              onClick={async () => {
                setLoading("save");
                setMsg("");
                try {
                  const payload = {
                    ...form,
                    severity: Number(form.severity),
                  };
                  const res = await fetch(editingId ? `/api/admin/qc-rules/${editingId}` : "/api/admin/qc-rules", {
                    method: editingId ? "PUT" : "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
                  if (!res.ok) {
                    setMsg(`保存失败：${String(json?.error ?? res.status)}`);
                    return;
                  }
                  await reloadRules();
                  setMsg(editingId ? "规则更新成功" : "规则创建成功");
                  resetForm();
                } finally {
                  setLoading("");
                }
              }}
            >
              {loading === "save" ? "保存中…" : editingId ? "更新规则" : "新建规则"}
            </button>
            <button className="wt-btn" onClick={resetForm}>
              清空
            </button>
          </div>
        </div>
      </section>

      <section className="wt-card">
        <div className="wt-card-hd">
          <h2 className="wt-card-title">规则列表</h2>
          <div className="wt-muted">当前共 {rules.length} 条</div>
        </div>
        <div className="overflow-auto">
          <table className="wt-table">
            <thead>
              <tr>
                <th className="wt-th">规则名</th>
                <th className="wt-th">子类型</th>
                <th className="wt-th">严重度</th>
                <th className="wt-th">启用</th>
                <th className="wt-th">条件</th>
                <th className="wt-th">决策</th>
                <th className="wt-th">更新时间</th>
                <th className="wt-th">操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="wt-td">{rule.name}</td>
                  <td className="wt-td">{rule.subtype}</td>
                  <td className="wt-td">{rule.severity}</td>
                  <td className="wt-td">{rule.enabled ? "启用" : "禁用"}</td>
                  <td className="wt-td max-w-[260px] whitespace-pre-wrap break-all font-mono text-xs">{rule.conditionJsonText}</td>
                  <td className="wt-td max-w-[260px] whitespace-pre-wrap break-all font-mono text-xs">{rule.decisionJsonText}</td>
                  <td className="wt-td whitespace-nowrap">{rule.updatedAt}</td>
                  <td className="wt-td">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="wt-btn"
                        onClick={() => {
                          setEditingId(rule.id);
                          setForm({
                            name: rule.name,
                            subtype: rule.subtype,
                            severity: String(rule.severity),
                            enabled: rule.enabled,
                            conditionJsonText: rule.conditionJsonText,
                            decisionJsonText: rule.decisionJsonText,
                          });
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="wt-btn"
                        disabled={loading === rule.id}
                        onClick={async () => {
                          if (!window.confirm(`确认删除规则「${rule.name}」吗？`)) return;
                          setLoading(rule.id);
                          setMsg("");
                          try {
                            const res = await fetch(`/api/admin/qc-rules/${rule.id}`, { method: "DELETE" });
                            const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
                            if (!res.ok) {
                              setMsg(`删除失败：${String(json?.error ?? res.status)}`);
                              return;
                            }
                            await reloadRules();
                            if (editingRule?.id === rule.id) resetForm();
                            setMsg("规则删除成功");
                          } finally {
                            setLoading("");
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td className="wt-td" colSpan={8}>
                    暂无规则
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

