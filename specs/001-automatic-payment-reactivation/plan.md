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
| Auth, RBAC, RLS, and tenant isolation | PASS WITH PLANNED WORK | Existing tenant-scoped paths are reused. The future active-block persistence must add RLS/grants and tenant-scoped tests before runtime enablement. |
| Persistence and migrations | PASS WITH PLANNED WORK | No migration in this PR. Final persistence decision is `NO` for the complete feature until a minimal active-block model is added in a future implementation PR. |
| Billing, payments, and idempotency | PASS WITH PLANNED WORK | Billing authority and existing payment/order/action idempotency are reused. Future work must add decision audit and active-block integration tests. |
| MikroTik, RouterOS, workers, and external providers | PASS WITH PLANNED WORK | Router effects remain queued/dry-run by default and use worker semantics. Future work must add a pre-RouterOS eligibility revalidation boundary. |
| Feature flags and runtime configuration | PASS WITH PLANNED WORK | Existing `reactivateOnPayment`, `autoReactivate`, `PAYMENTS_ROUTER_LIVE`, `MIKROTIK_WORKER_LIVE`, and `MIKROTIK_WORKER_COMMIT` route behavior; future implementation must persist disabled/no-op decisions. |
| Secrets and sensitive data | PASS | Plan requires sanitized fingerprints and no raw provider/router payloads in evidence. |
| Observability, audit, and restore evidence | PASS WITH PLANNED WORK | Design requires explicit decision evidence for eligible, blocked, disabled, dry-run, queued, failed, and restored states. External restore/live evidence remains separate from this plan-only PR. |
| Backwards compatibility | PASS WITH PLANNED WORK | Manual payment and webhook flows continue to record money first. Legacy ambiguous suspended customers must fail closed as `unknown` until structured evidence exists. |
| Test strategy and CI gates | PASS WITH PLANNED WORK | Later implementation must add unit, contract, DB/billing, auth, concurrency, active-block, and release gates before merge. |
| Deployment and rollback | PASS WITH PLANNED WORK | No deployable runtime change here. Later release should use additive migration, staged flags, and rollback by disabling automatic reactivation/network gates before code rollback if needed. |

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

1. Add a pure eligibility result contract that classifies `eligible`, `blocked_financial`, `blocked_non_financial`, `automation_disabled`, `already_active`, `missing_identity`, and `router_deferred`.
2. Add minimal active-block persistence before runtime enablement so financial, non-financial, and unknown suspension blocks can coexist and be cleared independently.
3. Introduce one shared server-side eligibility path invoked after `BillingService.applyWebhookPayment` and after authorized manual/server payment recording.
4. Replace direct invoice-settlement-only reactivation with customer balance/status evaluation using tenant-scoped invoices and suspension policy.
5. Preserve durable payment success before downstream effects; downstream failures become audit/pending states, not payment rollback.
6. Reuse the existing reactivation saga for exactly-once action, order, timeline, suspension-event, and alert effects.
7. Add worker-side revalidation immediately before live RouterOS commands.

## D. Brownfield Architecture Reuse

| Area | Decision | Reason |
|------|----------|--------|
| React SPA + single Express backend | REUSE | Spec 001 is backend decision logic and should not introduce a new runtime boundary. |
| Billing payment recording/application | REUSE | Billing remains the money source of truth; reactivation runs only after durable payment application. |
| Payment webhook claim/canonical payment identity | REUSE | Existing webhook fences, `webhook_payment_id`, provider transaction identity, and canonical payment ID already close duplicate-delivery risk. |
| Root reactivation idempotency | REUSE | Existing `rootActionIdempotencyKey(canonicalPaymentId, customerId)` plus tenant scope defines one family per payment/customer. |
| Reactivation orders and Mikrotik actions | REUSE | Existing tenant-scoped unique partial indexes and create-or-get behavior enforce exactly-once order/action identity. |
| Checkpoint RPC and payment saga progress | REUSE | Existing monotonic checkpointing prevents duplicate or regressed reactivation effects. |
| Mikrotik worker claim/effect recovery | EXTEND | Current claim and uncertain-effect handling is strong; it needs a final eligibility revalidation before live RouterOS writes. |
| Suspension/billing grace semantics | EXTEND | Existing `CURRENT`, `DUE_SOON`, `OVERDUE`, and `DELINQUENT` aggregation should become the shared financial eligibility input. |
| Manual suspension/reactivation routes | ADAPT | Existing permissions remain, but manual/admin holds must write/clear structured active blocks in the future implementation. |
| Suspension reason/source history | ADAPT | Existing history is evidence, not authority. Legacy ambiguity must map to `unknown` and fail closed. |
| Active suspension-block persistence | NEW_REQUIRED | Current schema cannot safely represent multiple active financial/non-financial/unknown blockers. |

## F. Persistence Decision

**Final answer**: **NO**. The complete safe feature cannot be implemented with existing persistence alone.

Existing persistence is sufficient for:

- canonical payment identity and duplicate provider delivery convergence,
- tenant/customer/payment scope,
- one reactivation family per `tenantId + canonicalPaymentId + customerId`,
- durable action/order idempotency,
- monotonic payment reactivation checkpoints,
- RouterOS worker claim, retry, and uncertain-effect recovery,
- sanitized decision/audit events when extended through existing `suspension_events`.

Existing persistence is not sufficient for the security-critical question: "Does this suspended customer currently have only a financial block that this payment regularized?" The future implementation PR must add a minimal active-block model, tentatively `customer_suspension_blocks`, before automatic reactivation is enabled. That model must be additive, tenant-scoped, RLS/grant protected, and able to represent multiple concurrent active blocks.

## G. Idempotency Design

| Flow | Design |
|------|--------|
| Payment | Reuse Billing webhook idempotency by provider/transaction and canonical `webhook_payment_id`; payment recording remains durable even if reactivation fails later. |
| Eligibility decision | Use a deterministic decision idempotency key derived from `tenantId + canonicalPaymentId + customerId`; persist blocked/disabled/no-op decisions as tenant-scoped audit events without creating network effects. |
| Canonical reactivation | Reuse `payment:${canonicalPaymentId}:reactivate:${customerId}` as the root family key. This is `DURABLY_ENFORCED` by tenant-scoped unique indexes on reactivation/action destinations. |
| Worker | Reuse order claim, `worker_run_id`, `claimed_at`, `effect_started_at`, and `effect_confirmed_at` semantics. After uncertain RouterOS effects, retry must not resend commands unless reconciliation confirms the effect state. |
| Router action | Reuse `mikrotik_actions` create-or-return idempotency and monotonic checkpoints. Direct RouterOS writes from payment request paths remain forbidden. |

## H. Concurrency Strategy

| Scenario | Strategy |
|----------|----------|
| Duplicate webhook deliveries | Existing webhook claim and canonical payment identity converge to one payment and one reactivation family. |
| Concurrent approved events for the same canonical charge | Billing canonicalization and tenant-scoped idempotency must return or resume the existing result, not create a second family. |
| Manual payment vs webhook for same customer | Money writes remain Billing-authoritative. Eligibility is evaluated after each durable payment but reactivation family identity remains canonical payment/customer scoped. |
| Manual/admin hold appears after payment eligibility | Future worker revalidation must see the new non-financial/unknown active block and stop before RouterOS mutation. |
| Retry after successful logical reactivation | Existing action/order lookup and checkpoints resume/return the already completed family. |
| Retry after RouterOS uncertain effect | Existing `effect_started_at` without confirmation prevents blind resend; operator reconciliation is required. |
| Retry after confirmed RouterOS success but before post-effect status update | Existing `effect_confirmed_at` lets the worker resume post-effect updates without sending RouterOS commands again. |

## I. Suspension Classification

Automatic payment reactivation must classify suspension from structured active-block evidence, not from customer status or free-text reason alone.

Rules for the future implementation:

- `financial`: active block produced by deterministic billing/suspension-engine delinquency evidence and cleared only when post-payment status is no longer `DELINQUENT`.
- `non_financial`: active block from manual/admin/security/fraud/cancellation/maintenance/baja or any independent operational hold. Payment must not clear it.
- `unknown`: legacy or ambiguous suspended state where current durable evidence cannot prove the block is financial. Payment automation fails closed.
- `none`: no active blocks.

Eligibility requires customer status `suspended`, automation policy enabled, no blocking overdue debt after payment, and no active `non_financial` or `unknown` block. If financial and non-financial blocks coexist, payment may clear/record the financial result but automatic reactivation remains blocked.

## Post-Design Constitution Re-Check

| Check | Status | Evidence / Required Action |
|-------|--------|----------------------------|
| Existing architecture and brownfield boundaries | PASS | Artifacts identify existing files and do not propose a rewrite or new runtime boundary. |
| Production safety | PASS | Artifacts are plan-only and require explicit later authorization for staging/production/provider/router operations. |
| Auth, RBAC, RLS, and tenant isolation | PASS WITH PLANNED WORK | Contract requires tenant-scoped inputs and existing server-side suspension permission. Future active-block persistence must add RLS/grants/tests. |
| Persistence and migrations | PASS WITH PLANNED WORK | Final decision is `NO` for existing persistence alone; future implementation needs a minimal additive active-block migration. |
| Billing, payments, and idempotency | PASS WITH PLANNED WORK | Design preserves Billing authority, canonical payment identity, webhook fencing, and checkpoint semantics; future work adds idempotent decision audit. |
| MikroTik, RouterOS, workers, and external providers | PASS WITH PLANNED WORK | Design keeps RouterOS behind dry-run/live worker gates and requires worker pre-effect revalidation. |
| Feature flags and runtime configuration | PASS WITH PLANNED WORK | Design uses flags to route behavior while payment/accountability remain server-side; disabled outcomes must be persisted. |
| Secrets and sensitive data | PASS | Evidence fields are sanitized IDs/fingerprints, not raw secrets or payloads. |
| Observability, audit, and restore evidence | PASS WITH PLANNED WORK | Data model and contract require auditable decision/state outputs; implementation must add concrete persisted evidence. |
| Backwards compatibility | PASS WITH PLANNED WORK | Manual and webhook payment recording remain valid; ambiguous legacy suspensions must fail closed as `unknown`. |
| Test strategy and CI gates | PASS WITH PLANNED WORK | Quickstart lists targeted and broad gates; implementation must add DB/RLS/concurrency coverage for active blocks. |
| Deployment and rollback | PASS WITH PLANNED WORK | Feature can be disabled by policy/flags; future migration must be additive and live router execution remains separately gated. |

## M. Constitution Check Outcome

The plan has no `VIOLATION`. Several checks are intentionally `PASS WITH PLANNED WORK` because this PR is documentation-only and the architecture now requires future additive persistence, RLS/grant tests, decision audit, and worker revalidation before runtime enablement. No item should be treated as production-ready implementation approval from CI alone.

## Complexity Tracking

No constitutional violations or added architecture complexity require justification.
