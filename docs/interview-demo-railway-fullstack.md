# Interview Demo Deployment: Railway Frontend + Railway Backend + Railway Postgres

This path is for a public demo link that should be easier to open on mobile networks than `vercel.app`.

- Next.js frontend on Railway
- Node/Express backend on Railway
- Railway PostgreSQL with `pgvector`
- Postgres-backed session memory
- Postgres-backed knowledge retrieval

## Why this path

- Avoids `vercel.app` access instability on some mobile networks.
- Keeps frontend and backend on the same deployment platform.
- Reuses the existing standalone Next.js runtime in this repo.

## 1. Keep the backend service as-is

Your backend Railway service can stay the same:

- Root Directory: `backend`
- Config file: `backend/railway.toml`
- Health check: `/health`

Backend URL example:

```text
https://your-backend.up.railway.app
```

## 2. Create a new Railway frontend service

- In Railway, click `New Service`
- Choose `GitHub Repo`
- Select this repo
- Set `Root Directory` to `frontend`
- Railway config file: `frontend/railway.toml`

Use these commands in the service if Railway does not infer them automatically:

```text
Install Command: npm install
Build Command: npm run build
Start Command: npm start
```

The frontend already builds as Next.js standalone and starts with:

```bash
npm start
```

## 3. Configure Railway frontend env vars

Start from [frontend/.env.railway.example](/C:/Users/Zhanghs/Desktop/小鹏/xpeng-car-ai/frontend/.env.railway.example).

Required value:

```env
NEXT_PUBLIC_API_URL=https://your-backend.up.railway.app
```

Recommended value:

```env
NODE_ENV=production
```

Important:

- `NEXT_PUBLIC_API_URL` is used by the browser and must point to the public Railway backend domain.
- After you change `NEXT_PUBLIC_API_URL`, redeploy the frontend service so Next.js rebuilds with the new value.

## 4. Backfill backend CORS

After Railway gives you the real frontend URL, put it into the backend service:

```env
ALLOWED_ORIGINS=https://your-frontend.up.railway.app
```

If you want both old and new addresses to work during migration, separate them with commas:

```env
ALLOWED_ORIGINS=https://your-frontend.up.railway.app,https://xipeng-car-ai.vercel.app
```

Then redeploy the backend service.

## 5. Verify both public URLs

Frontend:

```text
https://your-frontend.up.railway.app
```

Backend:

```text
https://your-backend.up.railway.app/health
```

Expected:

1. The frontend URL opens on desktop and mobile.
2. The backend `/health` returns JSON.
3. Chat requests from the frontend no longer fail due to CORS.

## 6. Final share link

For interview use, send the Railway frontend URL, not the backend URL.

Example:

```text
https://your-frontend.up.railway.app
```
