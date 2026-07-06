# 运单异常管理 V3

## 1. 项目说明

这是 V3 运单异常管理系统，覆盖以下流程：

- 扫描品控
- 异常上报
- 分级审批
- 执行联动
- 接口监控
- 后台配置

当前实现方式按本项目约束落地：

- V2、V3 分别独立部署
- V3 与 V2 通过 HTTP API 交互
- 数据库使用与 V2 同一个 Postgres 实例
- V3 只使用自己的 `v3_` 前缀表，不直接读写 V2 业务表

## 2. 技术栈

- Next.js 15 App Router
- TypeScript
- Tailwind CSS
- PostgreSQL (`pg`)

## 3. 目录说明

- `src/app/scan`：扫描品控页面
- `src/app/tickets`：工单列表、详情、审批、重提
- `src/app/monitor`：V2 接口调用监控
- `src/app/admin`：后台入口
- `src/app/admin/qc-rules`：品控规则后台
- `src/app/api`：各类服务端 API
- `src/lib/db.ts`：数据库连接与建表迁移
- `src/lib/ticketService.ts`：工单领域服务
- `src/lib/qcRuleService.ts`：品控规则 CRUD 服务
- `doc/`：题目拆解文档、假设说明、接口契约、状态机、任务清单

## 4. 环境变量

### 4.1 V3 项目需要的环境变量

至少需要以下变量：

```bash
DATABASE_URL=postgres://...
V2_BASE_URL=https://ztocc-wwp-exam.vercel.app
V3_TO_V2_API_KEY=your-api-key
V3_V2_HTTP_TIMEOUT_MS=3000
CRON_SECRET=your-cron-secret
```

说明：

- `DATABASE_URL`：V3 使用的数据库连接
- `V2_BASE_URL`：V2 服务地址（默认建议直接配置为 `https://ztocc-wwp-exam.vercel.app`；如本地启动 V2，可改为 `http://localhost:3005`）
- `V3_TO_V2_API_KEY`：V3 调用 V2 桥接接口时带的 key
- `V3_V2_HTTP_TIMEOUT_MS`：调用 V2 的超时时间
- `CRON_SECRET`：手工触发 `/api/cron` 时使用

### 4.2 V2 项目需要的环境变量

V2 侧至少需要：

```bash
DATABASE_URL=postgres://...
V3_TO_V2_API_KEY=your-api-key
```

注意：

- V2 和 V3 的 `V3_TO_V2_API_KEY` 必须一致

## 5. 本地启动方式

### 5.1 启动 V2

如果你直接使用线上 V2（`https://ztocc-wwp-exam.vercel.app`），这一节可以跳过。

如需本地启动 V2，进入 V2 项目目录：

```bash
cd d:\Project\Exam\ztocc-wwp-exam
npm install
npm run dev
```

默认端口是：

- `http://localhost:3005`

### 5.2 启动 V3

进入 V3 项目目录：

```bash
cd d:\Project\Exam\ztocc-exam-wwp-v3
npm install
npm run dev
```

默认端口是：

- `http://localhost:3006`

## 6. 首次使用系统怎么操作

### 6.1 登录

打开：

- `http://localhost:3006/login`

系统会从 `v3_users` 表读取初始化用户。当前默认会自动创建这些演示账号：

- `上报人A`
- `一级审批A`
- `二级审批A`
- `品控主管A`
- `管理员`

选择账号后点击登录，系统会写入 `v3_session` cookie。

### 6.2 首页导航

登录后可以通过顶部导航进入：

- `/scan`：扫描品控
- `/tickets`：异常工单
- `/monitor`：接口监控
- `/admin`：后台配置

## 7. 业务操作说明

### 7.1 扫描品控

页面地址：

- `/scan`

操作步骤：

1. 输入运单号 `externalCode`
2. 输入 `skuCode`
3. 输入扫描数量 `scannedQty`
4. 可选填写预估追偿金额 `claimAmount`
5. 点击“提交扫描”

系统会执行：

1. 调用 V2 校验该 SKU 是否归属该运单
2. 拉取运单详情并更新本地快照
3. 读取 `v3_qc_rules` 中启用的规则
4. 命中规则后决定是 `PASS` 还是 `HOLD`
5. 若为 `HOLD`
   - 创建或复用品控工单
   - 写入扫描记录
   - 锁定批次

### 7.2 手工上报物流异常

页面地址：

- `/tickets`

页面上半部分就是手工上报表单。

操作步骤：

1. 填写运单号
2. 可选填写 SKU
3. 选择物流异常类型
4. 填写理赔金额
5. 填写异常描述
6. 点击“手工上报”

系统会执行：

1. 实时调用 V2 校验运单真实存在
2. 更新本地快照
3. 检查是否已有同运单同类型未关闭工单
4. 根据金额规则自动进入一级或二级审批

### 7.3 审批工单

页面地址：

- `/tickets`
- `/tickets/[id]`

可以在列表页直接审批，也可以点工单号进入详情页审批。

审批动作：

- 通过
- 拒绝
- 品控工单快速放行（仅品控主管）

系统约束：

- 上报人不能审批自己提交的工单
- 只有对应层级审批人能审批
- 使用版本号做并发控制
- 重复提交通过幂等键避免重复写审批记录

### 7.4 查看审批历史

页面地址：

- `/tickets/[id]`

详情页会展示：

- 当前工单状态
- 运单快照
- 历史审批记录
- 当前可执行操作

### 7.5 重提工单

当工单状态为：

- `REJECTED_NEED_RESUBMIT`

且当前登录用户就是上报人时，详情页会出现“重提”按钮。

重提时可以修改：

- 重提说明
- 理赔金额

系统规则：

- 只有上报人可以重提
- 重提会重新进入审批流
- 超过默认次数上限后，会直接进入二级审批

## 8. 接口监控怎么用

页面地址：

- `/monitor`

可以查看：

- 最近一次 V2 调用记录
- 请求成功率
- RequestId
- 响应状态码
- 耗时
- 错误信息

用途：

- 排查 V2 接口是否异常
- 追踪一次跨系统调用链

## 9. 后台怎么用

### 9.1 后台首页

页面地址：

- `/admin`

当前可执行：

- 生成 200 条工单演示数据
- 手工触发 cron 任务
- 进入品控规则管理

### 9.2 生成演示数据

按钮：

- “生成 200 条工单”

作用：

- 批量生成不同状态、不同类型的演示工单
- 便于测试列表、筛选、详情、审批历史

### 9.3 手工触发 cron

按钮：

- “手工触发 cron”

会弹出输入框，让你输入 `CRON_SECRET`。

cron 当前处理的内容：

- 工单超时升级
- 二级审批超时自动驳回
- 品控暂扣超时升级
- 审批人禁用兜底转交

### 9.4 品控规则后台

页面地址：

- `/admin/qc-rules`

可以做：

- 查看所有规则
- 新建规则
- 编辑规则
- 删除规则

规则字段说明：

- `name`：规则名
- `subtype`：异常子类型
- `severity`：严重度
- `enabled`：是否启用
- `condition_json`：触发条件
- `decision_json`：触发结果和审批层级

当前扫描接口会直接读取 `v3_qc_rules` 里的启用规则，所以后台修改后会立即生效。

示例条件 JSON：

```json
{
  "kind": "qty_diff_ratio",
  "gte": 0.02
}
```

示例决策 JSON：

```json
{
  "result": "HOLD",
  "targetLevel": 1
}
```

## 10. 推荐演示路径

如果你要验收或演示，建议这样走：

1. 启动 V2 和 V3
2. 用管理员登录 V3
3. 去 `/admin/qc-rules` 看规则
4. 去 `/admin` 生成 200 条工单
5. 去 `/tickets` 验证筛选和分页
6. 用上报人A 登录，手工上报一条物流异常
7. 用一级审批A / 二级审批A 登录审批
8. 去 `/tickets/[id]` 看审批历史
9. 去 `/monitor` 看 V2 接口调用日志
10. 去 `/admin` 手工触发一次 cron

## 11. 关键接口

### 11.1 V3 调用 V2

V2 需提供桥接接口：

- `GET /api/v3-bridge/waybills/{externalCode}`
- `GET /api/v3-bridge/waybills/{externalCode}/items`
- `POST /api/v3-bridge/waybills/validate-sku`
- `GET /api/v3-bridge/waybills/list`

### 11.2 V3 核心接口

- `POST /api/scan`
- `GET /api/tickets`
- `POST /api/tickets`
- `GET /api/tickets/[id]`
- `POST /api/tickets/[id]/approve`
- `POST /api/tickets/[id]/fast-release`
- `POST /api/tickets/[id]/resubmit`
- `POST /api/admin/seed`
- `POST /api/cron`
- `GET /api/admin/qc-rules`
- `POST /api/admin/qc-rules`
- `PUT /api/admin/qc-rules/[id]`
- `DELETE /api/admin/qc-rules/[id]`

## 12. 当前完成度

当前已完成的重点模块：

- 登录与会话
- 扫描品控
- 手工上报
- 分级审批
- 快速放行
- 重提
- 审批历史
- V2 接口日志监控
- 后台演示造数
- cron 手工触发
- 品控规则后台

当前还可以继续增强的点：

- 品控规则支持更多 `kind`
- 工单详情增加“实时从 V2 刷新快照”按钮
- 更完整的库存联动明细
- 更细的角色范围控制
