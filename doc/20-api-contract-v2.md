# V3 ↔ V2 接口契约（V3 调用 V2）

本文档是“契约”，同时约束：

- V2 侧需要新增/调整哪些 API
- V3 侧应该如何调用（鉴权、超时、重试、幂等、降级）
- 日志字段如何记录，方便跨系统排查

## 1. 版本与 BaseURL

- BaseURL：`V2_BASE_URL`（例：`https://<v2-app>.vercel.app`）
- API 前缀：`/api/v3-bridge`（避免与 V2 现有 API 冲突）

## 2. 鉴权与链路追踪

### 2.1 鉴权

- 请求头：`x-ztocc-api-key: <V3_TO_V2_API_KEY>`
- V2 侧通过环境变量 `V3_TO_V2_API_KEY` 校验
- 未通过鉴权：返回 `401`，响应体见“错误格式”

### 2.2 RequestId（必须）

- V3 每次调用都生成 `request_id`（UUID）
- 请求头：`x-request-id: <uuid>`
- V2 必须原样回传：响应头 `x-request-id`
- V3 必须把该 `request_id` 写入 `v3_api_call_logs`，用于跨系统定位

## 3. 超时与重试（V3 调用端规则）

- 超时：`3s`（可配置，环境变量 `V3_V2_HTTP_TIMEOUT_MS`，默认 3000）
- 重试：最多 1 次（总计 2 次请求）
  - 仅对网络错误/超时/5xx 重试
  - 不对 4xx 重试
- 幂等性：
  - 本文档涉及的接口均为查询/校验，不产生写入副作用
  - 若后续增加回写接口（可选加分项），必须引入 `Idempotency-Key`

## 4. 统一错误格式

非 2xx 时，V2 返回 JSON：

```json
{
  "error": {
    "code": "UNAUTHORIZED | NOT_FOUND | BAD_REQUEST | INTERNAL_ERROR",
    "message": "人类可读信息",
    "requestId": "uuid"
  }
}
```

## 5. 接口列表

### 5.1 获取运单详情（用于真实性校验 + 详情展示）

**GET** `/api/v3-bridge/waybills/{externalCode}`

用途：

- V3 创建工单时：必须实时调用该接口，校验运单真实存在
- V3 工单详情页：优先实时拉取；失败时允许降级本地快照

Path 参数：

- `externalCode`：V2 的 `outbound_orders.external_code`

响应（200）：

```json
{
  "requestId": "uuid",
  "waybill": {
    "externalCode": "PS2512220005001",
    "receiverStore": "门店A",
    "receiverName": "张三",
    "receiverPhone": "13800000000",
    "receiverAddress": "上海市...",
    "estimatedAmount": null,
    "createdAt": "2026-07-01T10:00:00.000Z"
  }
}
```

错误：

- 404：运单不存在

### 5.2 获取运单 SKU 明细（用于展示/校验）

**GET** `/api/v3-bridge/waybills/{externalCode}/items`

响应（200）：

```json
{
  "requestId": "uuid",
  "items": [
    {
      "skuCode": "SKU001",
      "skuName": "商品1",
      "skuQuantity": 10,
      "skuSpecModel": "500g",
      "remark": ""
    }
  ]
}
```

### 5.3 校验 SKU 是否归属于指定运单（扫描录入强制校验）

**POST** `/api/v3-bridge/waybills/validate-sku`

请求体：

```json
{
  "externalCode": "PS2512220005001",
  "skuCode": "SKU001"
}
```

响应（200）：

```json
{
  "requestId": "uuid",
  "ok": true,
  "reason": ""
}
```

说明：

- `ok=false` 可能原因：运单不存在 / sku 不在该运单内 / 入参不合法

### 5.4 按条件查询运单列表（用于本地快照初始化/增量同步）

**GET** `/api/v3-bridge/waybills/list?cursor=<cursor>&limit=<n>`

参数：

- `limit`：默认 50，最大 200
- `cursor`：游标分页（由 V2 返回的 `nextCursor`），首次可不传

响应（200）：

```json
{
  "requestId": "uuid",
  "list": [
    {
      "externalCode": "PS2512220005001",
      "receiverStore": "门店A",
      "receiverName": "张三",
      "receiverPhone": "13800000000",
      "receiverAddress": "上海市...",
      "estimatedAmount": null,
      "createdAt": "2026-07-01T10:00:00.000Z"
    }
  ],
  "nextCursor": "opaque-string-or-null"
}
```

实现提示（V2 侧）：

- 以 `outbound_orders.created_at DESC, id DESC` 排序
- 游标可编码为 `{created_at}|{id}` 的 base64

