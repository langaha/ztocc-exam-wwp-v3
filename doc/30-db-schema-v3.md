# V3 数据库表设计（v3_ 前缀）

V3 使用与 V2 同一 Postgres 实例（按你的约束），但 **只使用 `v3_` 前缀的新表**。V3 不允许直接查询/写入 V2 的业务表；运单数据只通过 HTTP API 从 V2 拉取，并缓存在 `v3_waybill_snapshots`。

本设计遵循三个原则：

- 可追溯：赔付/库存变更必须能反查到触发它的审批记录
- 幂等：同一动作重复提交不会重复生成审批/赔付/库存流水
- 并发安全：同一工单同时操作只能一个成功（乐观锁/条件更新）

## 1. 表清单

- 运单快照：`v3_waybill_snapshots`
- 接口同步日志：`v3_api_call_logs`
- 异常工单：`v3_tickets`
- 审批记录：`v3_approvals`
- 赔付记录：`v3_compensations`
- 库存与锁定：`v3_inventory_items` / `v3_inventory_locks` / `v3_inventory_ledger`
- 扫描记录：`v3_scan_records`
- 品控批次状态：`v3_qc_batches`
- 品控规则：`v3_qc_rules`
- 分级审批规则：`v3_approval_rules`
- 用户与会话：`v3_users` / `v3_sessions`

## 2. 关键枚举（以 TEXT 存储）

### 2.1 工单状态 `v3_tickets.status`

- `PENDING`：待审批
- `L1_APPROVING`：一级审批中
- `L2_APPROVING`：二级审批中
- `EXECUTING`：执行中
- `DONE`：已完成
- `REJECTED_NEED_RESUBMIT`：已拒绝-待重提
- `AUTO_REJECTED_TIMEOUT`：超时自动驳回（终态）

### 2.2 扫描批次状态 `v3_qc_batches.status`

- `PASS`：可出库（终态）
- `HOLD`：品控暂扣（锁定）
- `FAST_RELEASED`：误判快速放行（终态）
- `LINKED_TICKET`：已创建工单并进入审批（仍视为锁定，直至工单关闭）

### 2.3 赔付方向 `v3_compensations.direction`

- `CUSTOMER`：赔付给客户（物流异常）
- `SUPPLIER`：向供应商追偿（品控异常）

## 3. DDL（实现时以 ensureDb 迁移执行）

说明：以下 DDL 为“目标结构”。实现时可按 V2 的迁移风格使用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`。

### 3.1 运单快照

```sql
CREATE TABLE IF NOT EXISTS v3_waybill_snapshots (
  id TEXT PRIMARY KEY,
  external_code TEXT NOT NULL UNIQUE,
  receiver_store TEXT,
  receiver_name TEXT,
  receiver_phone TEXT,
  receiver_address TEXT,
  estimated_amount DOUBLE PRECISION,
  v2_created_at TEXT,
  fetched_from_v2_at TEXT NOT NULL,
  v2_request_id TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_v3_waybill_snapshots_fetched ON v3_waybill_snapshots(fetched_from_v2_at);
```

### 3.2 接口调用日志（链路追踪）

```sql
CREATE TABLE IF NOT EXISTS v3_api_call_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  target_system TEXT NOT NULL,
  api_name TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  request_summary TEXT,
  response_status INTEGER,
  duration_ms INTEGER,
  ok INTEGER NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v3_api_call_logs_created_at ON v3_api_call_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_v3_api_call_logs_request_id ON v3_api_call_logs(request_id);
```

### 3.3 异常工单

```sql
CREATE TABLE IF NOT EXISTS v3_tickets (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  external_code TEXT NOT NULL,
  claim_amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  current_level INTEGER NOT NULL,
  reporter_user_id TEXT NOT NULL,
  assigned_l1_user_id TEXT,
  assigned_l2_user_id TEXT,
  resubmit_count INTEGER NOT NULL,
  last_action_at TEXT NOT NULL,
  due_at TEXT,
  version INTEGER NOT NULL,
  qc_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v3_tickets_status ON v3_tickets(status);
CREATE INDEX IF NOT EXISTS idx_v3_tickets_external_code ON v3_tickets(external_code);
CREATE INDEX IF NOT EXISTS idx_v3_tickets_due_at ON v3_tickets(due_at);
```

### 3.4 审批记录（审计日志核心）

```sql
CREATE TABLE IF NOT EXISTS v3_approvals (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_approvals_idem ON v3_approvals(ticket_id, action, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_v3_approvals_ticket ON v3_approvals(ticket_id, created_at);
```

### 3.5 赔付记录（必须含赔付方向）

```sql
CREATE TABLE IF NOT EXISTS v3_compensations (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_comp_ticket ON v3_compensations(ticket_id);
CREATE INDEX IF NOT EXISTS idx_v3_comp_approval ON v3_compensations(approval_id);
```

### 3.6 库存与锁定（最小可用）

```sql
CREATE TABLE IF NOT EXISTS v3_inventory_items (
  id TEXT PRIMARY KEY,
  sku_code TEXT NOT NULL UNIQUE,
  available_qty DOUBLE PRECISION NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v3_inventory_locks (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  external_code TEXT NOT NULL,
  sku_code TEXT NOT NULL,
  locked_qty DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_inventory_lock_active ON v3_inventory_locks(external_code, sku_code, status);

CREATE TABLE IF NOT EXISTS v3_inventory_ledger (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  sku_code TEXT NOT NULL,
  delta_qty DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_inventory_ledger_once ON v3_inventory_ledger(approval_id, sku_code, reason);
```

### 3.7 扫描记录与品控批次

```sql
CREATE TABLE IF NOT EXISTS v3_qc_batches (
  id TEXT PRIMARY KEY,
  external_code TEXT NOT NULL,
  sku_code TEXT NOT NULL,
  status TEXT NOT NULL,
  ticket_id TEXT,
  locked_at TEXT,
  hold_due_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(external_code, sku_code)
);

CREATE TABLE IF NOT EXISTS v3_scan_records (
  id TEXT PRIMARY KEY,
  external_code TEXT NOT NULL,
  sku_code TEXT NOT NULL,
  scanned_qty DOUBLE PRECISION NOT NULL,
  expected_qty DOUBLE PRECISION,
  result TEXT NOT NULL,
  matched_rule_id TEXT,
  rule_reason TEXT,
  qc_batch_id TEXT,
  ticket_id TEXT,
  operator_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v3_scan_records_external_sku ON v3_scan_records(external_code, sku_code, created_at);
CREATE INDEX IF NOT EXISTS idx_v3_scan_records_ticket ON v3_scan_records(ticket_id);
```

### 3.8 品控规则与审批规则（可配置）

```sql
CREATE TABLE IF NOT EXISTS v3_qc_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtype TEXT NOT NULL,
  severity INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  condition_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v3_approval_rules (
  id TEXT PRIMARY KEY,
  ticket_type TEXT NOT NULL,
  min_amount DOUBLE PRECISION NOT NULL,
  max_amount DOUBLE PRECISION,
  target_level INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v3_approval_rules_type ON v3_approval_rules(ticket_type, enabled);
```

### 3.9 用户与会话（最小鉴权闭环）

```sql
CREATE TABLE IF NOT EXISTS v3_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v3_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_sessions_token_hash ON v3_sessions(token_hash);
```

