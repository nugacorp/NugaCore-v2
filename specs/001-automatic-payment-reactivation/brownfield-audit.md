# Brownfield Audit: Automatic Payment Reactivation

**Feature**: Automatic Payment Reactivation

**Branch**: `feature/automatic-payment-reactivation`

**Date**: 2026-08-13

**Purpose**: Record repository evidence used to author the spec. This is non-destructive and does not implement behavior.

## Evidence Map

| Area | Files / Evidence | Finding |
|------|------------------|---------|
| Payment webhook processing | `backend/domains/payments/service.ts`, `backend/domains/payments/repository.ts`, `backend/domains/payments/types.ts`, `backend/domains/payments/idempotency.ts` | Approved provider events are processed server-side with tenant-scoped claims, canonical payment identity, fencing, and durable reactivation checkpoints. |
| Billing settlement | `backend/domains/billing/service.ts`, `backend/domains/billing/routes.ts`, `backend/domains/billing/repository.ts` | Billing owns payment recording, pending amount, paid status, webhook payment application, and overpayment rejection. |
| Suspension policy / state | `backend/domains/suspension/engine.ts`, `backend/domains/suspension/types.ts`, `backend/domains/suspension/repository.ts` | Suspension engine can create pending reactivation orders based on billing status, partial-payment policy, and open-order idempotency. |
| Router/network boundary | `backend/domains/payments/service.ts`, `backend/config/production-gates.ts`, `backend/domains/mikrotik/*`, `backend/domains/safe-command-queue/*` | Network effects default to dry-run/read-only/queued behavior. Live writes are gated and require external evidence and authorization. |
| Tenant isolation | `backend/domains/payments/repository.ts`, `backend/domains/payments/types.ts`, `backend/domains/tenancy/*`, tests under `tests/unit` and `tests/contract` | Payment events, orders, actions, customers, invoices, and routers are intended to be tenant-scoped and fail closed when tenant context is missing. |
| Tests | `tests/unit/payments.webhook-idempotency-claim.test.ts`, `tests/unit/payments.reactivation-durable-saga.test.ts`, `tests/unit/suspension.engine.test.ts`, `tests/contract/suspension.scenarios.contract.test.ts`, `tests/contract/mikrotik.worker.contract.test.ts` | Existing tests cover webhook claim/idempotency, durable saga recovery, suspension reactivation decisions, reactivation orders, and dry-run worker behavior. |
| Architecture notes | `docs/architecture/SYSTEM_ARCHITECTURE.md`, `docs/architecture/ARCHITECTURE_OVERVIEW.md`, `docs/architecture/TECHNICAL_DEBT.md` | Existing docs identify payment-triggered reactivation as intended behavior and call out historical route-level coupling as technical debt. |

## Capability Classification

| Capability | Classification | Notes |
|------------|----------------|-------|
| Confirmed payment trigger | EXISTS | Approved payment events and manual server-side payment recording exist. |
| Duplicate webhook protection | EXISTS | Atomic claim/reclaim behavior and tenant-scoped event identity exist. |
| Canonical payment identity | EXISTS | Billing/webhook payment idempotency can own downstream reactivation identity. |
| Invoice settlement | EXISTS | Pending amount and settlement-winner behavior exist for invoice-level settlement. |
| Customer balance scope | PARTIAL | Current brownfield behavior has account balance and overdue/delinquent concepts. Spec 001 decision: automatic reactivation requires no blocking overdue customer balance beyond grace after payment application. Exact calculation belongs to plan. |
| Partial payment behavior | PARTIAL | Current brownfield behavior can record partial payments and has a partial reactivation policy flag. Spec 001 decision: partial payment is valid but does not auto-reactivate while blocking overdue debt remains. |
| Logical customer reactivation | EXISTS | Payment service can reactivate customer state and record side effects. |
| Reactivation order | EXISTS | Suspension engine and repository have reactivation order concepts. |
| Manual suspension/reactivation permission | EXISTS | Current brownfield routes and tests show server-side suspension evaluate roles for manual suspend/reactivate behavior. Spec 001 reuses this permission family and does not introduce new roles. |
| Worker / router apply | PARTIAL | Worker and command planning exist, but current default remains dry-run/read-only and live evidence is external. |
| Service/subscription granularity | OUT_OF_SCOPE | Current data model is mostly customer/client/plan oriented. Spec 001 decision: preserve customer-level reactivation; service/subscription-level behavior requires a future spec. |
| Audit trail | PARTIAL | Multiple audit records exist, but operator-facing end-to-end proof should be validated in the later plan. |

## Current Brownfield Behavior vs Spec 001 Decisions

| Topic | Current Brownfield Behavior | Spec 001 Decision |
|-------|-----------------------------|-------------------|
| Debt scope | Payment service currently uses invoice settlement in the webhook flow; billing service also exposes customer/account balance projections and suspension engine aggregates overdue/delinquent state. | Reactivation eligibility requires no blocking overdue customer balance beyond the applicable grace period after payment is applied. |
| Partial payment | Billing can record partial payment; suspension policy includes partial-payment reactivation capability. | Partial payment remains a valid payment, but it does not trigger automatic reactivation while blocking overdue debt remains. |
| Subject granularity | Runtime evidence is customer/client/plan oriented rather than per-service billing/reactivation. | Spec 001 remains customer-level; per-service/per-subscription behavior is out of scope. |
| Non-financial suspension | Current code has customer status and suspension events/reasons but no complete accepted taxonomy. | Payment may clear financial blocking conditions but must not override independent non-financial blocks; taxonomy details are deferred to plan or a future spec. |
| Overpayment/credit | Billing currently rejects payment amounts above pending invoice balance in the inspected route; no formal wallet/credit domain is established in this spec. | Overpayment must not duplicate reactivation. Credit/refund/wallet handling is existing behavior or future scope, not Spec 001. |
| Manual recovery permissions | Server routes use existing suspension roles for manual suspend/reactivate and tests verify denied roles. | Reuse existing server-side suspension/reactivation permission where applicable; do not create new roles. |

## Main Risks For Planning

- Translating the resolved customer-level blocking overdue debt rule into existing billing/suspension data without scope creep.
- Reconciling current invoice-level webhook settlement with the Spec 001 customer-level eligibility rule.
- Mapping existing suspension evidence to financial vs independent non-financial blocking categories.
- Live RouterOS restoration requires CHR/lab evidence and explicit operator authorization; this spec does not authorize it.
- Existing route-level reactivation coupling should be handled carefully if implementation later extracts or consolidates behavior.

## Commands Used For Audit

| Command | Result | Observation |
|---------|--------|-------------|
| `git status --short --branch` | PASS | Branch was clean at audit start. |
| `uvx --system-certs --from specify-cli specify.exe --version` | PASS | Spec Kit CLI available as `specify 0.16.3`. |
| `uvx --system-certs --from specify-cli specify.exe integration status` | PASS with warning | Codex integration available; expected modified managed files from prior template alignment. |
| `uvx --system-certs --from specify-cli specify.exe preset resolve spec-template` | PASS | Active spec template resolved to `.specify/templates/spec-template.md`. |
| `rg` searches for payment/reactivation/suspension/idempotency/router terms | PASS | Located current brownfield behavior and tests. |
| `Select-String` targeted reads | PASS | Confirmed evidence snippets without changing files. |

## Explicit Non-Actions

- No code was implemented.
- No migration was created or applied.
- No production, staging database, provider, or router mutation was performed.
- No `speckit-plan`, `speckit-tasks`, `speckit-checklist`, `speckit-analyze`, `speckit-implement`, or `speckit-converge` workflow was executed.
