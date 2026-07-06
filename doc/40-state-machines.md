# 状态机与关键分支（工单 + 扫描批次）

本文档定义：

- 两套状态机的状态枚举与流转条件
- 两者的关联规则（通过 `ticket_id` 关联，但状态分离存储）
- 并发冲突保护与幂等策略
- 超时自动流转与兜底策略

## 1. 工单状态机（Ticket）

状态：

- `PENDING`（待审批）
- `L1_APPROVING`（一级审批中）
- `L2_APPROVING`（二级审批中）
- `REJECTED_NEED_RESUBMIT`（拒绝待重提）
- `EXECUTING`（执行中）
- `DONE`（已完成）
- `AUTO_REJECTED_TIMEOUT`（超时驳回终态）

### 1.1 状态流转（核心路径）

- `PENDING` → `L1_APPROVING`
  - 触发：创建工单成功后，根据分配策略写入 `assigned_l1_user_id` 并进入一级审批中
  - 例外：若规则计算目标层级为二级，则直接进入 `L2_APPROVING`

- `L1_APPROVING` → `L2_APPROVING`
  - 条件：`claim_amount` 命中需要二级的规则，或一级超时升级，或重提次数过多升级

- `L1_APPROVING` / `L2_APPROVING` → `EXECUTING`
  - 条件：审批通过
  - 实现要求：与下游“库存/赔付”联动在同一事务中完成，不允许中间态

- `EXECUTING` → `DONE`
  - 条件：执行动作落库成功（赔付记录、库存流水、品控批次解锁等）

### 1.2 拒绝与重提

- `L1_APPROVING` / `L2_APPROVING` → `REJECTED_NEED_RESUBMIT`
  - 条件：审批拒绝
  - 动作：写入审批记录，工单 `resubmit_count += 1`，并写入下一次 `due_at`

- `REJECTED_NEED_RESUBMIT` → `PENDING`
  - 条件：上报人提交重提材料（必须是工单 reporter，且不能是审批人）
  - 限制：超过重提次数上限，不能回到 PENDING，而是直接升级二级审批：`REJECTED_NEED_RESUBMIT` → `L2_APPROVING`

### 1.3 超时自动流转（后台任务触发）

参见 [10-assumptions.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/10-assumptions.md) 的默认值：

- `PENDING` 超时 → `L2_APPROVING`
- `L1_APPROVING` 超时 → `L2_APPROVING`
- `L2_APPROVING` 超时 → `AUTO_REJECTED_TIMEOUT`（写入“超时驳回”审批记录）

### 1.4 并发冲突保护（必须）

核心策略：`v3_tickets.version` 乐观锁 + 条件更新。

- 提交审批时携带 `expectedVersion`
- 数据库更新语句必须包含：`WHERE id = ? AND version = ? AND status IN (...)`
- 若影响行数为 0：返回 409，提示“该工单已被处理，请刷新”

### 1.5 幂等（必须）

策略：审批记录唯一键 + 执行动作唯一键。

- 客户端每次提交审批生成 `idempotencyKey`（UUID）
- 写入审批记录时使用唯一约束：`UNIQUE(ticket_id, action, idempotency_key)`
- 执行联动：
  - 赔付记录：`UNIQUE(ticket_id)`（同工单只生成 1 条赔付记录）
  - 库存流水：`UNIQUE(approval_id, sku_code, reason)`（同一次审批对同 SKU 的同原因只落一次）

## 2. 扫描批次状态机（QC Batch）

状态：

- `PASS`：可出库（流程结束）
- `HOLD`：品控暂扣（库存锁定）
- `LINKED_TICKET`：已创建品控工单并进入审批（仍锁定）
- `FAST_RELEASED`：误判快速放行（解锁并关闭工单）

### 2.1 正常路径

- 扫描录入 → 规则引擎检测
  - 通过：写 `v3_scan_records.result=PASS`，并 upsert `v3_qc_batches.status=PASS`
  - 异常：写 `v3_scan_records.result=HOLD`，并 upsert `v3_qc_batches.status=HOLD` + `hold_due_at=now+30min`，同时创建工单（source=SCAN）并把 `v3_qc_batches.ticket_id` 关联上，置为 `LINKED_TICKET`

### 2.2 暂扣超时（必须，独立于审批超时）

- 后台任务扫描 `v3_qc_batches.status IN (HOLD, LINKED_TICKET)` 且 `hold_due_at < now`
- 若尚未进入二级审批：强制把关联工单升级至 `L2_APPROVING`，并写入审计记录“压仓超时升级”
- 批次仍保持锁定，直到工单关闭（DONE/FAST_RELEASED/AUTO_REJECTED_TIMEOUT 视策略解锁）

## 3. 两套状态机关联规则（必须实现）

- 关联方式：
  - `v3_scan_records.ticket_id` 与 `v3_qc_batches.ticket_id` 指向 `v3_tickets.id`
  - 工单表可反查 `qc_batch_id`（便于执行联动时同时更新）
- 幂等性：
  - 同一 `external_code + sku_code` 若存在未关闭品控工单（`v3_qc_batches.ticket_id` 且关联工单非终态），重复扫描只追加 `v3_scan_records`，不重新创建工单
- 一致性（同一事务）：
  - 品控工单审批通过执行动作时，必须在同一事务内：
    - 写入审批记录
    - 更新工单状态到 EXECUTING/DONE
    - 更新 `v3_qc_batches.status`（解锁/关闭）
    - 生成赔付记录（若需要）与库存流水（若需要）

## 4. 审批人离职/禁用兜底（必须）

策略：

- `v3_users.enabled=0` 视为禁用
- 后台任务周期性扫描：
  - `v3_tickets.status in (L1_APPROVING, L2_APPROVING)` 且 `assigned_x_user_id` 指向禁用用户
  - 动作：把工单升级到二级审批并重新分配 `assigned_l2_user_id`（或交给 admin），写入审计记录“审批人禁用兜底转交”

