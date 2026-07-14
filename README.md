# NugaCore ERP

NugaCore is a WISP/FTTH operations platform built with React + Vite + TypeScript + Express.

## Project Direction

- Roadmap maestro: [ROADMAP.md](ROADMAP.md)
- Production readiness checklist: [docs/PRODUCTION_READINESS_CHECKLIST.md](./docs/deployment/PRODUCTION_READINESS_CHECKLIST.md)
- Development handoff checklist: [docs/DEVELOPMENT_HANDOFF_CHECKLIST.md](./docs/planning/DEVELOPMENT_HANDOFF_CHECKLIST.md)
- Architecture reference: [docs/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)

Current high-level status:
- Core platform, Auth/RBAC, Customers, Plans, Billing, Payment Engine and Suspension Engine are functionally advanced.
- WireGuard Manager, Router Enrollment, Template Engine and Dynamic Parameters are advanced but still require production-readiness gates.
- MikroTik live execution, NOC, Inventory, Tickets, CRM, Mobile, AI Operations and SaaS Multiempresa remain future phases.
- Production requires the checklist gates: persistence after restart, tests, build, backups/restore, secret hygiene, RBAC, and no RouterOS live actions without approval.

## Stack

- Frontend: React 19, Vite 6, TypeScript
- Styles/UI: Tailwind, lucide-react, motion
- Backend: Express + TypeScript (served via tsx in dev)
- AI: @google/genai (with fallback when GEMINI_API_KEY is missing)

## Project Structure

- src/
  - App.tsx
  - components/
  - lib/
    - supabase.ts
    - apiClient.ts
- backend/
  - app.ts
  - register-routes.ts
  - config/
    - env.ts
  - common/
    - logger.ts
    - errors.ts
    - api-response.ts
    - validators.ts
  - services/
    - gemini.ts
  - state/
    - store.ts
  - domains/
    - auth/
    - customers/
    - plans/
    - billing/
    - network/
    - mikrotik/
    - tickets/
    - inventory/
    - gis/
    - dashboard/
- server.ts (bootstrap)

## Install

```bash
npm install
```

## Environment

1. Copy `.env.example` to `.env`
2. Fill values only if needed

Minimal local development values:

```env
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
```

Gemini and Supabase can be empty during Fase 0.

## Run (Development)

```bash
npm run dev
```

Server and frontend run on:
- http://localhost:3000

## Quality Checks

Type check:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

Run production bundle:

```bash
npm run start
```

Clean dist:

```bash
npm run clean
```

## Fase 0 Guardrails

- Do not redesign frontend UI
- Do not alter visual layout, colors, or component structure
- Keep API endpoints compatible with existing frontend calls
- Do not migrate to Next.js in this phase
- Do not wire real Supabase modules yet

## API v1 Compatibility

The frontend currently depends on these endpoint groups:

- /api/dashboard-stats
- /api/notifications/*
- /api/alerts*
- /api/clients*
- /api/plans
- /api/billing/invoices*
- /api/network-towers*
- /api/olt
- /api/onu
- /api/naps
- /api/onu/provision
- /api/mikrotik/logs
- /api/mikrotik/command
- /api/mikrotik/copilot
- /api/tickets*
- /api/workorders*
- /api/inventory*

Additional domain health endpoints added in Fase 0:
- /api/auth/health
- /api/gis/health

## Notes

- Data is still mock/in-memory in Fase 0 by design.
- Modular backend is now ready for phased migration to real persistence in Fase 1+.
