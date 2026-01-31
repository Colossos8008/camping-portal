Purpose
-------
This file gives immediate, actionable context to an AI coding agent working on this Next.js + Prisma project so it can be productive without asking for basic repo orientation.

Quick run/build commands
- `npm run dev` — start Next.js dev server (app router) on :3000.
- `npm run build` / `npm run start` — build and serve production.
- `npx prisma generate` — regenerate Prisma client (also runs on `postinstall`).
- `npx prisma migrate dev --name <desc>` — create & apply migrations locally.

Key high-level architecture
- Frontend and API live in the Next.js app router under `src/app/`.
  - UI pages and client components: `src/app/*` (map pages are in `src/app/map`).
  - Server/edge API routes: `src/app/api/*` (each `route.ts` exports HTTP handlers like `GET`, `POST`, `DELETE`).
- Database access: single Prisma client exported from `src/lib/prisma.ts`. Uses `@prisma/adapter-pg` with a `pg` Pool and expects `DATABASE_URL` (set in `.env.local`).
- Image storage: browser uploads go to Supabase Storage; server endpoints register/remove metadata in the `image` table.

Important patterns & conventions
- API route functions follow the App Router `route.ts` convention (export `GET`, `POST`, etc.). Example: [src/app/api/places/route.ts](../src/app/api/places/route.ts).
- Server runtime is explicitly set `export const runtime = "nodejs"` in many routes — assume NodeJS runtime for server-only logic.
- DB client usage: import `{ prisma }` from `src/lib/prisma.ts` and always use Prisma models (see `prisma/schema.prisma`).
- Image flow: client uploads files directly to Supabase Storage, then calls the API (e.g. `src/app/api/places/[id]/images/route.ts`) with JSON listing filenames to register them in DB. Server-side deletions call Supabase with a service role key.
- Environment variables: essential vars include `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `src/lib/prisma.ts` throws if `DATABASE_URL` is missing.

Files to inspect first (most relevant)
- [src/app/api/places/route.ts](src/app/api/places/route.ts#L1) — main places API handlers (GET/POST examples).
- [src/app/api/places/[id]/images/route.ts](../src/app/api/places/[id]/images/route.ts) — image registration + Supabase usage.
- [src/lib/prisma.ts](../src/lib/prisma.ts) — Prisma client and Postgres adapter/Pool pattern.
- [prisma/schema.prisma](../prisma/schema.prisma) — DB schema and models.
- [src/app/map/map-client.tsx](../src/app/map/map-client.tsx) and [src/app/map/map-leaflet.tsx](../src/app/map/map-leaflet.tsx) — client-only map code and Leaflet integration.

Specific actionable guidance for agents
- When adding or changing DB models: update `prisma/schema.prisma`, run `npx prisma migrate dev` locally and `npx prisma generate`.
- When changing API route signatures: update the matching `route.ts` handlers under `src/app/api/*` (they export HTTP methods directly). Validate JSON shape in callers (frontend components under `src/app` and `src/app/map/_lib`).
- For image work: prefer the existing pattern—upload from browser to Supabase, then call the register endpoint with filenames; do not attempt to accept large multipart uploads via the Next API route.
- For map/Leaflet work: keep map UI in client components (look for `use client`) and avoid server-side rendering for map code.

Environment & secrets
- Development expects `.env.local` with at least `DATABASE_URL` and `SUPABASE_*` keys. The code will throw if `DATABASE_URL` is missing.

Notes / gotchas discovered in repo
- The Prisma client uses a Postgres adapter and a `pg` Pool (not the default file-based client). Expect Postgres-style `DATABASE_URL` even if a backup sqlite file is present in `prisma/`.
- Image endpoints rely on Supabase service role key server-side — never expose that to the browser.

If something's unclear or you're missing a secret/env, ask: which env is available locally (`.env.local`)?

Feedback
- If this summary missed any important conventions or you want examples expanded (e.g., common frontend API callers, auth patterns), tell me which area to expand.
