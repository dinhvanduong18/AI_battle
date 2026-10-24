# Deploy AI Battle

The frontend is a Vite single-page app for Vercel. The account, matchmaking,
and tournament API is a separate Docker service for Render and needs PostgreSQL
and Redis. Deploy the backend first so its URL can be configured in Vercel.

## Render backend

1. In Render, create a Blueprint from this repository and select `render.yaml`.
   The Blueprint creates the backend, PostgreSQL database, and Redis Key Value
   service. The backend Docker build context must remain the repository root;
   its Dockerfile is `server/Dockerfile`.
2. When prompted for `PUBLIC_ORIGIN`, enter the production Vercel origin,
   including `https://` and no trailing slash (for example,
   `https://ai-battle.vercel.app`). This must exactly match the browser's
   origin; update it in the Render backend environment if the Vercel domain
   changes.
3. Wait for the backend's `/health` check to pass. Its migrations run at
   startup. Copy the public backend URL, such as
   `https://ottv2-backend.onrender.com`.

The Blueprint generates `JWT_SECRET` and uses private connection strings for
PostgreSQL and Redis. Keep those values private. The Blueprint uses Render's
free plans for testing: the web service can sleep while idle, free PostgreSQL
expires after its retention period, and Redis queue data can be lost when the
service restarts. Do not use this setup for production data or uninterrupted
matchmaking. Check Render's current free-plan availability and limits before
creating the Blueprint. Replay storage uses PostgreSQL by default;
S3-compatible storage is optional.

## Vercel frontend

1. Import the same repository into Vercel. Keep the project root at the
   repository root; `vercel.json` configures the Vite build and `dist` output.
2. Set the Vercel environment variable `VITE_BACKEND_URL` to the Render backend
   URL, with no trailing slash. Set it for every environment you intend to use
   (Production, Preview, and/or Development). This variable is public and is
   embedded in the frontend build; never put secrets in a `VITE_` variable.
3. Deploy or redeploy the frontend. If you use a Preview deployment, set that
   preview's exact `https://...vercel.app` origin as Render's `PUBLIC_ORIGIN`
   before testing API access from it. The backend currently accepts one
   configured production origin, not an arbitrary set of preview domains.
4. Open the deployed app and check that the backend health check succeeds and
   that account registration/login works. Also test WebSocket matchmaking from
   two browsers; Render must serve the backend over HTTPS so the client uses
   WSS.

The Render service may take time to wake up on plans that sleep while idle.
WebSocket matches require the backend to remain available for the duration of
the match. Browser bot runtime downloads also need access to jsDelivr.

## Local checks

From the repository root:

```sh
npm run build
npm run lint
npm --prefix server test
```

The backend can also be run with `server/docker-compose.yml`; see
[`server/README.md`](./server/README.md) for local environment setup.
