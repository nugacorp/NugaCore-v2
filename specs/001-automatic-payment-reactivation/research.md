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

## Decision: Non-financial holds fail closed and require structured active-block evidence

**Rationale**: Current suspension records contain status, reason, source, events, and order state, but they do not durably model active blocking causes as structured data. A free-text reason, a historical order, or `customer.status = suspended` is not enough to prove that the current suspension is only financial. Payment automation should reactivate only when active evidence proves a financial/delinquency block and no active non-financial or unknown block exists. Unknown, manual, fraud, cancellation, baja, maintenance, security, administrative, or legacy ambiguous holds must block automation and leave evidence for authorized manual recovery.

**Alternatives considered**:

- Reactivate any suspended customer once debt clears: rejected because payment must not override independent non-financial blocks.
- Infer classification from free-text reason/source only: rejected because localized/manual/legacy text is not a security boundary.
- Create a broad new suspension taxonomy in Spec 001: rejected because the spec keeps taxonomy expansion out of scope.

## Decision: Existing persistence is not sufficient for the complete safe feature

**Answer**: **NO**. The feature cannot be implemented safely with only the currently documented persistence.

**Rationale**: Existing persistence is sufficient for the payment and reactivation saga identity: `payments`, `payment_events`, `payment_applications`, `reactivation_orders`, `mikrotik_actions`, `suspension_events`, `client_timeline`, and `noc_alerts` already support tenant-scoped idempotency and monotonic reactivation progress. The missing persistence is the safety boundary for active suspension classification. The current schema can record historical suspension events and orders, but it cannot reliably answer "which active blocks currently prevent automatic reactivation?" when financial, manual, and unknown legacy conditions may coexist. A future implementation PR therefore needs a minimal additive schema change before runtime behavior is enabled.

**Minimum required persistence for the future implementation PR**:

- Add a small tenant-scoped active-block model, tentatively `customer_suspension_blocks`, with `tenant_id`, `customer_id`, `category` (`financial`, `non_financial`, `unknown`), active/cleared timestamps, source/evidence references, sanitized reason, and audit timestamps.
- Enforce tenant scope, RLS/grants, non-destructive rollout, and indexes for active lookup by `(tenant_id, customer_id)`.
- Do not backfill ambiguous legacy rows as financial from text alone. Ambiguous existing suspended customers should start as `unknown` unless deterministic billing/suspension evidence proves a current financial block.
- Continue using existing `suspension_events` with tenant-scoped idempotency for decision audit, but do not use event history alone as the active-block source of truth.

**Alternatives considered**:

- Use `suspension_events.metadata` only: rejected because event history is append-only evidence, not a durable active-block set, and multiple simultaneous blockers are hard to clear deterministically.
- Add columns only to `customer_service_state`: rejected because one state row cannot safely represent multiple active blocking causes with independent evidence and clear events.
- Treat existing manual suspension routes as non-financial by convention: rejected because historical data and future operational reasons may be ambiguous.

## Decision: Reuse existing durable reactivation saga identity

**Rationale**: `PaymentService.reactivateCustomerService` already requires idempotency keys for webhook/live paths, creates or finds network orders, creates idempotent Mikrotik actions, records timeline/events/alerts, and checkpoints each effect. The existing root key derived from canonical payment and customer should remain the reactivation family identity: `tenantId + canonicalPaymentId + customerId`. In code this is `payment:${canonicalPaymentId}:reactivate:${customerId}`, enforced per tenant by unique partial indexes on tables such as `reactivation_orders` and `mikrotik_actions`.

**Alternatives considered**:

- Create a new queue or saga framework: rejected as unnecessary and outside scope.
- Key by invoice only: rejected because customer-level debt and duplicate provider retries are the business boundary.
- Key globally without tenant: rejected because tenant isolation comes first.

## Decision: Preserve payment success when downstream reactivation fails

**Rationale**: Current billing route comments already state that Customers/Suspension/RouterOS unavailability must not turn a successful payment mutation into a retry-inducing 5xx. Spec 001 keeps this boundary: payment application is durable; downstream eligibility/reactivation/network failures become explicit audit, pending, dry-run, failed, or manual-recovery states.

**Alternatives considered**:

- Roll back payment if router dispatch fails: rejected because money state and network automation have different reliability boundaries.
- Return success without audit: rejected because operators need to distinguish financial and network state.

## Decision: Revalidate eligibility immediately before RouterOS effects

**Rationale**: Existing payment and order idempotency protect against duplicate owners, and the Mikrotik worker uses durable claims plus `effectStartedAt`/`effectConfirmedAt` to avoid unsafe retries after uncertain RouterOS effects. However, the worker currently plans and executes a queued reactivation order without rechecking whether a manual or non-financial block appeared after order creation. The future implementation must add a final eligibility revalidation boundary after the worker claim and before live RouterOS command execution. If the latest active-block state is non-financial or unknown, the order must fail closed or be cancelled with audit evidence and no RouterOS write.

**Alternatives considered**:

- Trust eligibility only at payment time: rejected because operators can apply a manual/admin/security hold after the payment decision but before worker execution.
- Revalidate only after RouterOS execution: rejected because it would allow the unsafe side effect first.
- Re-run the full payment mutation in the worker: rejected because payment success is already durable and must not be coupled back to RouterOS execution.

## Decision: Use existing safe-mode gates for network execution

**Rationale**: `backend/config/production-gates.ts` already provides `PAYMENTS_ROUTER_LIVE`, `MIKROTIK_WORKER_LIVE`, `MIKROTIK_WORKER_COMMIT`, and master live mode. `backend/domains/mikrotik/worker/worker.ts` claims orders and executes RouterOS only under commit gates. The implementation should continue to request or queue reactivation without claiming live restoration until worker evidence exists.

**Alternatives considered**:

- Add a new global live flag for this feature: rejected because existing gates already express payment-triggered router behavior and worker commit.
- Execute RouterOS from the payment request/webhook path: rejected by Constitution router-safety boundaries.

## Decision: No schema migration in the plan-only PR

**Rationale**: This PR is restricted to Spec Kit plan artifacts and cannot create or apply migrations. The architecture decision above still means the next implementation PR must include a minimal additive migration for active suspension-block evidence before enabling automatic payment reactivation. Existing migrations and code already cover tenant/idempotency columns and durable reactivation structures for payment-engine effects; they do not close the active-block classification gap.

**Alternatives considered**:

- Add an audit table now: rejected because no implementation or migration is authorized.
- Assume no migration is ever needed: rejected because implementation tasks must verify exact staging/main schema before changing runtime behavior.
