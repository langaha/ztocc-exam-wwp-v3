# 实现任务拆解与验收清单（按此执行开发）

本清单把题目要求拆成可提交、可自测的任务序列，并给出验收点。建议按顺序推进，每完成一项就能在页面或接口层面验证。

## A. V2 改造（提供 V3 调用的桥接接口）

### A1. 新增鉴权与 RequestId 透传

- [ ] V2 新增 `x-ztocc-api-key` 校验（环境变量 `V3_TO_V2_API_KEY`）
- [ ] 支持/回显 `x-request-id`，并在错误响应体里返回 `requestId`

验收：

- 使用错误 api-key 调用返回 401
- 正常调用响应头包含相同 `x-request-id`

### A2. 新增运单查询/校验接口（见接口契约）

- [ ] GET `/api/v3-bridge/waybills/{externalCode}`
- [ ] GET `/api/v3-bridge/waybills/{externalCode}/items`
- [ ] POST `/api/v3-bridge/waybills/validate-sku`
- [ ] GET `/api/v3-bridge/waybills/list`

验收：

- externalCode 不存在返回 404（区分 NOT_FOUND 与 INTERNAL_ERROR）
- validate-sku 能正确返回 ok=true/false

## B. V3 工程初始化与基础设施

### B1. 初始化 Next.js App Router + TS + Tailwind

- [ ] 建立 `src/app` 目录结构与全局样式，视觉风格延续 V2
- [ ] 提供基础 Layout + TopNav + AppShell

验收：

- `npm run dev` 可启动
- 首页可访问

### B2. 数据库与迁移

- [ ] 复用 V2 的 `pg` 连接方式实现 `src/lib/db.ts`（独立于 V2 项目）
- [ ] `ensureDb()` 建表（`v3_` 前缀），结构与索引见 [30-db-schema-v3.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/30-db-schema-v3.md)

验收：

- 启动后表可创建成功
- 重启不会重复报错（幂等迁移）

### B3. 鉴权（最小闭环）

- [ ] `v3_users` + `v3_sessions` 支持登录/退出/获取当前用户
- [ ] 所有写接口必须校验 `enabled=1`

验收：

- 未登录调用写接口返回 401
- 禁用用户 token 调用写接口返回 403

## C. V3 对接 V2（核心考点：接口、超时、重试、降级、日志）

### C1. V2 Client（服务端 fetch 封装）

- [ ] 统一封装 `callV2()`：
  - 超时（AbortController）
  - 重试 1 次
  - 生成 requestId
  - 写入 `v3_api_call_logs`

验收：

- 人为配置错误 BaseURL 能看到清晰错误提示，且日志记录 ok=0

### C2. 运单快照

- [ ] 创建工单时强制实时拉取 V2 详情并 upsert 到 `v3_waybill_snapshots`
- [ ] 工单详情页展示来源标识（实时 vs 快照，快照显示 fetched_from_v2_at）

验收：

- V2 正常：显示“实时获取自 V2”
- V2 不可用：显示“使用本地快照，同步于 XX”

## D. 扫描录入与品控规则引擎（核心考点）

### D1. 品控规则后台配置

- [ ] `v3_qc_rules` 的 CRUD（仅 admin）
- [ ] 规则引擎执行过程可追溯（scan_records 记录 matched_rule_id + rule_reason）

验收：

- 调整阈值后无需改代码即可影响判定结果

### D2. 扫描录入主流程

- [ ] 输入 externalCode + skuCode + scannedQty
- [ ] 调 V2 校验 SKU 归属
- [ ] 执行规则引擎 -> PASS/HOLD
- [ ] HOLD 时：
  - upsert `v3_qc_batches` 为锁定
  - 幂等：若存在未关闭工单则不新建，只追加 scan_record，并提示已有工单
  - 否则创建品控工单并关联 batch/ticket

验收：

- 同一批次重复扫描不会创建第二张品控工单
- HOLD 后批次处于锁定状态，直到工单关闭

### D3. 误判快速放行

- [ ] `qc_supervisor` 可执行 FAST_RELEASE：
  - 必填原因
  - 同事务关闭工单 + 解锁批次

验收：

- 非 qc_supervisor 返回 403
- 操作后工单终态且批次解锁

## E. 异常上报与分级审批（核心考点）

### E1. 手工上报工单

- [ ] 必须实时校验运单存在（调 V2）
- [ ] 同运单同类型未关闭禁止重复上报

验收：

- 重复上报提示已有工单状态

### E2. 分级审批与并发冲突

- [ ] 根据 `v3_approval_rules` 计算审批层级
- [ ] 提交审批采用版本号乐观锁，冲突返回 409
- [ ] 上报人不能审批自己工单（后端校验）

验收：

- 两个浏览器同时审批同工单，仅一个成功
- 自己上报的工单无法被自己审批

## F. 执行联动（赔付 + 库存一致性）

- [ ] 审批通过进入执行阶段时：
  - 赔付记录（含 direction）
  - 库存流水（可最小化实现）
  - 品控批次解锁（品控类）
- [ ] 同事务保证一致性

验收：

- 不出现“工单显示 DONE 但赔付/库存缺失”的中间态
- 重复点击不会生成多条赔付/库存记录

## G. 超时自动流转与审批人禁用兜底（后台任务）

- [ ] 提供 cron 入口 API：
  - 工单超时升级/驳回
  - 品控暂扣超时升级
  - 审批人禁用转交/升级
- [ ] cron API 需要单独 secret 鉴权

验收：

- 手工触发 cron API 可看到状态流转与审计记录

## H. 列表、筛选、监控页与规模化数据

### H1. 列表筛选分页

- [ ] 工单列表按状态/类型/运单号/审批人筛选 + 分页
- [ ] 即将超时标记（角标/颜色即可）

### H2. 接口监控页

- [ ] 展示最近同步时间、成功率、最近 N 条 `v3_api_call_logs`

### H3. 种子数据（至少 200 条）

- [ ] 一键生成：200+ 工单覆盖不同状态/类型
- [ ] 初始化用户与规则

验收：

- 在 200 条数据下列表筛选/分页仍流畅

