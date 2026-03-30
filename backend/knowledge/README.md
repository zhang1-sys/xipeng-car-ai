# Knowledge Pipeline

This directory is the entry point for the future vector retrieval workflow.

## Intended flow

1. put source documents under `backend/knowledge/sources/`
2. run the chunk preparation script
3. generate embeddings for each chunk
4. write documents and chunks into Postgres + pgvector
5. retrieve relevant chunks during owner-service and long-form explanation tasks

## Current status

Already implemented:

- database tables planned in `backend/db/schema.sql`
- chunk preparation script in `backend/knowledge/prepare-knowledge-chunks.js`
- Postgres import script in `backend/knowledge/import-knowledge-to-postgres.js`
- basic keyword search script in `backend/knowledge/search-knowledge-postgres.js`
- local knowledge bootstrap script in `backend/knowledge/bootstrap-service-knowledge-sources.js`
- embedding writeback script in `backend/knowledge/embed-knowledge-in-postgres.js`

Notes:

- API responses now include source metadata and citations for retrieval-backed service answers
- if your machine already has a local Postgres on `5432`, start pgvector with `POSTGRES_PORT=5433 npm run db:pgvector:up`
- if your embedding provider does not expose an embeddings API in local dev, set `EMBEDDING_ALLOW_LOCAL_FALLBACK=true` to keep the pgvector pipeline verifiable

## Supported source files

- `.md`
- `.txt`

## Commands

```bash
cd backend
npm run db:pgvector:up
npm run db:schema
npm run db:health
npm run knowledge:bootstrap-local
npm run knowledge:prepare
npm run knowledge:import
npm run knowledge:embed
npm run knowledge:verify
```

Default output:

- `backend/knowledge/generated/chunks.jsonl`

Keyword search example:

```bash
cd backend
npm run knowledge:search -- OTA 5
```

Local pgvector workflow:

1. Run `npm run db:pgvector:up`
2. Set `STORAGE_PROVIDER=postgres`
3. Set `KNOWLEDGE_RETRIEVAL_PROVIDER=postgres`
4. Set `DATABASE_URL=postgresql://xpeng:xpeng_dev_password@localhost:5432/xpeng_car_ai`
5. Optionally set `EMBEDDING_ALLOW_LOCAL_FALLBACK=true` for local verification when the configured LLM vendor blocks embeddings
6. Run `npm run db:schema`
7. Run `npm run knowledge:prepare && npm run knowledge:import && npm run knowledge:embed`
8. Run `npm run knowledge:verify`

Port-conflict example:

```bash
cd backend
POSTGRES_PORT=5433 npm run db:pgvector:up
DATABASE_URL=postgresql://xpeng:xpeng_dev_password@localhost:5433/xpeng_car_ai
```

Fallback example:

```bash
cd backend
EMBEDDING_ALLOW_LOCAL_FALLBACK=true npm run knowledge:embed
EMBEDDING_ALLOW_LOCAL_FALLBACK=true npm run knowledge:verify
```
