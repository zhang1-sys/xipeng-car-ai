# 小鹏 C 端 AI Agent

这是一个面向小鹏岗位 `AI 产品经理（C 端）` 打造的作品型项目。

项目目标不是做一个泛汽车聊天机器人，而是做一个围绕小鹏用户真实购车与服务场景的 AI Agent，重点覆盖：

1. 购车需求识别
2. 小鹏车型推荐
3. 小鹏车型对比
4. 小鹏配置器引导
5. 门店匹配与试驾转化
6. 车主服务问答与人工升级

当前仓库已经具备前后端、Agent runtime、配置器、试驾留资、运维面板、评测和部署基础，但当前版本仍然存在明显的前端混乱、问答不稳、配置器体验粗糙和主链路 bug，后续开发将严格收敛到“小鹏单品牌主链路”的最后一轮重构。

## 当前唯一任务板

当前不再维护旧的长期路线图，产品目标、实施优先级、部署把控和面试展示策略统一收口到：

- [docs/xpeng-c-end-agent-roadmap.md](C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/docs/xpeng-c-end-agent-roadmap.md)

当前 `docs/` 中只有这两类文档会继续保留：

1. 当前公开 demo 任务板
2. 必要的技术实施文档

## 技术栈

- 前端：Next.js 14 App Router
- 后端：Node.js + Express
- 模型接入：Moonshot / OpenAI 兼容接口
- 存储：File provider / Postgres provider
- 检索：pgvector 预留

## 当前能力

目前仓库已实现：

1. `/api/chat` 推荐、对比、服务问答
2. `/api/configurator` 配置器流程
3. `/api/test-drive` 试驾留资与门店路由
4. `/api/agent/readiness` readiness 评估
5. `/api/ops/dashboard` 内部运营面板
6. CRM payload / outbox / 顾问分配基础能力
7. smoke test 与离线 eval

## 本地启动

### 后端

```bash
cd backend
copy .env.example .env
npm install
npm start
```

默认启动在 `http://localhost:3001`。

如需真实模型能力，请在 `backend/.env` 中配置以下之一：

- `MOONSHOT_API_KEY`
- `OPENAI_API_KEY`

### 前端

```bash
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

默认启动在 `http://localhost:3000`。

## 构建与运行

### 前端构建

```bash
cd frontend
npm run build
npm start
```

### 后端 smoke

```bash
cd backend
npm run smoke
```

### 后端 eval

```bash
cd backend
npm run eval
```

## 部署

部署说明见：

- [部署指南.md](C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/部署指南.md)
- [docs/pgvector-local-setup.md](C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/docs/pgvector-local-setup.md)

## 当前开发原则

后续开发默认遵守以下原则：

1. 只优先做小鹏单品牌场景
2. 只优先做购车转化主链路
3. 配置器优先级高于泛问答
4. 结构化业务数据优先于向量检索
5. 不使用非授权内部数据源
6. 所有重要能力必须可评测、可追踪、可运营

## 下一步

当前默认不再继续扩功能，优先完成下面四件事：

1. 重构首页信息架构，减少重复模块和重复 CTA。
2. 为推荐 / 对比 / 服务接入明确的受控模式，而不是只依赖自由问答。
3. 把配置器重做成可点击的多步流程，而不是聊天式状态机外观。
4. 统一清理主链路 bug，并重新跑通 `frontend lint`、`frontend build`、`backend smoke`、`backend eval`。

详细任务以 [docs/xpeng-c-end-agent-roadmap.md](C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/docs/xpeng-c-end-agent-roadmap.md) 为准。
