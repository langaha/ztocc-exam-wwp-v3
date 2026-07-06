import { ensureDb, getDbClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  await ensureDb();
  const db = getDbClient();
  const recentRes = await db.execute(
    `SELECT request_id, api_name, method, response_status, duration_ms, ok, error_message, created_at FROM v3_api_call_logs ORDER BY created_at DESC LIMIT 50`
  );
  const statRes = await db.execute(`SELECT COUNT(*) as total, SUM(ok) as ok FROM v3_api_call_logs`);
  const statRow = statRes.rows[0] as { total?: unknown; ok?: unknown } | undefined;
  const total = Number(statRow?.total ?? 0);
  const ok = Number(statRow?.ok ?? 0);
  const rate = total > 0 ? Math.round((ok / total) * 1000) / 10 : 0;

  const rows = recentRes.rows.map((r) => {
    const row = r as {
      request_id?: unknown;
      api_name?: unknown;
      method?: unknown;
      response_status?: unknown;
      duration_ms?: unknown;
      ok?: unknown;
      error_message?: unknown;
      created_at?: unknown;
    };
    return {
      requestId: String(row.request_id ?? ""),
      apiName: String(row.api_name ?? ""),
      method: String(row.method ?? ""),
      status: row.response_status ?? null,
      durationMs: Number(row.duration_ms ?? 0),
      ok: Number(row.ok ?? 0) === 1,
      errorMessage: row.error_message ?? null,
      createdAt: String(row.created_at ?? ""),
    };
  });

  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">接口监控</h1>
          <div className="wt-muted">
            累计成功率：{rate}%（{ok}/{total}）
          </div>
        </div>
        <div className="overflow-auto">
          <table className="wt-table">
            <thead>
              <tr>
                <th className="wt-th">时间</th>
                <th className="wt-th">API</th>
                <th className="wt-th">状态</th>
                <th className="wt-th">耗时</th>
                <th className="wt-th">RequestId</th>
                <th className="wt-th">错误</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.createdAt}-${r.requestId}`}>
                  <td className="wt-td whitespace-nowrap">{r.createdAt}</td>
                  <td className="wt-td whitespace-nowrap">
                    {r.method} {r.apiName}
                  </td>
                  <td className="wt-td whitespace-nowrap">
                    <span className={r.ok ? "text-emerald-700" : "text-rose-700"}>{String(r.status ?? "")}</span>
                  </td>
                  <td className="wt-td whitespace-nowrap">{r.durationMs}ms</td>
                  <td className="wt-td whitespace-nowrap font-mono text-xs">{r.requestId}</td>
                  <td className="wt-td max-w-[380px] truncate">{r.errorMessage ? String(r.errorMessage) : ""}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="wt-td" colSpan={6}>
                    暂无调用日志
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
