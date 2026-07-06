# V3 运单异常分级审批系统：执行文档索引

本文档集合用于把题目需求落成“可执行的工程计划与契约”，并作为后续编码实现的唯一对齐来源。

## 0. 本项目边界与关键约束

### 0.1 与题目原文的差异（需要显式记录）

题目原文要求“独立部署、独立数据库”。本次实现按你确认的方案落地：

- V2 与 V3：**独立部署（两个 Vercel 项目）**
- 数据库：**同一个 Postgres 实例/同一条连接字符串，但 V3 只使用 `v3_` 前缀的新表**，不读写 V2 业务表
- 系统间数据互通：**V3 仍然只通过 HTTP API 调用 V2 获取运单数据**（禁止 V3 直接查询 V2 的业务表），用于满足“接口互通而非直连”的考核点

### 0.2 本文档集覆盖范围（最小集）

- 需求留白的假设与取值
- V3 调用 V2 的接口契约（需要同时指导 V2 改造与 V3 调用端实现）
- V3 自有数据库表结构与索引
- 两套状态机（工单 + 扫描批次）以及关联规则
- 角色/权限边界与鉴权策略
- 任务拆解与验收清单（可直接按清单逐项实现/自测）

## 1. 文档清单（建议阅读顺序）

- [10-assumptions.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/10-assumptions.md)：《需求理解与假设说明》（题目强制交付物核心内容的工程化版本）
- [20-api-contract-v2.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/20-api-contract-v2.md)：V3↔V2 接口契约（路径/入参/出参/错误码/鉴权/超时重试/RequestId）
- [30-db-schema-v3.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/30-db-schema-v3.md)：V3 数据库表设计（DDL、索引、唯一约束、幂等设计点）
- [40-state-machines.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/40-state-machines.md)：状态机与并发/幂等/超时流转规则
- [50-roles-permissions.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/50-roles-permissions.md)：角色权限模型（含“上报人不能审批自己工单”等强制规则）
- [60-implementation-tasks.md](file:///d:/Project/Exam/ztocc-exam-wwp-v3/doc/60-implementation-tasks.md)：实现任务拆解与验收清单（逐条可执行）

