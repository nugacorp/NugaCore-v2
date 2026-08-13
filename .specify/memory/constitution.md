<!--
Sync Impact Report
Version change: N/A -> 1.0.0
Modified principles:
- Template placeholders replaced with NugaCore v2 brownfield governance.
Added sections:
- Runtime And Architecture Boundaries
- Development Workflow And Quality Gates
Removed sections:
- None
Templates requiring updates:
- .specify/templates/plan-template.md: no update in bootstrap; future PR.
- .specify/templates/spec-template.md: no update in bootstrap; future PR.
- .specify/templates/tasks-template.md: no update in bootstrap; future PR.
Follow-up TODOs:
- Align Spec Kit templates with this Constitution in the next governance PR before authoring feature specs.
-->

# NugaCore v2 Constitution

## Core Principles

### I. Production Safety Is Non-Negotiable
NugaCore is a WISP/NOC SaaS platform where database, billing, auth, and router operations can affect real customers. Production access, production migrations, live RouterOS writes, payment-provider writes, credential rotation, or destructive data changes MUST require explicit human authorization, a written preflight, rollback notes, and post-action evidence. Local or staging evidence MUST NOT be represented as production approval.

### II. Tenant Isolation Comes First
Every customer, billing, inventory, support, network, payment, and operational workflow that reads or writes tenant-owned data MUST preserve tenant isolation in the API layer, database layer, tests, and operational scripts. Service-role code and database tests may bypass RLS mechanically, but they MUST still apply explicit tenant filters, assert tenant ownership, and fail closed when tenant context is missing or denied.

### III. Auth And RBAC Fail Closed
Hardened runtimes MUST use verified Supabase JWT identity. Trusted headers are development-only and MUST remain disabled for production or public deployments. Protected routes MUST reject missing auth context, tenant-resolution failure, and unauthorized roles with explicit 401 or 403 responses. Frontend-only role checks are advisory; backend RBAC and action permissions are authoritative.

### IV. Database Schema Changes Are Versioned, Reviewed, And Reversible
Supabase/PostgreSQL schema changes MUST be committed as versioned migrations and reviewed against current staging state before application. Blind `supabase db push`, ad hoc production SQL, destructive migrations, RLS weakening, and data deletion are prohibited unless the operator has explicit authorization for that exact action. Migration plans MUST include read-only preflight, expected row impact, drift history impact, and verification queries.

### V. Readiness Gates Must Tell The Truth
Production readiness, restore readiness, migration drift, auth, DB, billing, browser, lint, typecheck, unit, build, and audit gates MUST report the real state. Missing external evidence MUST remain `EXTERNAL_BLOCKED` or failing in strict mode; bypasses, fabricated evidence, disabled tests, and weakened checks are prohibited. A PR is mergeable only when its scoped gates pass or the remaining blockers are accurately documented as external and non-local.

### VI. Billing And Payment State Is Authoritative Server-Side
Invoices, balances, payment allocations, webhook processing, customer status, and ledger-impacting decisions MUST be computed and persisted server-side with idempotency and tenant validation. Payment webhooks MUST validate provider signatures, reject cross-tenant references, be idempotent, and preserve audit evidence. UI state MUST NOT be the source of truth for money.

### VII. Router And Network Automation Defaults To Safe Mode
MikroTik, RouterOS, WireGuard, SNMP, and network automation MUST default to read-only, simulated, queued, or dry-run behavior unless the environment and operator have explicitly authorized live writes. Direct unsafe router mutations from ordinary HTTP request paths are prohibited. Live worker execution MUST be gated by environment flags, credential encryption, lab or production approval, audit logs, and rollback notes.

### VIII. Secrets Are Never Evidence
Secrets, tokens, JWTs, service-role keys, router passwords, HMAC keys, private deployment identifiers, private IPs where sensitive, and raw provider payloads with credentials MUST NOT be committed, printed, pasted into reports, or stored in public docs. Evidence MAY include set/unset status, redacted fingerprints, command exit status, sanitized logs, and file metadata checks.

### IX. Feature Flags Route Behavior, Not Accountability
`USE_DB_*`, payment, MikroTik, WireGuard, public deployment, strict readiness, and development flags MAY select persistence providers or runtime modes. They MUST NOT disable tenant isolation, RBAC, auditability, payment integrity, migration requirements, or production-readiness truth. Flag defaults MUST keep local development hermetic and hardened deployments fail-closed.

### X. Tests Define The Safety Boundary
Every feature, bug fix, migration, or release-hardening change MUST include the narrowest meaningful tests first and then the broader gates required by impact. Unit tests are required for pure logic, contract or DB tests for persistence/RLS/payment/auth behavior, Playwright or browser smoke tests for user workflows, and readiness scripts for release gates. Skipped live tests are acceptable only when their skip reason is explicit and non-production evidence is not claimed.

### XI. Observability And Auditability Are Product Features
Security-sensitive actions, payment events, router operations, tenant resolution failures, readiness checks, restore evidence, and migrations MUST leave useful, sanitized logs or reports. Logs MUST redact sensitive paths and values. Operational reports MUST state command, environment, result, observation, and residual risk.

### XII. Brownfield Compatibility Is Required
NugaCore currently serves a React SPA and Express API from one Node process, supports hermetic local development, uses Supabase/PostgreSQL as the production-grade data platform, and gates many domains through feature flags. Changes MUST respect existing boundaries, avoid broad rewrites, and keep legacy-safe behavior unless a spec explicitly authorizes migration to a new boundary.

## Runtime And Architecture Boundaries

The application MUST continue to support a hermetic local mode with in-memory providers and no required external services. Supabase, payment providers, RouterOS, WireGuard, SNMP, and public deployment modes are opt-in through environment configuration and tests.

Hardened runtime is any runtime with `NODE_ENV=production` or `PUBLIC_DEPLOYMENT=true`. In hardened runtime, missing Supabase auth configuration, trusted headers, missing critical secrets, unsafe router flags, missing restore evidence, or incomplete production flags MUST block readiness according to the relevant strict gate.

Database domains MUST prefer explicit tenant-scoped repository/service APIs over direct client calls scattered through routes. Shared cross-domain changes MUST include contract tests that prove tenant isolation, authorization behavior, and error semantics.

Payment provider integrations MUST run in sandbox or test mode unless explicitly authorized otherwise. Webhook handlers MUST be safe to retry and MUST persist enough state to prevent duplicate financial effects.

Router/network integrations MUST separate read, plan, queue, and apply phases. A write path MUST identify tenant, device, intended operation, dry-run status, authorization source, and audit record before mutation.

## Development Workflow And Quality Gates

Every change MUST use a branch and PR into `main`. Direct pushes to `main`, force-pushes that rewrite reviewed work, unreviewed merges, and speculative cleanup outside the requested scope are prohibited.

Spec Kit bootstrap PRs MUST only add Spec Kit infrastructure, repository audit notes embedded in the Constitution, and governance documents. They MUST NOT implement product features, database migrations, runtime behavior changes, or production operations.

After this bootstrap is merged, new feature work MUST start with Spec Kit artifacts: specification, plan, tasks, risk notes, test plan, and any required migration or release plan. Emergency fixes MAY be narrower, but the PR description MUST explain the exception and add missing specification artifacts as follow-up work.

The default local validation set for repository-wide changes is:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `git diff --check`

Additional gates MUST be run when relevant:

1. Auth or tenant changes: `npm run test:auth`
2. Supabase persistence or RLS changes: `npm run test:db`
3. Billing or payment changes: `npm run test:db:billing`
4. Browser workflow changes: Playwright smoke or `npm run test:e2e`
5. Release readiness changes: `npm run validate-production-readiness`
6. Restore or backup evidence changes: `npm run validate-restore-checklist`
7. Dependency or security-sensitive changes: `npm audit --omit=dev` and targeted security tests

Pull requests MUST document commands executed, pass/fail status, environment used, and any skipped or external-blocked evidence. A failing required gate blocks merge unless the PR explicitly narrows scope and the owner accepts the documented risk.

## Governance

This Constitution applies to code, tests, scripts, migrations, docs, runbooks, agent outputs, and release decisions in NugaCore v2. When this Constitution conflicts with older docs or informal practice, this Constitution governs until amended.

Amendments MUST be made by PR, include the Sync Impact Report at the top of this file, update semantic version and dates, and identify affected templates, workflows, tests, or runbooks. Major version changes remove or redefine a core principle. Minor version changes add principles or materially expand governance. Patch version changes clarify wording without changing policy.

Every PR review MUST check constitutional compliance for its scope. Non-compliance blocks merge unless the PR includes an explicit, time-bounded exception approved by the repository owner and a follow-up issue or PR plan.

Release managers MUST confirm the exact PR, branch, SHA, mergeability, GitHub Actions status, local worktree status, and required gate results before merge. Production deployment remains a separate authorization step from code merge.

**Version**: 1.0.0 | **Ratified**: 2026-08-13 | **Last Amended**: 2026-08-13
