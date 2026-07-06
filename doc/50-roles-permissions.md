# 角色与权限模型（含后端校验规则）

本项目权限控制的目标是：

- 入口不靠“前端隐藏按钮”，后端 API 必须校验权限
- 满足强制约束：上报人不能审批自己工单；品控主管快速放行需留痕；禁用账号兜底
- 在不引入复杂 OAuth 的前提下，形成最小可用鉴权闭环（适配考试实现）

## 1. 用户与角色

用户表：`v3_users`

- `roles_json`：字符串 JSON 数组，例如 `["reporter","approver_l1"]`
- `enabled`：0/1

角色定义：

- `reporter`：上报异常/重提材料/查看自己工单
- `approver_l1`：一级审批
- `approver_l2`：二级审批
- `qc_supervisor`：误判快速放行（仅品控类工单）
- `admin`：规则配置、用户管理、种子数据、监控/日志

## 2. 资源访问范围

本实现单租户，因此“范围”主要体现在“自己 vs 待办 vs 全部”：

- reporter：默认只能看到自己创建的工单（也可配置为看到全部，考试实现建议保守）
- approver_l1：看到分配给自己的一级待办
- approver_l2：看到分配给自己的二级待办
- qc_supervisor：admin 之外的特殊操作权限（快速放行），工单可见性可按需放宽
- admin：可查看全部

## 3. 后端强制校验规则（必须）

### 3.1 登录与会话

- V3 采用 Session Token（cookie）：
  - 登录成功后下发 `v3_session` cookie
  - 每个 API 从 cookie 解析 token，查 `v3_sessions` 得到 user_id
- 禁用用户（`enabled=0`）：
  - 不允许任何写操作（审批/上报/扫描/配置/种子数据）

### 3.2 上报异常（创建工单）

允许：

- 具备 `reporter` 角色

必须校验：

- 真实存在性：实时调用 V2 `/api/v3-bridge/waybills/{externalCode}`，404 则禁止创建
- 同一运单同类型未关闭：禁止重复上报（提示已有工单 id 与状态）

### 3.3 扫描录入

允许：

- `reporter` 或 `qc_supervisor`（默认扫描员属于 reporter）

必须校验：

- SKU 归属校验：实时调用 V2 `/api/v3-bridge/waybills/validate-sku`
- 幂等：同一 `(external_code, sku_code)` 存在未关闭品控工单时，不允许重复创建工单，只追加扫描记录

### 3.4 一级/二级审批

允许：

- 一级审批：具备 `approver_l1`，且该工单当前分配给自己
- 二级审批：具备 `approver_l2`，且该工单当前分配给自己

必须校验：

- 不能自批自核：`ticket.reporter_user_id !== current_user_id`
- 状态匹配：工单必须处于对应审批状态
- 并发冲突：版本号校验失败返回 409

### 3.5 误判快速放行（品控主管）

允许：

- 具备 `qc_supervisor`
- 工单来源必须是 `SCAN`（品控类）
- 工单未终结（非 DONE/AUTO_REJECTED_TIMEOUT）

必须校验：

- 必须提供 `reason`（复核原因）
- 必须写入一条审批/审计记录（action=FAST_RELEASE）
- 必须在同一事务内：关闭工单 + 解锁批次

### 3.6 后台配置

允许：

- 具备 `admin`

对象：

- `v3_qc_rules`：品控规则配置
- `v3_approval_rules`：分级阈值配置
- 超时参数（实现可放到 `v3_config` 表或环境变量）

## 4. 审批人禁用兜底

后台任务（cron）发现：

- 待审批工单分配给的审批人已被禁用

处理策略：

- 直接升级到二级审批并重新分配 `assigned_l2_user_id`（默认分配给 admin 用户）
- 写入审批/审计记录（action=REASSIGN_DISABLED_APPROVER）

