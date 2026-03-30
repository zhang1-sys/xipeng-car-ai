# Postgres + pgvector Deployment Baseline

## Goal

Bring up the project on a **Postgres-backed production baseline** so sessions, leads, CRM outbox, and audit logs do not rely on local files.

当前默认推荐路径：

- Docker Compose
- `STORAGE_PROVIDER=postgres`
- Postgres + pgvector 作为默认持久化
- file storage 仅保留给本地开发 fallback

## Default Docker path

From `deploy/`:

```bash
docker compose up -d --build
```

默认编排现在已经内置：

- `db`（`pgvector/pgvector:pg17`）
- `api`
- `web`
- `nginx`

默认数据库参数：

- database: `xpeng_car_ai`
- user: `xpeng`
- password: `xpeng_dev_password`
- port: `5432`

如果本机已有 Postgres 占用 `5432`，可以改宿主机端口：

```bash
POSTGRES_PORT=5433 docker compose up -d --build
```

`deploy/docker-compose.yml` 会把 `backend/db/schema.sql` 挂到 Postgres init 目录，因此首次初始化会自动建表。

## Required production env

部署时至少要提供：

```bash
PUBLIC_ORIGIN=https://your-public-domain
ALLOWED_ORIGINS=https://your-public-domain
OPS_ACCESS_TOKEN=replace-with-a-real-secret
POSTGRES_DB=xpeng_car_ai
POSTGRES_USER=xpeng
POSTGRES_PASSWORD=replace-with-a-real-password
```

容器内 API 默认使用：

```bash
NODE_ENV=production
STORAGE_PROVIDER=postgres
DATABASE_URL=postgresql://xpeng:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
```

## Production fail-fast

`NODE_ENV=production` 下，后端会拒绝在以下条件缺失时启动：

- `ALLOWED_ORIGINS`
- `OPS_ACCESS_TOKEN`
- `STORAGE_PROVIDER=postgres`
- `DATABASE_URL`

这意味着 production 路径不再允许默认 file storage，也不再允许空白 CORS 配置直接放行。

## Validation steps

最小发布前自检顺序：

```bash
cd frontend
npm run build

cd ../backend
npm run smoke
npm run db:health
```

然后再验证运行中的服务：

```bash
GET /health
GET /api/db/health
GET /api/ops/dashboard
```

## Honest capability boundary

当前这条部署基线解决的是“可部署、可持久化、可自检”，不是“已接通小鹏内部系统”。

明确边界：

- CRM 仍然是 `mock / webhook / live placeholder` skeleton
- business data 的 `live` 仍是公开源/占位 live，不代表已接官方授权内部源
- 真实小鹏内部 CRM、顾问排班、库存、ETA 等仍需授权后接入
