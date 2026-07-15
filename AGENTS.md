# NugaCore Agent Instructions

This repository vendors agent skills under `agent/skills/`. **Start at [`agent/README.md`](agent/README.md)** for the full catalog, sync scripts, and task bundles.

## Skill loading policy

Use [`agent/skills/README.md`](agent/skills/README.md) or [`agent/skills/MANIFEST.json`](agent/skills/MANIFEST.json) as the index. At minimum:

- For any WISP/NOC/SaaS work: read `agent/skills/software-development/wisp-noc-saas-development/SKILL.md`.
- For Supabase, Postgres, auth, RLS, REST, migrations, or database security: read:
  - `agent/skills/data-platform/supabase/SKILL.md`
  - `agent/skills/software-development/supabase-postgres-best-practices/SKILL.md`
- For frontend UI, React, Vite, or Tailwind work: read:
  - `agent/skills/software-development/vercel-react-best-practices/SKILL.md`
  - `agent/skills/software-development/tailwind-4-docs/SKILL.md`
  - `agent/skills/software-development/web-design-guidelines/SKILL.md`
  - `agent/skills/testing/playwright/SKILL.md` when browser/E2E validation is needed.
- For new features and bug fixes: read `agent/skills/software-development/test-driven-development/SKILL.md`.
- For debugging: read `agent/skills/software-development/systematic-debugging/SKILL.md`.
- For Docker/Compose/local stack work: read `agent/skills/devops/docker-management/SKILL.md`.
- For Prometheus/Grafana/metrics work: read:
  - `agent/skills/observability/prometheus/SKILL.md`
  - `agent/skills/observability/promql/SKILL.md`
- For security-sensitive code review or hardening: read `agent/skills/security/security-best-practices/SKILL.md`.
- For PRs, branches, commits, or GitHub workflow: read `agent/skills/github/github-pr-workflow/SKILL.md`.
- For suspicious commits, force-pushes, or supply-chain investigation: read `agent/skills/security/oss-forensics/SKILL.md`.
- For handoff docs: read `agent/skills/productivity/document-workflows/SKILL.md` and keep public docs sanitized.

## Cursor auto-discovery

`.agents/skills/` contains symlinks to `agent/skills/`. Regenerate after clone with:

```bash
./agent/scripts/link-agent-skills.sh
```

## Project guardrails

- Do not commit secrets, tokens, JWTs, host passwords, private deployment IDs, or detailed private ops logs.
- Keep GitHub-facing documentation sanitized and current: what exists, what is missing, production-readiness gates, roadmap direction, and handoff checklists.
- Cold-start handoff (Router/WG julio 2026): `docs/reports/SPRINT_HANDOFF_2026-07-15.md` and `docs/reports/PROJECT_STATUS_CURRENT.md`.
- For NugaCore staging validations, confirm the requested commit is on `origin/main` first; if it is missing, report `NO APROBADA`.
- Do not change shared staging passwords unless explicitly requested.
- Respect strict no-router/no-live/no-migration boundaries unless explicitly authorized by the user.
- When safe and within guardrails, proactively fix validation blockers instead of only reporting them.

## Cursor Cloud — SSH al VPS

En runs de Cloud Agent, al inicio (o tras `install` en `.cursor/environment.json`):

```bash
bash scripts/vps/bootstrap-ssh-access.sh
```

Tras la primera conexión exitosa, persistir para futuros runs:

```bash
bash scripts/vps/persist-ssh-key-for-environment.sh
```

Requiere secreto `VPS_SSH_PRIVATE_KEY` en Cursor Cloud Environment (ver `docs/CLOUD_AGENT_VPS_SSH.md`). No commitear claves privadas.

## Verification expectations

When building or changing code, provide real execution evidence. Prefer the narrowest relevant checks first, then broader checks when appropriate:

- `npm run lint`
- `npm test`
- `npm run build`
- Targeted Vitest commands where applicable
- Supabase REST/advisor checks when touching database/auth behavior
- Browser/staging checks when validating UI behavior

Do not claim completion from inspection alone if runnable verification is available.

## Cursor Cloud specific instructions

Durable, non-obvious notes for running this repo in the cloud dev environment (dependencies are already installed by the startup update script; do not re-document install steps here).

- **Single process, port 3000.** `server.ts` serves BOTH the React SPA and the Express API (`/api/*`) from one Node process on `http://localhost:3000`. There is no separate frontend server.
- **Dev is hermetic (Fase 0).** The app runs fully with no external services: in-memory stores (all `USE_DB_*=false`) plus `AUTH_TRUST_HEADERS=true`. Supabase, Gemini, and MikroTik/RouterOS are all optional and default to mock/simulated. Copy `.env.example` to `.env` (its defaults are dev-ready).
- **Serve-mode gotcha:** `server.ts` auto-selects `static` mode whenever `dist/index.html` exists (i.e. after any `npm run build`). To force the true Vite dev server with HMR, run `SERVE_MODE=dev npm run dev:tsx`. `npm run dev` intentionally builds then serves the static bundle.
- **UI login requires Supabase.** The login form (`src/components/LoginForm.tsx`) only authenticates when `VITE_SUPABASE_*` are set. In the default no-Supabase dev setup you cannot log in via the form. To enter the app in dev, seed a session profile into `localStorage` (the app's supported trusted-headers path), then reload:
  `localStorage.setItem('nugacore_user_profile', JSON.stringify({id:'dev-superadmin',email:'dev@nugacore.local',full_name:'Dev Super Admin',role:'Super Admin',permissions:[]}))`
  Roles: `Super Admin` | `Administrador` | `Cobranza` | `Técnico` | `Soporte` | `Solo lectura`. The backend then trusts `x-user-role`/`x-user-id` headers sent by the frontend.
- **Tests:** `npm test` is hermetic (no network/secrets). The `test:db`, `test:db:billing`, and `test:auth` suites require a live Supabase and are skipped otherwise — do not treat their skips as failures.
- **Lint = eslint + typecheck.** `npm run lint` runs ESLint then `tsc` for both `tsconfig.json` (frontend) and `tsconfig.backend.json` (backend). Pre-existing `no-explicit-any` warnings in tests are expected (0 errors is the gate).
