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
| Customer balance scope | PARTIAL | Account balance projection exists, but eligibility across multiple open invoices needs product decision. |
| Partial payment behavior | PARTIAL | Suspension policy has partial-payment flag; product threshold/contract is not fully decided. |
| Logical customer reactivation | EXISTS | Payment service can reactivate customer state and record side effects. |
| Reactivation order | EXISTS | Suspension engine and repository have reactivation order concepts. |
| Worker / router apply | PARTIAL | Worker and command planning exist, but current default remains dry-run/read-only and live evidence is external. |
| Service/subscription granularity | NEEDS_HUMAN_DECISION | Current data model is mostly customer/client/plan oriented. |
| Audit trail | PARTIAL | Multiple audit records exist, but operator-facing end-to-end proof should be validated in the later plan. |

## Main Risks For Planning

- Eligibility debt scope is not fully decided.
- Partial-payment reactivation is policy-capable but product-ambiguous.
- Multiple-service customers may require subject-level identity beyond current customer-level behavior.
- Non-financial suspension reasons need a canonical taxonomy before auto-reactivation can be safely generalized.
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
