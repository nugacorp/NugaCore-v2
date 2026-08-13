# Research: Automatic Payment Reactivation

## Decision: Use a shared post-payment eligibility evaluator

**Rationale**: The current webhook flow in `backend/domains/payments/service.ts` triggers reactivation when `settlementWinner` is true for the paid invoice, and `backend/domains/billing/routes.ts` has a separate manual-payment post-commit reactivation block. Spec 001 requires customer-level eligibility after Billing applies the payment, so both paths should call one shared evaluator after durable payment application.

**Alternatives considered**:

- Keep invoice settlement as the trigger: rejected because one settled invoice may leave another blocking overdue debt.
- Evaluate before recording payment: rejected because Billing must remain the source of truth after payment application.
- Move all logic into the route: rejected because webhooks and manual server-side payments would diverge.

## Decision: Map blocking overdue debt to grace-aware delinquency

**Rationale**: `backend/domains/suspension/engine.ts` already classifies invoices as `CURRENT`, `DUE_SOON`, `OVERDUE`, or `DELINQUENT` using policy grace days. Spec 001 says blocking overdue debt means overdue balance beyond the applicable grace period. The future evaluator should reuse or extract the pure aggregation semantics so a `DELINQUENT` customer is blocked, `CURRENT`/`DUE_SOON` is regularized, and `OVERDUE` inside grace remains observable but not a beyond-grace block.

**Alternatives considered**:

- Use `BillingService.getCustomerBalance().overdueBalance` directly: rejected because it is status-based and does not encode grace-period blocking by itself.
- Add a new billing taxonomy: rejected as scope creep for Spec 001.
- Treat any overdue invoice as blocking: rejected because the accepted product rule includes the applicable grace period.

## Decision: Partial payments remain valid but do not override blocking debt

**Rationale**: Billing already records partial payments, and suspension policy has `reactivateOnPartialPayment`. Spec 001 resolves product behavior more strictly for payment-driven automation: no automatic reactivation while blocking overdue debt remains. The future implementation can preserve existing manual/suspension-engine policy semantics only where they do not conflict with this automatic payment path.

**Alternatives considered**:

- Honor `reactivateOnPartialPayment` for automatic payment reactivation even with delinquency: rejected by FR-005 and FR-006.
- Reject partial payments: rejected because Billing accepts valid partial payments and the spec requires them to remain auditable.

## Decision: Non-financial holds fail closed

**Rationale**: Current suspension records contain status, reason, source, events, and order state, but no complete accepted non-financial taxonomy. Payment automation should only reactivate when current evidence indicates a financial/delinquency suspension or no independent non-financial block. Unknown, manual, fraud, cancellation, baja, maintenance, security, or administrative holds should block automation and leave evidence for authorized manual recovery.

**Alternatives considered**:

- Reactivate any suspended customer once debt clears: rejected because payment must not override independent non-financial blocks.
- Create a broad new suspension taxonomy in Spec 001: rejected because the spec explicitly keeps taxonomy expansion out of scope.

## Decision: Reuse existing durable reactivation saga identity

**Rationale**: `PaymentService.reactivateCustomerService` already requires idempotency keys for webhook/live paths, creates or finds network orders, creates idempotent Mikrotik actions, records timeline/events/alerts, and checkpoints each effect. The existing root key derived from canonical payment and customer should remain the reactivation family identity: `tenantId + canonicalPaymentId + customerId`.

**Alternatives considered**:

- Create a new queue or saga framework: rejected as unnecessary and outside scope.
- Key by invoice only: rejected because customer-level debt and duplicate provider retries are the business boundary.
- Key globally without tenant: rejected because tenant isolation comes first.

## Decision: Preserve payment success when downstream reactivation fails

**Rationale**: Current billing route comments already state that Customers/Suspension/RouterOS unavailability must not turn a successful payment mutation into a retry-inducing 5xx. Spec 001 keeps this boundary: payment application is durable; downstream eligibility/reactivation/network failures become explicit audit, pending, dry-run, failed, or manual-recovery states.

**Alternatives considered**:

- Roll back payment if router dispatch fails: rejected because money state and network automation have different reliability boundaries.
- Return success without audit: rejected because operators need to distinguish financial and network state.

## Decision: Use existing safe-mode gates for network execution

**Rationale**: `backend/config/production-gates.ts` already provides `PAYMENTS_ROUTER_LIVE`, `MIKROTIK_WORKER_LIVE`, `MIKROTIK_WORKER_COMMIT`, and master live mode. `backend/domains/mikrotik/worker/worker.ts` claims orders and executes RouterOS only under commit gates. The implementation should continue to request or queue reactivation without claiming live restoration until worker evidence exists.

**Alternatives considered**:

- Add a new global live flag for this feature: rejected because existing gates already express payment-triggered router behavior and worker commit.
- Execute RouterOS from the payment request/webhook path: rejected by Constitution router-safety boundaries.

## Decision: No schema migration in the plan-only PR

**Rationale**: Existing migrations and code already include tenant/idempotency columns and durable reactivation structures for payment-engine effects. The plan identifies evidence that must be verified during implementation, but this PR is restricted to Spec Kit plan artifacts and cannot create or apply migrations.

**Alternatives considered**:

- Add an audit table now: rejected because no implementation or migration is authorized.
- Assume no migration is ever needed: rejected because implementation tasks must verify exact staging/main schema before changing runtime behavior.
