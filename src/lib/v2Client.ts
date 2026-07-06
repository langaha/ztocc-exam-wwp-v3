import { ensureDb, getDbClient } from "@/lib/db";

type CallOpts = {
  apiName: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  requestSummary?: string;
};

type CallOk<T> = {
  ok: true;
  requestId: string;
  status: number;
  durationMs: number;
  data: T;
};

type CallErr = {
  ok: false;
  requestId: string;
  status: number | null;
  durationMs: number;
  errorMessage: string;
};

export type V2CallResult<T> = CallOk<T> | CallErr;

function getBaseUrl(): string {
  const envUrl = String(process.env.V2_BASE_URL ?? "").trim();
  const fallbackUrl = "https://ztocc-wwp-exam.vercel.app";
  return (envUrl || fallbackUrl).trim().replace(/\/+$/, "");
}

function getApiKey(): string {
  return String(process.env.V3_TO_V2_API_KEY ?? "").trim();
}

function getTimeoutMs(): number {
  const v = Number(String(process.env.V3_V2_HTTP_TIMEOUT_MS ?? "").trim());
  if (!Number.isFinite(v) || v <= 0) return 3000;
  return Math.min(20000, Math.floor(v));
}

export async function callV2Json<T>(opts: CallOpts): Promise<V2CallResult<T>> {
  await ensureDb();
  const requestId = crypto.randomUUID();
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  const timeoutMs = getTimeoutMs();

  if (!baseUrl) {
    return logAndReturnErr(opts, requestId, null, 0, "V2_BASE_URL is required");
  }
  if (!apiKey) {
    return logAndReturnErr(opts, requestId, null, 0, "V3_TO_V2_API_KEY is required");
  }

  const url = `${baseUrl}${opts.path.startsWith("/") ? "" : "/"}${opts.path}`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    let status: number | null = null;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetch(url, {
        method: opts.method,
        headers: {
          "content-type": "application/json",
          "x-ztocc-api-key": apiKey,
          "x-request-id": requestId,
        },
        body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
        signal: ac.signal,
      });
      clearTimeout(t);
      status = res.status;

      const text = await res.text().catch(() => "");
      const json = text ? (JSON.parse(text) as unknown) : null;

      const durationMs = Date.now() - start;

      if (res.ok) {
        await writeApiLog({
          requestId,
          apiName: opts.apiName,
          method: opts.method,
          url,
          requestSummary: opts.requestSummary ?? null,
          responseStatus: status,
          durationMs,
          ok: 1,
          errorMessage: null,
        });
        return { ok: true, requestId, status, durationMs, data: json as T };
      }

      const msg = extractErrorMessage(json) || `HTTP ${status}`;
      const canRetry = status >= 500 && attempt < maxAttempts;
      if (canRetry) continue;

      await writeApiLog({
        requestId,
        apiName: opts.apiName,
        method: opts.method,
        url,
        requestSummary: opts.requestSummary ?? null,
        responseStatus: status,
        durationMs,
        ok: 0,
        errorMessage: msg,
      });
      return { ok: false, requestId, status, durationMs, errorMessage: msg };
    } catch (e) {
      const durationMs = Date.now() - start;
      const msg = e instanceof Error ? e.message : "unknown error";
      const canRetry = attempt < maxAttempts;
      if (canRetry) continue;

      await writeApiLog({
        requestId,
        apiName: opts.apiName,
        method: opts.method,
        url,
        requestSummary: opts.requestSummary ?? null,
        responseStatus: status,
        durationMs,
        ok: 0,
        errorMessage: msg,
      });
      return { ok: false, requestId, status, durationMs, errorMessage: msg };
    }
  }

  return logAndReturnErr(opts, requestId, null, 0, "unreachable");
}

function extractErrorMessage(json: unknown): string {
  const j = json as { error?: { message?: unknown } } | null;
  const msg = j?.error?.message;
  return String(msg ?? "").trim();
}

async function writeApiLog(args: {
  requestId: string;
  apiName: string;
  method: string;
  url: string;
  requestSummary: string | null;
  responseStatus: number | null;
  durationMs: number;
  ok: 0 | 1;
  errorMessage: string | null;
}) {
  const db = getDbClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO v3_api_call_logs (
        id, request_id, target_system, api_name, method, url,
        request_summary, response_status, duration_ms, ok, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      crypto.randomUUID(),
      args.requestId,
      "V2",
      args.apiName,
      args.method,
      args.url,
      args.requestSummary,
      args.responseStatus,
      args.durationMs,
      args.ok,
      args.errorMessage,
      now,
    ],
  });
}

async function logAndReturnErr(
  opts: CallOpts,
  requestId: string,
  status: number | null,
  durationMs: number,
  msg: string
): Promise<CallErr> {
  await writeApiLog({
    requestId,
    apiName: opts.apiName,
    method: opts.method,
    url: `${getBaseUrl()}${opts.path}`,
    requestSummary: opts.requestSummary ?? null,
    responseStatus: status,
    durationMs,
    ok: 0,
    errorMessage: msg,
  });
  return { ok: false, requestId, status, durationMs, errorMessage: msg };
}
