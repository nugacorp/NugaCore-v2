# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NugaCore is a multi-tenant SaaS platform for WISP/ISP operations (wireless and FTTH): one WISP per tenant, with CRM, plans, billing, collections, payments, suspension/reactivation, support, inventory, networking (MikroTik/RouterOS, WireGuard, OLT/FTTH, GIS, NOC/SNMP), customer portal, technician PWA, and reporting.

React + Vite + TypeScript frontend, Express + TypeScript backend, PostgreSQL via Supabase. A single Node process serves both the SPA and the API on port 3000 — there is no separate frontend server.

Full agent instructions live in [AGENTS.md](AGENTS.md); read it before starting non-trivial work. Current status and prioritized blockers: `docs/reports/PROJECT_STATUS_CURRENT.md` (source of truth — this repo deliberately distinguishes "implemented" from "validated against real infrastructure").

## Commands

```bash
npm install

# Dev
npm run dev                    # build + serve the static bundle on :3000
SERVE_MODE=dev npm run dev:tsx # real Vite dev server with HMR

# Quality gates
npm run lint                   # eslint . && tsc --noEmit (both tsconfig.json and tsconfig.backend.json)
npm run lint:fix
npm test                       # full hermetic vitest suite (no network/secrets)
npm run build                  # vite build + esbuild bundle of server.ts -> dist/server.cjs
npm audit --omit=dev

# Targeted test runs
npx vitest run tests/unit/some-file.test.ts
npx vitest run tests/unit/some-file.test.ts -t "test name substring"
npm run test:unit              # tests/unit only
npm run test:integration       # tests/contract only
npm run test:e2e               # tests/e2e via vitest
npm run test:e2e:browser       # Playwright
npm run test:watch

# Hermetic guards (no network, no external service)
npm run validate:migration-files
npm run validate:release-tag -- v2.0.0

# Opt-in suites against REAL infra — fail closed, they do NOT skip quietly
npm run test:db                # RUN_DB_TESTS=true; needs real Supabase creds or it FAILS with an explicit error
npm run test:db:billing        # same opt-in, narrower scope (billing + its customers/plans deps)
npm run test:auth              # RUN_AUTH_TESTS=true, forces NODE_ENV=production (JWT-only); FAILS without creds
npm run test:db:postgres17 -- <case>   # needs a running Docker daemon; may pull postgres:17; FAILS if Docker is unavailable

# Read-only but network-capable — reads local files always; reads a REMOTE
# database only if a Postgres URL is configured (never DDL/DML either way)
npm run report-migration-drift
```

### Non-obvious gotchas

- **`server.ts` auto-selects `static` mode whenever `dist/index.html` exists** (i.e., after any `npm run build`). To force the real Vite dev server with HMR, use `SERVE_MODE=dev npm run dev:tsx` — `npm run dev` intentionally builds then serves the static bundle.
- **UI login requires Supabase.** In the default no-Supabase dev setup, the login form can't authenticate. To enter the app in dev, seed a session into `localStorage` instead:
  `localStorage.setItem('nugacore_user_profile', JSON.stringify({id:'dev-superadmin',email:'dev@nugacore.local',full_name:'Dev Super Admin',role:'Super Admin',permissions:[]}))`
  Roles: `Super Admin` | `Administrador` | `Cobranza` | `Técnico` | `Soporte` | `Solo lectura`.
- **Vitest runs single-threaded on purpose** (`pool: 'forks'`, `fileParallelism: false`, `maxWorkers: 1` in `vitest.config.ts`): contract tests share an in-memory singleton store, and parallel files would interfere with each other.
- **Test env layering**: `tests/setup/test-env.ts` runs before any backend module loads. It forces the hermetic in-memory mode by default (all `USE_DB_*=false`) even if a local `.env` points at a real Supabase project; `RUN_DB_TESTS`/`RUN_AUTH_TESTS` opt into the other two modes.
- Migrations live in `supabase/migrations/` and are applied via `psql` against the pooler — **never `supabase db push`**. Filenames must have a unique `YYYYMMDDHHMMSS` version prefix; two files sharing a prefix leave one silently unapplied forever (this happened once — see `docs/deployment/SUPABASE_MIGRATIONS_SYNC.md`). CI enforces uniqueness via `validate:migration-files`.
- **`report-migration-drift` is read-only but not hermetic.** It always reads local migration files; it also reads remote migration history via `psql` whenever a Postgres URL is configured — any of `MIGRATION_DRIFT_DATABASE_URL`, `STAGING_DATABASE_URL`, `SUPABASE_DB_URL`, or `DATABASE_URL`. It never runs DDL/DML either way. Without any of those four set, it reports `EXTERNAL_BLOCKED` — that is the expected local result, not an error. Don't point it at staging or production without explicit authorization (see `docs/deployment/MIGRATION_DRIFT_READONLY_REPORT.md`).

## Git workflow

**Never push directly to `origin/main`.** Every change — including docs, `CLAUDE.md`, and agent skill/config files — goes through a branch and a PR, even a one-line fix. "Commit it separately" means a separate branch and PR, not a direct commit on `main`.

If an untracked file shows up in the working tree that you didn't just create for the current task, stop and ask before proceeding — don't assume it's safe to commit, move, or delete, and don't reach for `git stash` to make it disappear unless the user explicitly authorizes it.

## Architecture

```
Browser (React SPA)
   │  fetch → /api/*   (Supabase JWT; trusted-headers only in dev)
   ▼
Express — helmet · CORS · rate-limit · auth/RBAC · tenant fail-closed
   │
   ├─ backend/domains/<domain>/{routes,service,repository,mappers}.ts
   │     dual repository switched by USE_DB_<DOMAIN>:
   │        false → in-memory store   |   true → Supabase
   │
   ├─ backend/bridges/network-order-dispatch.ts   (sole gateway to the network)
   └─ backend/domains/mikrotik/worker/             (allowlisted reads / gated writes)
   ▼
Supabase / PostgreSQL
```

### Dual persistence per domain

Core domains (customers, plans, billing, suspension, inventory, support, tenancy, contracts, portal, OLT, WireGuard, router-enrollment, etc.) follow the same shape: `backend/domains/<domain>/{routes.ts, service.ts, repository.ts, mappers.ts}`. Each domain's repository switches between an in-memory store and a Supabase-backed implementation based on its `USE_DB_<DOMAIN>` flag (`backend/config/feature-flags.ts`). The same API and the same contract tests must pass in both modes. This pattern is **not universal** — several domains remain in-memory-only with no Supabase repository yet; the current list is in `docs/reports/PROJECT_STATUS_CURRENT.md`.

Default dev mode is hermetic: every `USE_DB_*` flag `false`, no network, no secrets.

### Fail-closed tenancy

`backend/domains/tenancy/resolve-tenant.ts` never returns a tenant "just in case." When membership can't be proven, it returns a typed denial that middleware turns into 401/403 *before* any repository or handler runs. Grant order: explicit `x-tenant-id` header with active membership → JWT `app_metadata.tenant_id` claim (only if it selects an existing active membership — the claim never creates ownership) → first active membership → `tenant-default` only with the legacy single-WISP gate on. Everything else denies.

### Production gates

Every subsystem with an external effect is off by default (`backend/config/production-gates.ts`): `MIKROTIK_WORKER_LIVE`, `MIKROTIK_WORKER_COMMIT`, `PAYMENTS_ROUTER_LIVE`, `NOTIFICATIONS_LIVE`, `AUTOMATION_EXECUTE`, `PROVISIONING_EXECUTE`, `SAFE_COMMAND_QUEUE_LIVE`, `SERVICE_STATUS_LIVE`, with `NUGACORE_LIVE_MODE` as the master switch. Enabling any of these is a deliberate operational decision, never a side effect of deploying.

### build-once / deploy-many

The OCI image is not built per-environment. Public Supabase config (URL + anon key) is served at runtime from `/runtime-config.js` (via an explicit allowlist, never the raw environment) rather than embedded in the Vite bundle at build time — so the same validated image digest can be promoted across environments by changing only container variables. See `docs/operations/RELEASING.md`.

### Release pipeline

`.github/workflows/release.yml` triggers only on `v*` tags. It validates the tag-version contract (`package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version` must all match the tag exactly — `scripts/validate-release-tag.mjs`), checks GHCR doesn't already have that tag (`scripts/check-ghcr-tags-absent.mjs`, real Docker Registry v2 auth: Basic against the token service → opaque bearer → manifest check, fail-closed on anything but a bare 404), builds multi-arch with SBOM/provenance, and creates the GitHub Release last. Two repository rulesets on `refs/tags/v*` make published tags effectively permanent (creation restricted to the owner account; update/deletion have zero bypass actors for anyone). Full procedure — version-bump PR, merge, wait for CI on the merge SHA, annotated tag, push tag-only (never `--tags`) — in `docs/operations/RELEASING.md`.
