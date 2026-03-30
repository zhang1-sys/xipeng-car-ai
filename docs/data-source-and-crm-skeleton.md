# 数据源接入骨架与 CRM 闭环骨架

## 文档目的

这份文档只说明本轮已经搭好的工程骨架：

1. 业务数据如何以 adapter/provider 方式接入
2. CRM 如何从 outbox 升级到 lifecycle skeleton
3. 当前哪些能力是真接通，哪些只是 mock/live placeholder

目标不是假装已经接上真实小鹏内部系统，而是把未来接入真实系统时最关键的接口边界、状态字段和观测面先固定下来。

---

## 1. 业务数据接入骨架

### 1.1 当前原则

当前业务数据仍然严格保持小鹏单品牌边界。

- catalog / stores / rights / advisors 统一走 adapter
- 默认 provider 为 `local`
- `live` 只提供占位入口，不冒充真实已接通
- 所有返回都带 freshness 元信息

### 1.2 provider 切换

按 domain 通过环境变量切换：

- `BUSINESS_DATA_PROVIDER_CATALOG=local|live`
- `BUSINESS_DATA_PROVIDER_STORES=local|live`
- `BUSINESS_DATA_PROVIDER_RIGHTS=local|live`
- `BUSINESS_DATA_PROVIDER_ADVISORS=local|live`

默认全部为 `local`。

### 1.3 统一状态字段

每类数据源统一暴露：

- `data`
- `source`
- `version`
- `fetchedAt`
- `expiresAt`
- `freshnessStatus`
- `errors`

其中 `freshnessStatus` 当前使用：

- `fresh`
- `stale`
- `unavailable`
- `mock_active`
- `degraded`

语义约束：

- `local` 不返回 `fresh`，而是返回 `mock_active`
- `live` 未配置时显式返回 `unavailable`
- `live` 失败且回退时，会暴露 `fallbackUsed` 和错误信息

### 1.4 当前 API

`GET /api/business-data/status`

每个 source 现在会返回：

- `provider`
- `sourceType`
- `count`
- `fetchedAt`
- `expiresAt`
- `freshnessStatus`
- `lastError`
- `errors`
- `remoteConfigured`
- `fallbackUsed`
- `brand`
- `version`

ops 页面和 readiness 页面已经消费这组字段。

---

## 2. CRM 闭环骨架

### 2.1 当前原则

当前 CRM 仍是“可本地演示、可未来替换真实 provider”的骨架，而不是已经接入真实企业 CRM。

- 统一先写入 outbox
- 发送能力走 provider registry
- provider 与 storage 解耦
- 生命周期状态显式化
- 通过 ack/callback 接口模拟回执推进

### 2.2 provider 切换

通过环境变量控制：

- `CRM_PROVIDER=mock|webhook|live`

默认值：`mock`

provider 语义：

- `mock`：本地默认可跑通
- `webhook`：需要配置 `CRM_WEBHOOK_URL`
- `live`：占位 provider，当前明确不可用

### 2.3 outbox 生命周期

当前最小闭环状态为：

- `pending`
- `sent`
- `acknowledged`
- `synced`
- `failed`
- `dead_letter`

语义：

- `pending`：线索已入队，等待发送
- `sent`：已发送给 provider
- `acknowledged`：已收到回执确认
- `synced`：CRM 侧确认已落库/入池
- `failed`：发送或回执失败，可继续处理
- `dead_letter`：终态，需人工排查

### 2.4 当前 API

#### `GET /api/crm/outbox`

查看 outbox 列表和 lifecycle 统计。

#### `POST /api/crm/sync/run`

触发批量同步，返回：

- `attempted`
- `sent`
- `acknowledged`
- `synced`
- `deadLetter`
- `failed`
- `skipped`

#### `POST /api/crm/ack`

用于模拟 CRM ACK：

```json
{
  "outboxId": "...",
  "status": "acknowledged",
  "message": "provider ack"
}
```

#### `POST /api/crm/callback`

用于模拟 CRM callback：

```json
{
  "outboxId": "...",
  "status": "synced",
  "message": "crm callback"
}
```

### 2.5 当前返回字段

`/api/test-drive` 返回的 `crmSync` 已扩展为：

- `id`
- `status`
- `attempts`
- `syncEnabled`
- `lastError`
- `lastHttpStatus`
- `lastAttemptAt`
- `nextAttemptAt`
- `sentAt`
- `ackAt`
- `syncedAt`
- `deadLetterAt`
- `provider`
- `transportStatus`

---

## 3. ops / readiness 当前可观测范围

### `/ops`

当前已经能看到：

- 业务数据 provider / sourceType / freshness / fallback / error
- CRM lifecycle counts
- CRM provider 与启用状态
- 最近 outbox 状态

### `/api/agent/readiness`

当前已经把以下内容纳入 readiness narrative：

- 业务数据是否仍为 local/mock
- CRM lifecycle skeleton 是否具备
- Postgres 存储是否启用
- mock-first / live placeholder 的现状说明

---

## 4. 明确还没做的事情

这轮只搭骨架，没有伪装成真实系统：

1. 没有接入小鹏内部 CRM
2. 没有真实回拉线索状态、到店状态、试驾完成状态
3. 没有真实接入顾问排班或库存系统
4. 没有把 live provider 伪装成可用能力

因此当前系统适合：

- 本地演示
- 试点方案讲解
- 面试中说明“如何从 demo 走到真实接入”

但不应表述为：

- 已完成真实 CRM 集成
- 已完成真实业务源自动同步
- 已具备生产闭环

---

## 5. 上线基线补充约束

在当前版本里，部署默认方案已经收敛到 **Postgres baseline**：

- production 推荐路径走 Docker + Postgres + pgvector
- `STORAGE_PROVIDER=postgres` 是 production 基线
- file storage 仅保留给本地开发 / fallback，不再作为生产推荐方案

同时，production 启动新增 fail-fast：

- 缺 `ALLOWED_ORIGINS` 不允许启动
- 缺 `OPS_ACCESS_TOKEN` 不允许启动
- 非 `postgres` storage baseline 不允许启动
- 缺 `DATABASE_URL` 不允许启动

这保证系统对外表述可以诚实地说“已经具备部署基线与持久化基线”，但仍不能说成：

- 已真实接入小鹏内部 CRM
- 已真实接入官方授权内部业务数据源
- 已拥有完整业务闭环
