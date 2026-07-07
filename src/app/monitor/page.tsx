import { ensureDb, getDbClient } from "@/lib/db";

export const dynamic = "force-dynamic";

type MonitorRow = {
  requestId: string;
  apiName: string;
  method: string;
  status: unknown;
  durationMs: number;
  ok: boolean;
  errorMessage: unknown;
  createdAt: string;
  diagnosis: string;
  suggestion: string;
};

function diagnoseV2Call(status: unknown, errorMessage: unknown) {
  const statusNum = status === null || status === undefined || status === "" ? null : Number(status);
  const msg = String(errorMessage ?? "").trim();
  const lower = msg.toLowerCase();

  if (!msg && statusNum !== null && statusNum >= 200 && statusNum < 300) {
    return { diagnosis: "调用成功", suggestion: "-" };
  }
  if (msg.includes("V3_TO_V2_API_KEY is required")) {
    return {
      diagnosis: "V3 未配置访问 V2 的 API Key",
      suggestion: "检查 V3 环境变量 `V3_TO_V2_API_KEY` 是否已配置并重新部署",
    };
  }
  if (msg.includes("V2_BASE_URL is required")) {
    return {
      diagnosis: "V3 未配置 V2 服务地址",
      suggestion: "检查 V3 环境变量 `V2_BASE_URL` 是否已配置并重新部署",
    };
  }
  if (statusNum === 401) {
    return {
      diagnosis: "V2 鉴权失败",
      suggestion: "检查 V2 与 V3 两边的 `V3_TO_V2_API_KEY` 是否完全一致",
    };
  }
  if (statusNum === 404 || lower.includes("waybill not found")) {
    return {
      diagnosis: "未查询到运单",
      suggestion: "检查运单号是否真实存在于 V2，或确认 V2 查询条件是否正确",
    };
  }
  if (
    statusNum === null ||
    (statusNum !== null && statusNum >= 500) ||
    lower.includes("fetch failed") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("aborted") ||
    lower.includes("econn") ||
    lower.includes("enotfound")
  ) {
    return {
      diagnosis: "网络请求失败或 V2 服务异常",
      suggestion: "检查 V2 域名可达性、Vercel 服务状态，以及是否存在超时/5xx",
    };
  }
  return {
    diagnosis: "V2 请求失败",
    suggestion: msg || "查看请求参数、V2 日志与接口返回内容",
  };
}

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

  const rows: MonitorRow[] = recentRes.rows.map((r) => {
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
      ...diagnoseV2Call(row.response_status ?? null, row.error_message ?? null),
    };
  });
  const latestFailure = rows.find((row) => !row.ok) ?? null;
  const latestSuccess = rows.find((row) => row.ok) ?? null;

  return (
    <div className="grid gap-4">
      <section
        className={`wt-card border ${
          latestFailure ? "border-amber-200 bg-amber-50/80" : "border-emerald-200 bg-emerald-50/80"
        }`}
      >
        <div className="wt-card-hd">
          <div>
            <h2 className="wt-card-title">{latestFailure ? "当前重点告警" : "当前状态正常"}</h2>
            <div className="wt-muted">
              {latestFailure
                ? "最近一次失败调用已自动诊断，可先按建议排查。"
                : "最近日志中没有失败调用，可以继续观察明细列表。"}
            </div>
          </div>
        </div>
        {latestFailure ? (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="wt-muted">诊断</div>
              <div className="font-medium text-amber-900">{latestFailure.diagnosis}</div>
            </div>
            <div>
              <div className="wt-muted">接口</div>
              <div className="font-medium">
                {latestFailure.method} {latestFailure.apiName}
              </div>
            </div>
            <div>
              <div className="wt-muted">时间</div>
              <div>{latestFailure.createdAt}</div>
            </div>
            <div>
              <div className="wt-muted">RequestId</div>
              <div className="font-mono text-xs">{latestFailure.requestId}</div>
            </div>
            <div className="md:col-span-2">
              <div className="wt-muted">建议</div>
              <div>{latestFailure.suggestion}</div>
            </div>
            <div className="md:col-span-2">
              <div className="wt-muted">原始错误</div>
              <div className="break-all text-rose-700">
                {latestFailure.errorMessage ? String(latestFailure.errorMessage) : "-"}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <div className="wt-muted">最近成功接口</div>
              <div className="font-medium">
                {latestSuccess ? `${latestSuccess.method} ${latestSuccess.apiName}` : "-"}
              </div>
            </div>
            <div>
              <div className="wt-muted">最近成功时间</div>
              <div>{latestSuccess?.createdAt ?? "-"}</div>
            </div>
            <div>
              <div className="wt-muted">累计成功率</div>
              <div className="font-medium text-emerald-700">{rate}%</div>
            </div>
          </div>
        )}
      </section>
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
                <th className="wt-th">诊断</th>
                <th className="wt-th">建议</th>
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
                  <td className="wt-td whitespace-nowrap">{r.diagnosis}</td>
                  <td className="wt-td max-w-[420px]">{r.suggestion}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="wt-td" colSpan={8}>
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
