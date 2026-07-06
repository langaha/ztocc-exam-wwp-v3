import { ensureDb, getDbClient } from "@/lib/db";
import { callV2Json } from "@/lib/v2Client";

type V2Waybill = {
  externalCode?: string;
  receiverStore?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  estimatedAmount?: number | null;
  createdAt?: string | null;
};

export type WaybillSnapshot = {
  externalCode: string;
  receiverStore: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  estimatedAmount: number | null;
  createdAt: string | null;
  fetchedFromV2At: string;
  v2RequestId: string | null;
};

export async function fetchAndUpsertWaybillSnapshot(externalCode: string): Promise<WaybillSnapshot | null> {
  const code = String(externalCode ?? "").trim();
  if (!code) return null;

  const res = await callV2Json<{ requestId?: string; waybill?: V2Waybill | null }>({
    apiName: "waybills.get",
    method: "GET",
    path: `/api/v3-bridge/waybills/${encodeURIComponent(code)}`,
    requestSummary: JSON.stringify({ externalCode: code }),
  });

  if (!res.ok) return null;
  const waybill = res.data.waybill ?? null;
  if (!waybill) return null;

  const snapshot: WaybillSnapshot = {
    externalCode: String(waybill.externalCode ?? code),
    receiverStore: waybill.receiverStore ?? null,
    receiverName: waybill.receiverName ?? null,
    receiverPhone: waybill.receiverPhone ?? null,
    receiverAddress: waybill.receiverAddress ?? null,
    estimatedAmount: waybill.estimatedAmount ?? null,
    createdAt: waybill.createdAt ?? null,
    fetchedFromV2At: new Date().toISOString(),
    v2RequestId: String(res.data.requestId ?? res.requestId ?? "").trim() || null,
  };

  await ensureDb();
  const db = getDbClient();
  await db.execute({
    sql: `
      INSERT INTO v3_waybill_snapshots (
        id, external_code,
        receiver_store, receiver_name, receiver_phone, receiver_address,
        estimated_amount, v2_created_at, fetched_from_v2_at, v2_request_id, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (external_code) DO UPDATE SET
        receiver_store = excluded.receiver_store,
        receiver_name = excluded.receiver_name,
        receiver_phone = excluded.receiver_phone,
        receiver_address = excluded.receiver_address,
        estimated_amount = excluded.estimated_amount,
        v2_created_at = excluded.v2_created_at,
        fetched_from_v2_at = excluded.fetched_from_v2_at,
        v2_request_id = excluded.v2_request_id,
        raw_json = excluded.raw_json
    `,
    args: [
      crypto.randomUUID(),
      snapshot.externalCode,
      snapshot.receiverStore,
      snapshot.receiverName,
      snapshot.receiverPhone,
      snapshot.receiverAddress,
      snapshot.estimatedAmount,
      snapshot.createdAt,
      snapshot.fetchedFromV2At,
      snapshot.v2RequestId,
      JSON.stringify(waybill),
    ],
  });

  return snapshot;
}
