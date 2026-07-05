---
name: wisp-noc-saas-development
description: "Use when planning, implementing, validating, or documenting NugaCore WISP/NOC/SaaS work: billing, clients, plans, NOC dashboards, RouterOS/MikroTik read-only integrations, Supabase-backed data flows, staging validation, and production-readiness gates."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [nugacore, wisp, noc, saas, routeros, mikrotik, supabase, staging]
    related_skills: [development-workflows, systematic-debugging, supabase-postgres-best-practices, vercel-react-best-practices, tailwind-4-docs, github-pr-workflow]
---

# WISP / NOC / SaaS Development for NugaCore

## Overview

Use this skill as the project-level operating guide for NugaCore. It captures the safe way to work on a WISP/NOC SaaS platform without relying on chat history or private machine-local notes.

The repo-vendored copy is intentionally sanitized: it excludes private hostnames, deployment UUIDs, real IP addresses, passwords, JWTs, tokens, raw staging credentials, and detailed private ops logs. If a task needs private operational data, read it only from approved local secret sources or ask the user; never add it to this repo.

## When to Use

Load this skill when the task touches any of these areas:

- NugaCore roadmap, production readiness, handoff documentation, or staging validation.
- WISP client/plan/billing workflows.
- NOC read-only dashboards, telemetry, inventory, service status, or observability.
- MikroTik / RouterOS / CHR read-only integrations or provisioning previews.
- WireGuard manager or router enrollment workflows.
- Supabase-backed application data, REST behavior, RLS, auth, or migrations.
- Feature flags, staging/production gates, or safe operational rollout.

## Hard Guardrails

1. Do not commit secrets, JWTs, tokens, passwords, private deployment IDs, hostnames, raw IPs for private infrastructure, or detailed ops logs.
2. Keep GitHub-facing documentation sanitized: describe what exists, what is missing, readiness gates, roadmap direction, and handoff checklists.
3. Respect no-router/no-live/no-migration boundaries unless the user explicitly authorizes that scope.
4. For staging validations, confirm the requested commit exists on `origin/main` first; if it is missing, report `NO APROBADA`.
5. Do not change shared staging passwords unless explicitly requested.
6. Prefer read-only validation for network devices and NOC telemetry unless the user explicitly asks for write/provisioning behavior.
7. If credentials are needed, source them from approved local env/secret files and print only sanitized status summaries.

## Default Workflow

1. Identify the feature area and load companion skills:
   - Supabase/Postgres: `data-platform/supabase` and `supabase-postgres-best-practices`.
   - React/Tailwind UI: `vercel-react-best-practices` and `tailwind-4-docs`.
   - Debugging: `systematic-debugging`.
   - GitHub/PR work: `github-pr-workflow`.
2. Inspect the current repo state and relevant docs before making changes.
3. Make the smallest safe change that moves toward production readiness.
4. Run the narrowest relevant verification first, then broader checks.
5. Update sanitized docs/handoff notes when the change affects future operators.
6. Report real execution evidence, not assumed success.

## Implementation Principles

- Keep domain logic behind clear service boundaries: auth/RBAC, billing, NOC telemetry, RouterOS read-only, provisioning preview, and suspension flows should not be tangled in UI components.
- Keep frontend feature flags and backend authorization aligned; a hidden UI is not a security boundary.
- Prefer server-side RBAC checks for protected API routes.
- For read-only RouterOS/NOC work, prove there are no write methods or execution paths.
- For billing/suspension work, prefer dry-run and preview flows before any live or irreversible operation.
- Avoid writing generated secrets or complete RouterOS scripts to docs, logs, or final replies.

## Verification Matrix

Use the checks that fit the change:

- TypeScript/static checks: `npm run lint` or `npm run typecheck`.
- Unit/API tests: `npm test` or targeted Vitest tests.
- Build validation: `npm run build`.
- Supabase/API validation: sanitized REST checks, RLS/advisor checks, and role matrices.
- UI validation: browser or bundle checks for the current deployed asset; call out cache/hard-refresh issues when applicable.
- Device/NOC validation: read-only probes, sanitized status summaries, no credential/script leakage.

## Staging Validation Pattern

1. Confirm commit on `origin/main`.
2. Confirm deployment/build contains the expected commit or asset hash.
3. Validate health endpoints and relevant API routes.
4. Validate Auth/RBAC with real sessions only when safe; never print tokens.
5. Validate UI markers against the current served bundle, not stale browser cache.
6. Scan logs/output summaries for accidental secret leakage.
7. Document PASS/FAIL with exact commands run and sanitized evidence.

## Documentation Rules

Good GitHub-facing docs should include:

- Current status and scope.
- What was implemented.
- What remains missing.
- Production-readiness gates.
- Validation commands and sanitized results.
- Handoff checklist for technicians or future coding agents.

Do not include:

- Real credentials or tokens.
- Private hostnames/IPs/deployment UUIDs.
- Raw logs that may contain private infrastructure details.
- Full RouterOS scripts with embedded secrets.

## Common Pitfalls

1. Treating UI visibility as authorization. Backend checks are required.
2. Validating a stale frontend bundle after deployment; verify the current asset hash or hard-refresh.
3. Printing JWTs, service-role keys, passwords, or full scripts while debugging.
4. Running migrations or live router actions without explicit authorization.
5. Writing detailed ops runbooks with private infrastructure identifiers into GitHub.
6. Reporting staging approval before confirming the requested commit exists on `origin/main`.

## Verification Checklist

- [ ] Relevant companion skills loaded/read.
- [ ] Scope respects no-router/no-live/no-migration boundaries.
- [ ] Secrets and private ops identifiers kept out of repo/docs/final reply.
- [ ] Real checks executed and summarized with sanitized evidence.
- [ ] Docs updated when the change affects handoff or production readiness.
