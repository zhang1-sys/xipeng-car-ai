# 小鹏 C 端购车 AI Agent Demo

这是一个面向小鹏 `AI 产品经理（C 端）` 岗位准备的公开作品。

目标不是做一个泛聊天机器人，而是做一个围绕小鹏 C 端购车与服务主链路的 AI Agent Demo，让面试官可以直接打开链接体验，并快速看懂以下能力：

1. 车型推荐
2. 车型对比
3. 多步配置器
4. 试驾 CTA 闭环
5. 用车服务问答
6. 可运营、可评测、可部署的产品骨架

## 项目定位

这个项目强调的是“像产品的 Agent”，不是“像聊天的 Agent”。

核心设计原则：

1. 优先服务小鹏单品牌 C 端主链路
2. 优先覆盖 `推荐 -> 对比 -> 配置 -> 试驾 CTA`
3. 用结构化输出约束 Agent，而不是把成败交给自由对话
4. 所有关键能力都要可观测、可评测、可复现

## 当前已经具备的能力

### 用户侧能力

1. 推荐模式：基于预算、城市、场景、补能条件做车型推荐
2. 对比模式：围绕 G6 / G9 等车型做结构化对比
3. 配置器：独立于聊天区的多步配置流程
4. 试驾 CTA：支持提交试驾线索、门店匹配、顾问跟进骨架
5. 服务模式：针对冬季续航、补能、保养、OTA 等问题做服务问答

### 系统侧能力

1. 前后端分离：Next.js 14 + Node.js / Express
2. Agent runtime：模式控制、工具调用、fallback、trace、readiness
3. 业务数据适配层：catalog / stores / rights / advisors
4. CRM skeleton：outbox、ack、callback、同步状态流转
5. 运营能力：`/ops` 面板、审计日志、config status、readiness
6. 评测能力：`smoke` 与 `eval`
7. 部署骨架：Docker Compose + Nginx + Postgres baseline

## 主链路

这版 demo 的标准体验路径是：

1. 首页进入推荐
2. 把候选车型收敛到 1-2 款
3. 进入车型对比
4. 从结果中直接进入配置器
5. 完成配置后直接进入试驾 CTA

当前版本已经对这条链路做了收口：

1. 推荐结果支持直接进入配置器或预约试驾
2. 对比结果支持直接进入配置器
3. 配置完成后可直接预约试驾或让顾问跟进
4. 聊天与配置器会话做了 channel 隔离，避免上下文串味

## 当前边界

这是公开 demo，不冒充内部生产系统。

请明确按下面边界理解：

1. 车型、门店、权益、顾问等数据当前基于公开网页快照和本地结构化数据
2. 当前没有接入小鹏内部生产 CRM、库存、订单、顾问排班系统
3. 试驾链路用于演示 CTA、线索结构和 CRM skeleton，不代表真实内部接单
4. 涉及价格、权益、库存、到店能力时，以官方渠道和门店为准

这不是缺点，而是刻意控制边界后的产品化表达：

1. 对外展示诚实
2. 对内扩展清晰
3. 面试时能讲清楚“demo 如何演进成真实系统”

## 仓库结构

```text
xpeng-car-ai/
├─ frontend/                  # Next.js 前端
├─ backend/                   # Express 后端与 Agent runtime
├─ deploy/                    # Docker / Nginx / 环境变量模板
├─ docs/                      # 路线图、发布清单、面试 walkthrough
└─ 部署指南.md                # 从零部署说明
```

重点目录说明：

1. `frontend/app/page.tsx`
   主页、推荐/对比/配置器入口、聊天区与配置器区联动
2. `backend/server.js`
   核心 API 入口、会话管理、ops、crm、health、knowledge
3. `backend/commercialAgent.js`
   商业化 Agent 的规划、工具、trace、structured output、fallback
4. `backend/smoke-test.js`
   主链路冒烟检查
5. `backend/eval-runner.js`
   场景评测与 release gate

## 本地启动

### 后端

```bash
cd backend
copy .env.example .env
npm install
npm start
```

默认地址：`http://localhost:3001`

如需真实模型能力，请在 `backend/.env` 配置以下之一：

1. `MOONSHOT_API_KEY`
2. `OPENAI_API_KEY`

### 前端

```bash
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

默认地址：`http://localhost:3000`

如果本地 `next dev` 资源异常，可改用：

```bash
npm run build
npm start
```

## 验证命令

### 前端

```bash
cd frontend
npm run lint
npm run build
```

### 后端

```bash
cd backend
npm run smoke
npm run eval
```

当前建议把下面 4 个结果作为发布门禁：

1. `frontend lint`
2. `frontend build`
3. `backend smoke`
4. `backend eval`

## 对面试官的标准演示方式

建议 2 到 3 分钟内完成下面路径：

1. 先说明这是公开 demo，不接内部系统
2. 输入推荐问题，展示候选收敛
3. 做一次 G6 / G9 对比
4. 从结果进入配置器
5. 完成一次配置
6. 点击试驾 CTA

相关话术和脚本可参考：

1. `docs/public-demo-interview-walkthrough.md`
2. `docs/public-demo-release-checklist.md`

## 你可以怎么讲这个项目

一句话版本：

> 这是一个围绕小鹏 C 端购车与服务链路设计的 AI Agent Demo，不是泛聊天，而是把推荐、对比、配置器和试驾 CTA 做成可访问、可评测、可部署的产品骨架。

面试时重点强调三件事：

1. 我不是在堆 AI 功能，而是在收口主链路
2. 我不是只做界面，而是做了评测、运营、CRM skeleton 和部署基线
3. 我知道 demo 与真实上线的边界，并且已经把 provider / outbox / ops 接口预留出来

## 离真实上线还差什么

如果要从公开 demo 演进到真实可运营系统，还需要补齐：

1. 授权业务数据接入
2. 真实 CRM 与线索回执闭环
3. Postgres / Redis 生产基线
4. 更完整的安全、审计、PII 治理
5. 更严格的线上监控、告警、灰度和回滚策略

但如果目标是“面试能拿得出手，并且能发链接访问”，当前项目已经具备非常强的产品骨架，只需要把部署和公网环境收口好即可。

## 部署

部署相关说明见：

1. `部署指南.md`
2. `deploy/env.example`
3. `docs/pgvector-local-setup.md`

推荐方向：

1. 演示 / 小规模试点：Docker Compose
2. 正式生产基线：Postgres + pgvector + 受控 ops 访问

## 相关文档

1. `docs/xpeng-c-end-agent-roadmap.md`
2. `docs/public-demo-release-checklist.md`
3. `docs/public-demo-interview-walkthrough.md`
4. `docs/data-source-and-crm-skeleton.md`
