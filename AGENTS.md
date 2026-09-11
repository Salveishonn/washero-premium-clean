# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

**Washero** is a single TanStack Start + React 19 app (not a monorepo) for on-demand car wash booking: public site (`/`, `/reservar`), admin (`/admin/*`), operator PWA (`/operator/*`). Data and auth use **hosted Supabase** (`domslcbxgqbylmciqrxt`); production SSR targets **Cloudflare Workers** (`wrangler.jsonc`, `src/server.ts`). There is no Docker or local Supabase stack in this repo.

### Toolchain

- **Package manager:** Bun (`bun.lock`, `bunfig.toml`). Install Bun to `~/.bun/bin` if missing; ensure `PATH` includes `$HOME/.bun/bin` before `bun` commands.
- **Node:** v22+ (no `.nvmrc`; `@types/node` targets 22).
- **Env:** `.env` at repo root (Supabase + optional `VITE_*` keys). Required for dev: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or publishable key aliases in `.env`).

### Commands (see `package.json`)

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev server | `bun run dev` → Vite on **port 8080** (Lovable sandbox config, not 5173) |
| Lint | `bun run lint` (ESLint + Prettier; many existing issues in `supabase/functions/`) |
| Build | `bun run build` |
| Format | `bun run format` |

There is **no test script** in `package.json` (no Vitest/Playwright wired).

### Services for local development

| Service | Required locally? | Notes |
|---------|-------------------|--------|
| Vite dev (`bun run dev`) | Yes | SSR + HMR |
| Hosted Supabase | Yes | DB, Auth, RLS; schema/seed in `db/README.md` and `supabase/migrations/` |
| Supabase Edge Functions | Yes for full booking | Deployed on the same project; booking calls functions like `get-public-availability`, `create-website-booking` |
| Cloudflare Workers | No for typical dev | Use `bun run build` + `wrangler dev` only for prod-like SSR checks |
| Google Maps / MercadoPago / Botmaker | Optional | Keys in `.env` or Supabase function secrets |

### Gotchas

- **Dev port is 8080**, not the default Vite 5173 (`@lovable.dev/vite-tanstack-config` sets host/port).
- Do **not** duplicate plugins in `vite.config.ts` (TanStack Start, React, Tailwind, Cloudflare are already included by `defineConfig` from Lovable).
- **Lint** may fail on a clean tree due to Prettier drift in Deno edge functions; `src/` app code still builds with `bun run build`.
- Full E2E booking needs edge functions deployed to the Supabase project referenced in `.env`, not only the Vite app.

### Database setup (one-time on Supabase)

Per `db/README.md`: run `db/migrations/0001_init_washero.sql` then `db/seed/0001_seed_washero.sql` in Supabase SQL Editor (idempotent). Additional migrations live under `supabase/migrations/`.
