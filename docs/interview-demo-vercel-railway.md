# Interview Demo Deployment: Vercel + Railway + pgvector

This path is for a public demo link that should feel close to local usage:

- Next.js frontend on Vercel
- Node/Express backend on Railway
- Railway PostgreSQL with `pgvector`
- Postgres-backed session memory
- Postgres-backed knowledge retrieval
- Ops panel and readiness checks enabled

## Why this path

- Vercel fits the existing Next.js frontend with minimal changes.
- Railway is enough for the backend and a managed database.
- `STRICT_PRODUCTION=1` can stay enabled.
- With `AUTO_APPLY_DB_SCHEMA=1` and `AUTO_BOOTSTRAP_KNOWLEDGE=1`, first deploy needs fewer manual steps.

## Platform setup

### 1. Push the repo to GitHub

Vercel and Railway will both deploy from the same repository.

### 2. Create a Railway `pgvector` database service

Use a Railway PostgreSQL service that supports the `vector` extension. The backend schema runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

So a plain PostgreSQL service without the extension is not enough for the full retrieval path.

### 3. Create a Railway backend service

- Import the same GitHub repo
- Set `Root Directory` to `backend`
- Railway config file: `backend/railway.toml`

The backend start command is already aligned to:

```bash
npm run start:railway
```

That startup path can:

- apply the database schema
- bootstrap local knowledge sources
- prepare chunks
- import chunks into Postgres
- embed chunks into pgvector
- start the backend

### 4. Configure Railway backend env vars

Start from [backend/.env.railway.pgvector.example](/C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/backend/.env.railway.pgvector.example).

Required values:

- `ALLOWED_ORIGINS`
- `OPS_ACCESS_TOKEN`
- `MOONSHOT_API_KEY` or `OPENAI_API_KEY`
- `DATABASE_URL`
- `EMBEDDING_API_KEY`

Recommended production values:

```env
NODE_ENV=production
STRICT_PRODUCTION=1
STORAGE_PROVIDER=postgres
KNOWLEDGE_RETRIEVAL_PROVIDER=postgres
DATABASE_SSL=require
AUTO_APPLY_DB_SCHEMA=1
AUTO_BOOTSTRAP_KNOWLEDGE=1
```

Notes:

- `DATABASE_URL` should come from the Railway `pgvector` service.
- `EMBEDDING_API_KEY` should point to a provider that supports embeddings. `text-embedding-3-small` is the current default in this repo.
- If your main chat provider does not support embeddings, keep chat on Moonshot and embeddings on OpenAI. The backend already supports split providers.

### 5. Wait for Railway first deploy

The first deploy is heavier than normal because it may:

- create schema
- import knowledge docs
- generate embeddings

After deployment, open:

```text
https://your-backend.up.railway.app/health
```

You should get a JSON response.

### 6. Create a Vercel frontend project

- Import the same GitHub repo
- Set `Root Directory` to `frontend`
- Vercel config file: `frontend/vercel.json`

Set the frontend env var from [frontend/.env.vercel.example](/C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/frontend/.env.vercel.example):

```env
NEXT_PUBLIC_API_URL=https://your-backend.up.railway.app
```

Deploy once and get your stable Vercel URL:

```text
https://your-project.vercel.app
```

### 7. Backfill CORS on Railway

After Vercel gives you the real URL, update:

```env
ALLOWED_ORIGINS=https://your-project.vercel.app
```

Then redeploy Railway.

Without this, production CORS will block browser requests.

## Final checks before sharing the link

Open the Vercel URL and verify:

1. Home page styles are loaded.
2. Chat streams normally.
3. Recommendation cards render correctly.
4. Comparison flow works.
5. Configurator opens and does not freeze.
6. Test-drive form can submit.
7. `/ops` loads after you enter `OPS_ACCESS_TOKEN`.

## Important limits

- This setup gives you a public interview demo, not a hardened production system.
- If you change `EMBEDDING_MODEL` away from 1536 dimensions, you must keep it compatible with the `knowledge_chunks.embedding vector(1536)` schema.
- First deploy time is longer because of knowledge initialization.
