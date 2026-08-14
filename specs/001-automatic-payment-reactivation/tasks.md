# Tasks: Automatic Payment Reactivation

**Input**: Design documents from `/specs/001-automatic-payment-reactivation/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/automatic-payment-reactivation.md`, `quickstart.md`, `.specify/memory/constitution.md`

**Tests**: Test tasks are included because Spec 001 is payment, tenant, database, RouterOS, and security-sensitive. Write or update the listed tests before the corresponding implementation task, then make them pass in the implementation PR.

**Organization**: Tasks are grouped by dependency phase and user story. Foundational persistence, RLS, classification, and eligibility tasks block all user stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks in the same phase because it touches different files or only documents validation.
- **[Story]**: Maps to user stories in `spec.md`.
- **[EXTERNAL]**: Requires external evidence or an approved external system and starts as `EXTERNAL_BLOCKED`.

## Phase 1: Setup and Brownfield Mapping

**Purpose**: Confirm existing brownfield seams and create no runtime behavior.

- [ ] T001 Verify the implementation branch is based on `origin/main` and confirm Spec 001 artifacts exist in `specs/001-automatic-payment-reactivation/` before editing.
- [ ] T002 [P] Map existing payment webhook entry points in `backend/domains/payments/service.ts` and billing manual payment entry points in `backend/domains/billing/routes.ts` to the post-payment eligibility contract.
- [ ] T003 [P] Map existing suspension state, order, event, and policy repository seams in `backend/domains/suspension/engine.ts`, `backend/domains/suspension/repository.ts`, and `backend/domains/suspension/types.ts`.
- [ ] T004 [P] Map existing RouterOS worker claim, dry-run, live gate, and effect recovery seams in `backend/domains/mikrotik/worker/worker.ts` and `backend/bridges/network-order-dispatch.ts`.
- [ ] T005 [P] Map existing durable idempotency sources in `backend/domains/payments/idempotency.ts`, `backend/domains/payments/repository.ts`, `backend/domains/suspension/repository.ts`, and `supabase/migrations/20260730150000_webhook_durable_idempotency.sql`.

**Checkpoint**: Current seams are known; no feature code, migration, or tests have been changed yet.

---

## Phase 2: Foundational Persistence, RLS, and Contract Tests

**Purpose**: Create the future safety boundary required before any automatic reactivation logic can be enabled.

**Critical**: These tasks block all user stories.

- [ ] T006 Create DB contract tests for `public.customer_suspension_blocks` migration replay, additive shape, and rollback assumptions in `tests/db/customer-suspension-blocks-postgres17.sql`.
- [ ] T007 Create unit/static migration tests for the future `customer_suspension_blocks` migration in `tests/unit/customer-suspension-blocks-migration.test.ts` covering columns, check constraints, active indexes, uniqueness, non-destructive rollout, and no `supabase db push`.
- [ ] T008 Create a versioned additive Supabase migration for `public.customer_suspension_blocks` in `supabase/migrations/` with `tenant_id`, `customer_id`, `category`, `source`, sanitized `reason`, optional evidence references, active lifecycle timestamps, and audit timestamps.
- [ ] T009 Add active lookup indexes and optional duplicate-evidence protection for `customer_suspension_blocks` in the same `supabase/migrations/` migration using partial indexes for `cleared_at IS NULL`.
- [ ] T010 Add deny-by-default RLS, tenant-scoped policies, least-privilege grants, and service-role behavior for `customer_suspension_blocks` in the same `supabase/migrations/` migration.
- [ ] T011 Add DB tests for valid insert, active block lookup, lifecycle clearing, duplicate evidence handling, and backwards compatibility in `tests/db/customer-suspension-blocks-postgres17.sql`.
- [ ] T012 Add DB tests for tenant isolation, cross-tenant denial, RLS behavior, and service-role explicit tenant filters in `tests/db/customer-suspension-blocks-postgres17.sql`.
- [ ] T013 Add migration validation tasks to `scripts/` or existing migration validation docs so future implementation uses migration replay, drift reporting, and staging preflight without `supabase db push`.
- [ ] T014 [P] Add TypeScript domain types for suspension block categories and lifecycle records in `backend/domains/suspension/types.ts`.
- [ ] T015 Add Store and Supabase repository contracts for suspension block create/list/clear operations in `backend/domains/suspension/repository.ts`.
- [ ] T016 Add repository tests for Store and Supabase-shaped suspension block behavior in `tests/unit/suspension-blocks.repository.test.ts`.
- [ ] T017 Add contract fixtures for financial, non-financial, unknown, none, and multiple active blockers in `tests/contract/suspension.scenarios.contract.test.ts`.

**Checkpoint**: The active-block persistence boundary is specified, tested, tenant-scoped, and ready to support classification.

---

## Phase 3: User Story 1 - Reactivate Only After Blocking Debt Clears (Priority: P1) MVP

**Goal**: A confirmed payment only makes a customer eligible when all blocking overdue customer debt beyond grace is cleared.

**Independent Test**: Apply confirmed payments to suspended customers with full, partial, multiple-invoice, grace-period, and overpayment scenarios; verify eligibility/no eligibility without RouterOS live writes.

### Tests for User Story 1

- [ ] T018 [P] [US1] Add blocking overdue evaluator tests for current, due soon, overdue within grace, delinquent, and multiple invoices in `tests/unit/automatic-payment-reactivation.eligibility.test.ts`.
- [ ] T019 [US1] Add partial payment tests where payment remains valid but blocking debt remains in `tests/unit/automatic-payment-reactivation.eligibility.test.ts`.
- [ ] T020 [US1] Add full-settlement and overpayment eligibility tests at customer scope in `tests/unit/automatic-payment-reactivation.eligibility.test.ts`.
- [ ] T021 [P] [US1] Add billing DB integration tests proving customer-level invoice aggregation after payment application in `tests/contract/billing.db.contract.test.ts`.

### Implementation for User Story 1

- [ ] T022 [US1] Extract or reuse the grace-aware blocking overdue evaluator from `backend/domains/suspension/engine.ts` without duplicating Billing formulas.
- [ ] T023 [US1] Add a pure financial eligibility snapshot builder in `backend/domains/suspension/engine.ts` or a small shared module under `backend/domains/suspension/`.
- [ ] T024 [US1] Add automatic payment eligibility result types in `backend/domains/payments/types.ts` matching `contracts/automatic-payment-reactivation.md`.
- [ ] T025 [US1] Implement the automatic eligibility evaluator in `backend/domains/payments/service.ts` or a small payments/suspension integration module, combining durable payment, customer status, financial snapshot, active block snapshot, and feature flags.
- [ ] T026 [US1] Replace invoice `settlementWinner`-only reactivation gating in `backend/domains/payments/service.ts` with post-application customer-level eligibility evaluation.
- [ ] T027 [US1] Update authorized manual/server payment post-commit reactivation path in `backend/domains/billing/routes.ts` to call the same eligibility evaluator after `BillingService.recordPayment`.
- [ ] T028 [US1] Ensure automation disabled leaves payment application durable and records a non-reactivation outcome in `backend/domains/payments/service.ts`.
- [ ] T029 [US1] Run targeted validation commands `npm run test:unit -- tests/unit/automatic-payment-reactivation.eligibility.test.ts` and `npm run test:db:billing`.

**Checkpoint**: User Story 1 is independently testable without live network effects.

---

## Phase 4: User Story 2 - Preserve Money And Tenant Safety Under Retries (Priority: P1)

**Goal**: Duplicate, retry, and concurrent deliveries converge to one financial outcome and one logical reactivation family.

**Independent Test**: Process duplicate approved events and concurrent automatic evaluations for one tenant/customer/payment and verify a single canonical family.

### Tests for User Story 2

- [ ] T030 [P] [US2] Add duplicate webhook tests for one financial result and one logical reactivation family in `tests/unit/payments.webhook-idempotency-claim.test.ts`.
- [ ] T031 [P] [US2] Add concurrent automatic evaluation tests for same `tenantId + canonicalPaymentId + customerId` in `tests/unit/automatic-payment-reactivation.concurrency.test.ts`.
- [ ] T032 [P] [US2] Add tenant isolation tests where provider identifiers collide across tenants in `tests/contract/payments.openpay-webhook-tenant.contract.test.ts`.
- [ ] T033 [P] [US2] Add retry-after-success and already-completed/no-op tests in `tests/unit/payments.reactivation-durable-saga.test.ts`.

### Implementation for User Story 2

- [ ] T034 [US2] Preserve `rootActionIdempotencyKey(canonicalPaymentId, customerId)` as the automatic reactivation family key in `backend/domains/payments/idempotency.ts`.
- [ ] T035 [US2] Ensure eligible automatic reactivation uses existing `findActionByIdempotencyKey`, `findReactivationOrderByIdempotencyKey`, `createOrGetNetworkOrder`, and `createActionIdempotent` paths in `backend/domains/payments/service.ts`.
- [ ] T036 [US2] Persist blocked, disabled, already-active, and no-op eligibility decisions idempotently through existing `suspension_events` or approved audit destinations in `backend/domains/suspension/repository.ts`.
- [ ] T037 [US2] Ensure cross-tenant payment, customer, reactivation order, action, router, event, timeline, and alert access fails closed in `backend/domains/payments/service.ts`.
- [ ] T038 [US2] Add conflict handling so the same tenant/key with different payload fails closed instead of creating a second reactivation family in `backend/domains/payments/repository.ts`.
- [ ] T039 [US2] Run targeted validation commands `npm run test:unit -- tests/unit/payments.webhook-idempotency-claim.test.ts`, `npm run test:unit -- tests/unit/automatic-payment-reactivation.concurrency.test.ts`, and `npm run test:db`.

**Checkpoint**: User Story 2 is independently testable for idempotency, concurrency, and tenant safety.

---

## Phase 5: User Story 3 - Keep Operators Honest About Financial And Network State (Priority: P2)

**Goal**: Operators can distinguish payment confirmed, debt cleared, reactivation requested, dry-run/queued, failed, uncertain, and restored states.

**Independent Test**: Confirm payment with RouterOS disabled, unavailable, failed, or already completed and verify financial state remains durable while network evidence is accurate.

### Tests for User Story 3

- [ ] T040 [P] [US3] Add decision audit tests for eligible, blocked, disabled, already-active, dry-run, queued, failed, and no-op outcomes in `tests/unit/automatic-payment-reactivation.audit.test.ts`.
- [ ] T041 [P] [US3] Add RouterOS unavailable and pending/failed network outcome tests in `tests/contract/payments.worker-tenant-dispatch.contract.test.ts`.
- [ ] T042 [US3] Add already-active before worker safe no-op tests in `tests/contract/payments.worker-tenant-dispatch.contract.test.ts`.
- [ ] T043 [US3] Add duplicate worker delivery and retry-after-confirmed-success tests in `tests/contract/payments.worker-tenant-dispatch.contract.test.ts`.

### Implementation for User Story 3

- [ ] T044 [US3] Extend audit metadata for automatic eligibility decisions in `backend/domains/suspension/repository.ts` without storing provider secrets, webhook secrets, Router credentials, or raw sensitive payloads.
- [ ] T045 [US3] Ensure timeline and alert effects distinguish logical reactivation requested from network restored in `backend/domains/payments/service.ts`.
- [ ] T046 [US3] Extend `backend/domains/mikrotik/worker/worker.ts` to record cancellation, blocked, failed, uncertain, and no-op worker outcomes through existing order/action evidence.
- [ ] T047 [US3] Preserve durable payment success when audit, timeline, alert, reactivation order, or network dispatch fails in `backend/domains/payments/service.ts`.
- [ ] T048 [US3] Ensure retry after confirmed RouterOS success resumes only post-effect bookkeeping and never resends commands in `backend/domains/mikrotik/worker/worker.ts`.
- [ ] T049 [US3] Run targeted validation commands `npm run test:unit -- tests/unit/automatic-payment-reactivation.audit.test.ts` and `npm run test:integration -- tests/contract/payments.worker-tenant-dispatch.contract.test.ts`.

**Checkpoint**: User Story 3 is independently testable for operator-visible financial and network truth.

---

## Phase 6: User Story 4 - Respect Non-Financial Holds And Manual Recovery (Priority: P2)

**Goal**: Payment-driven automation never overrides non-financial or unknown blockers, while authorized manual recovery remains possible and auditable.

**Independent Test**: Clear financial debt with active non-financial, unknown, legacy ambiguous, and multiple blockers; verify no automatic reactivation or RouterOS write.

### Tests for User Story 4

- [ ] T050 [P] [US4] Add classification evaluator tests for `financial`, `non_financial`, `unknown`, and `none` in `tests/unit/automatic-payment-reactivation.classification.test.ts`.
- [ ] T051 [US4] Add unknown fail-closed tests proving `customer.status = suspended` alone never implies `financial` in `tests/unit/automatic-payment-reactivation.classification.test.ts`.
- [ ] T052 [P] [US4] Add multiple blocker tests where financial debt resolves but non-financial block remains in `tests/unit/automatic-payment-reactivation.eligibility.test.ts`.
- [ ] T053 [P] [US4] Add legacy ambiguous suspension tests mapping to `unknown` and manual/operator recovery in `tests/contract/suspension.scenarios.contract.test.ts`.
- [ ] T054 [P] [US4] Add stale eligibility worker test `T1 eligible, T2 operator adds non-financial hold, T3 worker executes` expecting no RouterOS write in `tests/contract/payments.worker-tenant-dispatch.contract.test.ts`.
- [ ] T055 [P] [US4] Add manual versus automatic concurrency tests proving coherent final state, no duplicate RouterOS write, and origin-specific audit in `tests/unit/automatic-payment-reactivation.concurrency.test.ts`.
- [ ] T056 [P] [US4] Add auth/RBAC tests for retry, override, cancel, and manual reactivation using existing roles in `tests/contract/auth.db.contract.test.ts`.

### Implementation for User Story 4

- [ ] T057 [US4] Implement the active suspension classification evaluator in `backend/domains/suspension/engine.ts` or a small `backend/domains/suspension/` module using `customer_suspension_blocks` as authority.
- [ ] T058 [US4] Ensure unknown classification fails closed in `backend/domains/payments/service.ts` and maps to `blocked_non_financial` with `blockReasonCategory = 'unknown'`.
- [ ] T059 [US4] Ensure active non-financial blockers prevent automatic reactivation even when financial debt is resolved in `backend/domains/payments/service.ts`.
- [ ] T060 [US4] Ensure financial block clearing only clears intended financial active blocks and never clears unrelated non-financial or unknown blocks in `backend/domains/suspension/repository.ts`.
- [ ] T061 [US4] Extend manual suspension and manual reactivation routes in `backend/domains/suspension/routes.ts` to create and clear structured active blocks using existing server-side permissions.
- [ ] T062 [US4] Extend worker pre-RouterOS revalidation in `backend/domains/mikrotik/worker/worker.ts` to verify financial state still eligible, no `non_financial` blocker, no `unknown` blocker, customer still eligible, automation enabled, and live gates still allow write.
- [ ] T063 [US4] Ensure failed pre-Router revalidation records a safe no-op, cancelled, or blocked outcome and does not call `executePlannedCommands` in `backend/domains/mikrotik/worker/worker.ts`.
- [ ] T064 [US4] Run targeted validation commands `npm run test:unit -- tests/unit/automatic-payment-reactivation.classification.test.ts`, `npm run test:unit -- tests/unit/automatic-payment-reactivation.concurrency.test.ts`, `npm run test:auth`, and `npm run test:db`.

**Checkpoint**: User Story 4 is independently testable for fail-closed blocker safety and manual recovery.

---

## Phase 7: Cross-Cutting Validation, Rollout, Rollback, and Documentation

**Purpose**: Prove constitutional planned work, external evidence boundaries, and release readiness without pretending external blockers are local PASS.

- [ ] T065 [P] Document automatic reactivation runtime flags, disabled defaults, and payment-preserving behavior in `docs/operations/automatic-payment-reactivation.md`.
- [ ] T066 Document operator retry, cancel, manual recovery, uncertain RouterOS effect reconciliation, and no-secret evidence in `docs/operations/automatic-payment-reactivation.md`.
- [ ] T067 Document rollback strategy in `docs/operations/automatic-payment-reactivation.md`: disable feature first, preserve valid payments, recover network state, and avoid destructive financial rollback.
- [ ] T068 Add release validation checklist for local gates, DB gates, billing gates, auth gates, readiness, and restore in `docs/operations/automatic-payment-reactivation.md`.
- [ ] T069 [EXTERNAL] Capture provider sandbox evidence request for signed approved webhook, duplicate retry, failed/pending/malformed events, and real payment confirmation in `docs/operations/automatic-payment-reactivation.md` with initial status `EXTERNAL_BLOCKED`.
- [ ] T070 [EXTERNAL] Capture CHR/RouterOS lab evidence request for dry-run, controlled write, duplicate/retry behavior, cleanup verification, and no production routers in `docs/operations/automatic-payment-reactivation.md` with initial status `EXTERNAL_BLOCKED`.
- [ ] T071 [EXTERNAL] Capture staging Supabase parity and migration drift evidence for payment, billing, suspension, tenant, and idempotency persistence in `docs/operations/automatic-payment-reactivation.md` with initial status `EXTERNAL_BLOCKED`.
- [ ] T072 [EXTERNAL] Capture production strict readiness evidence request separately from local/staging PASS claims in `docs/operations/automatic-payment-reactivation.md` with initial status `EXTERNAL_BLOCKED`.
- [ ] T073 [EXTERNAL] Capture restore/readiness evidence request for future durable payment/reactivation artifacts in `docs/operations/automatic-payment-reactivation.md` with initial status `EXTERNAL_BLOCKED`.
- [ ] T074 Run broad local gates after implementation scope is complete: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:auth`, `npm run test:db`, `npm run test:db:billing`, `npm audit --omit=dev`, `npm run validate-production-readiness`, and `npm run validate-restore-checklist`.
- [ ] T075 Perform security validation for RLS, cross-tenant denial, server-side RBAC, secret redaction, Router gates, idempotency, and fail-closed unknown behavior across `tests/unit/`, `tests/contract/`, and `tests/db/`.
- [ ] T076 Verify scope exclusions before implementation PR merge: no per-service billing, no new RBAC roles, no credit ledger, no new queue framework, no large suspension taxonomy, and no new payment provider in `specs/001-automatic-payment-reactivation/tasks.md` review notes.

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; creates the implementation map only.
- **Phase 2 Foundational**: Depends on Phase 1; blocks all user stories because persistence, RLS, active-block repository, and DB tests are safety boundaries.
- **Phase 3 US1**: Depends on Phase 2; MVP for financial eligibility after durable payment application.
- **Phase 4 US2**: Depends on Phase 2; can run after or alongside US1 once canonical eligibility interfaces exist, but final integration depends on US1 evaluator output.
- **Phase 5 US3**: Depends on Phase 2 and uses US1/US2 decision and saga outputs for operator-visible network state.
- **Phase 6 US4**: Depends on Phase 2 and should be completed before live RouterOS validation because blocker classification is a safety boundary.
- **Phase 7 Cross-Cutting**: Documentation can begin after Phase 2, but final validation and external evidence tasks depend on the desired implementation stories.

### Required Critical Path

```text
foundation
-> persistence
-> RLS/grants
-> suspension block model
-> classification
-> financial eligibility
-> automatic eligibility
-> reactivation integration
-> worker pre-Router revalidation
-> validation
```

### Parallel Opportunities

- T002-T005 can run in parallel because they only map existing seams.
- T006-T007 can run before T008 because they define migration tests.
- T014 and T017 can run in parallel after the migration contract is understood.
- Tests within each user story marked `[P]` can be created in parallel.
- T065-T068 documentation tasks should be sequenced because they update the same operations document.
- External evidence tasks T069-T073 can be prepared in parallel but remain `EXTERNAL_BLOCKED` until separately authorized.

---

## Implementation Strategy

### MVP First

1. Complete Phase 1.
2. Complete Phase 2, including migration task, RLS/grants task, repository contracts, and DB tests.
3. Complete Phase 3 User Story 1.
4. Stop and validate financial eligibility independently with no live RouterOS writes.

### Incremental Delivery

1. Add User Story 2 to harden idempotency, duplicate webhook, tenant, and concurrency behavior.
2. Add User Story 3 to expose accurate operator state and worker retry/failure evidence.
3. Add User Story 4 before any live RouterOS validation so non-financial and unknown blockers fail closed.
4. Complete Phase 7 docs, local gates, and external evidence requests.

### Guardrails

- Do not introduce per-service billing, new RBAC roles, a credit ledger, a new queue framework, a large suspension taxonomy, or a new payment provider.
- Do not use `supabase db push` for migration application.
- Do not claim production readiness, provider sandbox PASS, or CHR/RouterOS PASS without authorized external evidence.
- Do not allow stale eligibility to trigger unconditional RouterOS writes.
