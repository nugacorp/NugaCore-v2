# Implementation Plan: Automatic Payment Reactivation

**Branch**: `feature/automatic-payment-reactivation-plan` | **Date**: 2026-08-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-automatic-payment-reactivation/spec.md`

## Summary

Implement a customer-level, server-side automatic reactivation decision that runs only after Billing durably applies a confirmed payment. The implementation should replace invoice-settlement-only reactivation triggers with a shared eligibility evaluator that checks customer blocking overdue debt through the existing suspension/billing semantics, preserves non-financial holds, emits one tenant-scoped reactivation family per canonical payment and customer, and keeps RouterOS execution behind the existing dry-run/live worker gates.

The next implementation PR should reuse the current Express backend domains (`payments`, `billing`, `suspension`, `customers`, `mikrotik`) and their Store/Supabase repository split. It should not add a wallet, per-service billing, new RBAC roles, new provider framework, or direct RouterOS writes from ordinary request paths.

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js/Express backend, React 19/Vite frontend.

**Primary Dependencies**: Express, `@supabase/supabase-js`, Vitest, Playwright, Supabase/PostgreSQL 17 validation fixtures.

**Storage**: In-memory Store for hermetic local mode; Supabase/PostgreSQL for production-grade persistence behind `USE_DB_*` feature flags.

**Testing**: Vitest unit/contract/e2e suites, PostgreSQL 17 fixture runners, Supabase-backed `test:db`, `test:db:billing`, `test:auth`, build/readiness scripts.

**Target Platform**: Single Node process serving the React SPA and Express API; optional Supabase, payment-provider sandbox, and MikroTik/RouterOS integrations.

**Project Type**: Brownfield web application with backend domain modules, frontend operational UI, Supabase migrations, and release-readiness scripts.

**Performance Goals**: Webhook/payment retry handling remains idempotent and bounded to a small customer invoice set; eligibility evaluation should avoid cross-tenant scans and reuse tenant-scoped repository reads.

**Constraints**: Payment recording must remain durable even when reactivation or network dispatch fails; tenant context, canonical payment identity, webhook ownership, and provider approval must fail closed; RouterOS writes stay disabled unless explicit runtime gates authorize them.

**Scale/Scope**: Spec 001 is customer-level only and touches one customer/payment event family at a time. Per-service balances, wallet/credit accounting, provider expansion, and production rollout are outside this plan.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Check | Status | Evidence / Required Action |
|-------|--------|----------------------------|
| Existing architecture and brownfield boundaries | PASS | Plan keeps React SPA + Express API, domain repositories, Store/Supabase parity, and customer-level model. |
| Production safety | PASS | Plan-only PR; later implementation must remain non-production and keep provider/router writes gated. |
| Auth, RBAC, RLS, and tenant isolation | PASS | Design requires `tenantId` on payment, billing, customer, router, action, event, timeline, and alert paths, and reuses existing suspension/reactivation permissions. |
| Persistence and migrations | PASS | No migration in this PR. Later tasks should first verify whether existing `reactivation_orders`, `mikrotik_actions`, `payment_events`, `payments`, `suspension_events`, and `client_timeline` columns already cover the needed evidence. |
| Billing, payments, and idempotency | PASS | Plan centers Billing as source of truth and reuses webhook claim, canonical payment identity, idempotency keys, and checkpointed reactivation effects. |
| MikroTik, RouterOS, workers, and external providers | PASS | Router effects remain queued/dry-run by default and use `processNetworkOrder`/worker semantics rather than direct unsafe writes. |
| Feature flags and runtime configuration | PASS | Existing `reactivateOnPayment`, `autoReactivate`, `PAYMENTS_ROUTER_LIVE`, `MIKROTIK_WORKER_LIVE`, and `MIKROTIK_WORKER_COMMIT` route behavior without weakening accountability. |
| Secrets and sensitive data | PASS | Plan requires sanitized fingerprints and no raw provider/router payloads in evidence. |
| Observability, audit, and restore evidence | PASS | Design requires explicit decision evidence for eligible, blocked, disabled, dry-run, queued, failed, and restored states. External restore/live evidence remains separate from this plan-only PR. |
| Backwards compatibility | PASS | Manual payment and webhook flows continue to record money first; existing manual recovery remains authorized through current suspension routes. |
| Test strategy and CI gates | PASS | Later implementation must add unit, contract, DB/billing, auth, and existing release gates before merge. |
| Deployment and rollback | PASS | No deployable runtime change here. Later release should use staged flags and rollback by disabling automatic reactivation/network gates before code rollback if needed. |

**Constitution Violations**:

- None.

## Project Structure

### Documentation (this feature)

```text
specs/001-automatic-payment-reactivation/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   `-- automatic-payment-reactivation.md
|-- brownfield-audit.md
`-- checklists/
    `-- requirements.md
```

### Source Code (repository root)

```text
backend/
|-- domains/
|   |-- billing/
|   |-- payments/
|   |-- suspension/
|   |-- customers/
|   `-- mikrotik/
|-- config/
`-- common/

src/
|-- components/
|-- lib/
`-- types.ts

tests/
|-- unit/
|-- contract/
|-- db/
`-- e2e/

supabase/
|-- migrations/
`-- rollbacks/
```

**Structure Decision**: Use the existing brownfield backend domain layout. The future implementation should place pure eligibility logic near `backend/domains/suspension/engine.ts` or a small payments/suspension integration module, call it from `backend/domains/payments/service.ts` and `backend/domains/billing/routes.ts`, and add tests under the existing `tests/unit`, `tests/contract`, and `tests/db` suites. This plan-only PR does not modify source code.

## Phase 0 Research Summary

Detailed decisions are recorded in [research.md](research.md).

Key decisions:

- Eligibility is customer-level and must be evaluated after payment application, not before or from UI state.
- Blocking overdue debt maps to the suspension engine's grace-aware aggregate billing status; `DELINQUENT` is blocking, while `CURRENT` and `DUE_SOON` are regularized. `OVERDUE` inside grace is not beyond grace, but it must remain observable as a warning state.
- Existing invoice-level `settlementWinner` is insufficient by itself and should become only a trigger candidate for eligibility evaluation.
- Non-financial holds should fail closed unless current suspension evidence proves the suspension is financial/delinquency-related.
- Reactivation family identity should remain `tenantId + canonicalPaymentId + customerId`, using the existing root idempotency key and durable checkpoints.
- Network restoration must not be claimed until worker/RouterOS evidence exists.

## Phase 1 Design Summary

Detailed entity design is recorded in [data-model.md](data-model.md), the integration contract in [contracts/automatic-payment-reactivation.md](contracts/automatic-payment-reactivation.md), and validation guidance in [quickstart.md](quickstart.md).

Implementation shape for the next PR:

1. Add a pure eligibility result contract that classifies `eligible`, `blocked_financial`, `blocked_non_financial`, `automation_disabled`, `already_active`, `missing_identity`, and `deferred_network`.
2. Introduce one shared server-side eligibility path invoked after `BillingService.applyWebhookPayment` and after authorized manual/server payment recording.
3. Replace direct invoice-settlement-only reactivation with customer balance/status evaluation using tenant-scoped invoices and suspension policy.
4. Preserve durable payment success before downstream effects; downstream failures become audit/pending states, not payment rollback.
5. Reuse the existing reactivation saga for exactly-once action, order, timeline, suspension-event, and alert effects.

## Post-Design Constitution Re-Check

| Check | Status | Evidence / Required Action |
|-------|--------|----------------------------|
| Existing architecture and brownfield boundaries | PASS | Artifacts identify existing files and do not propose a rewrite or new runtime boundary. |
| Production safety | PASS | Artifacts are plan-only and require explicit later authorization for staging/production/provider/router operations. |
| Auth, RBAC, RLS, and tenant isolation | PASS | Contract requires tenant-scoped inputs and existing server-side suspension permission for operator recovery. |
| Persistence and migrations | PASS | No migration is authored; data model first reuses existing entities and flags migration review as a future task only if evidence fields are insufficient. |
| Billing, payments, and idempotency | PASS | Design preserves Billing authority, canonical payment identity, webhook fencing, and checkpoint semantics. |
| MikroTik, RouterOS, workers, and external providers | PASS | Design keeps RouterOS behind dry-run/live worker gates and distinguishes queued/restored evidence. |
| Feature flags and runtime configuration | PASS | Design uses flags to route behavior while payment/accountability remain server-side. |
| Secrets and sensitive data | PASS | Evidence fields are sanitized IDs/fingerprints, not raw secrets or payloads. |
| Observability, audit, and restore evidence | PASS | Data model and contract require auditable decision/state outputs. |
| Backwards compatibility | PASS | Manual and webhook payment recording remain valid when automation is disabled or downstream systems fail. |
| Test strategy and CI gates | PASS | Quickstart lists targeted and broad gates for the implementation PR. |
| Deployment and rollback | PASS | Feature can be disabled by policy/flags; live router execution remains separately gated. |

## Complexity Tracking

No constitutional violations or added architecture complexity require justification.
