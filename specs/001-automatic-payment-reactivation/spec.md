# Feature Specification: Automatic Payment Reactivation

**Feature Branch**: `feature/automatic-payment-reactivation`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "Brownfield specification for automatic service reactivation after confirmed payment in NugaCore v2. Audit current payment, billing, suspension, service-status, worker, MikroTik/RouterOS, feature-flag, tenant-isolation, idempotency, partial-payment, duplicate-webhook, and audit behavior. Do not implement code, migrations, runtime changes, provider writes, router writes, or production operations. Stop before planning."

## Scope & Boundaries *(mandatory)*

**Problem**: Suspended WISP customers who pay successfully must be reactivated only when the payment actually clears the financial condition that justified suspension, without duplicate charges, duplicate reactivation effects, tenant leakage, or false network-restoration evidence.

**Primary Actors**:

- Suspended customer paying through an approved payment channel.
- Billing or cobranza operator recording or reviewing a payment.
- Support/NOC operator investigating pending or failed reactivation.
- Authorized suspension/reactivation operator performing manual recovery.
- Payment provider delivering retryable webhook events.
- NugaCore automated billing, suspension, and network-safety processes.

**In Scope**:

- Automatic customer-level reactivation eligibility after a server-confirmed payment.
- Functional distinction between payment confirmation, debt settlement, reactivation eligibility, reactivation requested, and network access restored.
- Re-evaluation of blocking overdue debt after payment is applied, using the applicable grace-period and billing contract semantics.
- Protection against duplicate webhook, duplicate payment, retry, crash/reclaim, already-active, and concurrent manual-action effects.
- Tenant-scoped payment, billing, suspension, router, action, and audit evidence.
- Feature-flag behavior that allows payment processing to continue while automatic network reactivation is disabled or dry-run.
- Brownfield-compatible requirements for the next planning phase.

**Out of Scope**:

- Code implementation, refactors, migrations, schema changes, runtime config changes, provider writes, production operations, and live RouterOS writes.
- Per-service billing, per-subscription balances, per-service payment allocation, per-service suspension, or per-service reactivation.
- Redesigning billing, adding a new payment provider, adding a new queue framework, or creating a new suspension taxonomy.
- Creating a wallet, stored balance, customer credit ledger, credit application engine, refund logic, or full collection/dunning system.
- Introducing new roles or a new RBAC matrix for this feature.
- Large new billing UI, RouterOS redesign, mass migrations, or production rollout.
- Running `speckit-plan`, task generation, checklist command, analysis command, implementation, or convergence.

## Clarifications

### Session 2026-08-13

- Q: What event may start automatic reactivation? -> A: Only a server-confirmed successful payment may start it; UI state, unpaid orders, non-approved webhooks, or router observations are not valid triggers.
- Q: What financial state counts as settled for Spec 001? -> A: After payment is applied, the customer must have no blocking overdue balance beyond the applicable grace period; a single paid invoice is insufficient if other blocking overdue debt remains.
- Q: How should partial payments behave? -> A: Partial payments are valid and recorded normally, but they do not trigger automatic reactivation while blocking overdue debt remains.
- Q: Is Spec 001 customer-level or service/subscription-level? -> A: Spec 001 preserves the current customer-level model; service/subscription-level reactivation is explicitly out of scope for a future spec.
- Q: How should non-financial suspension reasons behave? -> A: Payment may clear the financial blocking condition, but it must not override independent non-financial blocking conditions.
- Q: How should overpayments behave? -> A: Overpayment must not create duplicate reactivations; if it clears blocking debt, eligibility may be evaluated, while credit/refund handling remains existing behavior or future scope.
- Q: Which permissions apply to retry, override, cancel, and manual reactivation? -> A: Reuse the existing server-side suspension/reactivation permission where applicable; do not create new roles in Spec 001.
- Q: How should network execution be represented before live router approval? -> A: Reactivation may be logical or queued/dry-run, and must not claim router-level restoration until network execution evidence exists.
- Q: How should duplicate webhooks, retries, and lost claims behave? -> A: They must converge to one financial outcome and one tenant-scoped reactivation family, with retryable in-progress outcomes and no duplicate effects.
- Q: Did the re-run of clarify find new material product ambiguity? -> A: No; remaining choices are technical design details and are deferred to planning.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reactivate Only After Blocking Debt Clears (Priority: P1)

As a suspended customer who has paid, I need NugaCore to restore my service only when the payment clears the overdue financial condition that justifies suspension.

**Why this priority**: This protects customers who paid enough to be eligible while avoiding premature restoration when other blocking overdue debt still exists.

**Independent Test**: Can be tested by starting from a suspended customer with one or more overdue invoices, applying a confirmed payment, re-evaluating the customer's blocking overdue balance, and verifying whether reactivation is requested.

**Acceptance Scenarios**:

1. **Given** a suspended customer with blocking overdue debt and automatic reactivation enabled, **When** a confirmed payment is applied and no blocking overdue balance remains beyond the applicable grace period, **Then** the customer becomes eligible for safe automatic reactivation.
2. **Given** a suspended customer with multiple overdue debts, **When** a confirmed payment settles one invoice but another blocking overdue balance remains, **Then** payment is recorded and the customer remains suspended without automatic reactivation.
3. **Given** a suspended customer with a partial payment, **When** the payment decreases the balance but blocking overdue debt remains, **Then** the payment remains valid and auditable but automatic reactivation does not start.

---

### User Story 2 - Preserve Money And Tenant Safety Under Retries (Priority: P1)

As a billing and release owner, I need duplicate deliveries, retries, and concurrent processing to be safe so that a single payment cannot duplicate financial, network, or audit effects.

**Why this priority**: Payment webhooks are retryable by design; repeated deliveries must produce the same business outcome as one valid delivery.

**Independent Test**: Can be tested by delivering the same approved payment event multiple times, concurrently and after an abandoned in-progress claim, and verifying a single financial outcome, single reactivation family, and tenant-scoped evidence.

**Acceptance Scenarios**:

1. **Given** two deliveries of the same approved provider event for the same tenant, **When** they are processed concurrently, **Then** the final financial state matches one processing and no duplicate reactivation, network, alert, timeline, or audit effect is created.
2. **Given** the same provider event identifier appears for two different tenants, **When** both tenants process their events, **Then** each tenant is handled independently and cannot affect the other tenant's invoice, customer, router, or action records.
3. **Given** a processing owner stops after applying an earlier step, **When** a retry resumes the event, **Then** completed effects are not repeated and missing effects may continue safely.

---

### User Story 3 - Keep Operators Honest About Financial And Network State (Priority: P2)

As a support or NOC operator, I need to see whether a paid customer is financially eligible, reactivation-requested, pending network execution, failed network execution, or actually restored on the router.

**Why this priority**: A paid customer may still be blocked by router execution, missing router assignment, dry-run mode, or an independent non-financial hold. The product must not hide that distinction.

**Independent Test**: Can be tested by confirming payment while router execution is dry-run, unavailable, or failed and verifying that operator-visible status says pending/queued/dry-run/failed instead of claiming live restoration.

**Acceptance Scenarios**:

1. **Given** a payment is confirmed while router execution is disabled, **When** automatic reactivation is evaluated, **Then** the customer has an auditable reactivation request but router restoration remains pending or dry-run.
2. **Given** a router action fails or is unavailable, **When** the customer checks status or an operator opens the account, **Then** payment remains recorded and the network action is visible as pending or failed with retry evidence.
3. **Given** a customer is already active, **When** an eligible payment confirmation arrives, **Then** no unnecessary reactivation action is created and the event remains traceable.

---

### User Story 4 - Respect Non-Financial Holds And Manual Recovery (Priority: P2)

As an authorized operator, I need payment-driven automation to avoid overriding non-financial suspensions while still leaving safe manual recovery paths.

**Why this priority**: Payment can clear a billing problem, but it must not override fraud, cancellation, maintenance, security, administrative, or manual holds.

**Independent Test**: Can be tested by simulating a paid customer with an independent non-financial blocking condition and verifying that payment remains recorded but automatic reactivation is not requested.

**Acceptance Scenarios**:

1. **Given** a customer is suspended for a recognized non-financial reason, **When** a payment is confirmed and financial debt is cleared, **Then** the customer remains suspended until an authorized manual process resolves the independent block.
2. **Given** a manual reactivation overlaps with an automatic reactivation request, **When** both attempt to resolve the same customer, **Then** the final state is coherent, auditable, tenant-scoped, and does not duplicate router work.
3. **Given** a retry, override, cancel, or manual reactivation is needed, **When** an operator performs it, **Then** server-side authorization uses the existing suspension/reactivation permission and the action is auditable.

---

### Edge Cases

- Payment is confirmed but has not yet been applied to financial state.
- Payment is applied but still leaves blocking overdue balance beyond the applicable grace period.
- Partial payment decreases the balance but does not clear the blocking condition.
- Full payment clears one invoice while another blocking overdue balance remains.
- Confirmed payment clears blocking overdue debt but an independent non-financial block remains.
- Overpayment exceeds the blocking debt and must not create duplicate reactivation or a new credit system inside Spec 001.
- Duplicate approved webhook deliveries arrive concurrently.
- Automatic retry runs while a prior processing attempt is still pending.
- A webhook claim is abandoned after payment is recorded but before all reactivation side effects complete.
- A provider sends an event for a payment order, invoice, tenant, or customer that cannot be resolved.
- The customer is already active when the automatic attempt arrives.
- Runtime flags allow payment processing but disable automatic network reactivation or live router writes.
- Router assignment is missing, belongs to another tenant, is offline, or lacks credentials.
- RouterOS write fails after the financial condition is resolved.
- A manual operator action races with a webhook-triggered automatic action.
- A payment provider sandbox or CHR/router lab is unavailable during validation.

## NugaCore Impact Review *(mandatory)*

| Area | Status | Requirement Impact |
|------|--------|--------------------|
| Security / Authorization | Applicable | Requires tenant fail-closed behavior, server-side auth/RBAC for manual recovery, provider webhook validation, and no frontend-as-source-of-truth decisions. |
| Data / Financial | Applicable | Touches invoices, balances, payments, payment allocation, canonical payment identity, blocking overdue debt, idempotency, duplicate events, and audit evidence. |
| Infrastructure / External Systems | Applicable | Touches payment webhooks, sandbox provider evidence, reactivation orders, MikroTik/RouterOS dry-run/live boundaries, and future worker behavior. |
| External Evidence | EXTERNAL_BLOCKED | Live provider sandbox, staging Supabase, CHR/RouterOS lab, and production-strict readiness evidence cannot be proven by a spec-only local change. |
| Backwards Compatibility | Applicable | Must preserve existing customer-level billing/reactivation behavior, billing routes, payment engine webhook behavior, suspension engine semantics, dry-run defaults, and tenant-scoped repository contracts. |

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST start automatic reactivation evaluation only after a server-confirmed successful payment event or authorized server-side payment record, never from UI-only state or router state.
- **FR-002**: The system MUST treat Billing as the source of truth for payment application, invoice balance, customer overdue balance, settlement status, canonical payment identity, and overpayment handling.
- **FR-003**: The system MUST distinguish these observable concepts: payment confirmed, financial state updated, blocking overdue debt cleared, reactivation eligible, reactivation requested, and network access restored.
- **FR-004**: The system MUST re-evaluate the customer's blocking overdue balance after payment is applied, using the applicable grace-period and billing contract semantics.
- **FR-005**: The system MUST NOT request automatic reactivation while blocking overdue debt remains, even if the triggering payment settled one invoice.
- **FR-006**: The system MUST record partial payments normally and apply them according to existing billing behavior, while preventing automatic reactivation until blocking overdue debt is cleared.
- **FR-007**: The system MUST allow automatic reactivation eligibility after an overpayment only when the payment clears the blocking overdue debt, and MUST NOT create multiple reactivation effects from the excess amount.
- **FR-008**: The system MUST NOT introduce a wallet, stored-balance ledger, credit application engine, or refund workflow in Spec 001.
- **FR-009**: The system MUST preserve customer-level reactivation for Spec 001 and MUST NOT require per-service or per-subscription financial allocation.
- **FR-010**: The system MUST limit automatic payment reactivation to suspensions that NugaCore recognizes as financial or delinquency-related.
- **FR-011**: The system MUST NOT let payment-driven automation override administrative, manual, fraud, cancellation, baja, maintenance, security, or other independent non-financial blocking conditions.
- **FR-012**: The system MUST avoid reactivation for non-approved, pending, failed, unrelated, canceled, or unresolved payment-provider events.
- **FR-013**: The system MUST create no more than one automatic reactivation family per tenant, canonical payment, and customer.
- **FR-014**: The system MUST make financial idempotency observable: processing the same confirmed payment/event repeatedly leaves the same financial outcome as processing it once.
- **FR-015**: The system MUST make reactivation idempotency observable: processing or retrying the same trigger causes at most one logical reactivation intent/effect.
- **FR-016**: The system MUST return retry-safe outcomes for duplicate, concurrent, already-processed, and in-progress webhook deliveries.
- **FR-017**: The system MUST resume an abandoned automatic reactivation from durable progress without redoing completed effects.
- **FR-018**: The system MUST preserve tenant isolation across payment event identity, invoice lookup, customer lookup, router lookup, reactivation action, suspension event, timeline, alert, and audit evidence.
- **FR-019**: The system MUST not consider a customer network-restored merely because the payment was confirmed or blocking debt was cleared; router restoration requires separate network evidence.
- **FR-020**: The system MUST keep successful financial payment recording durable even if downstream reactivation, alerts, timeline, suspension event, or network dispatch fails.
- **FR-021**: The system MUST keep router execution disabled by default unless the configured runtime and explicit human authorization allow live writes.
- **FR-022**: The system MUST reject or defer automatic reactivation when router ownership, router availability, tenant mismatch, or credential readiness cannot be established.
- **FR-023**: The system MUST record sanitized audit evidence for every automatic reactivation decision, including trigger, tenant, customer, invoice/payment identity, eligibility result, non-financial block result when known, and whether network execution was disabled, dry-run, queued, failed, or confirmed.
- **FR-024**: The system MUST preserve existing manual reactivation semantics while preventing manual and automatic paths from duplicating durable effects for the same customer and canonical payment outcome.
- **FR-025**: Retry, override, cancel, and manual reactivation actions MUST reuse the existing server-side suspension/reactivation permission where applicable and remain auditable; Spec 001 MUST NOT create new roles.
- **FR-026**: If automation is disabled, payment processing MUST continue normally, financial state MUST remain correct, automatic network reactivation MUST NOT run, and the result MUST remain observable and auditable.
- **FR-027**: The system MUST not weaken payment integrity, tenant isolation, RBAC, RLS expectations, readiness gates, or auditability through feature flags.
- **FR-028**: The system MUST fail closed when required tenant context, canonical payment identity, webhook ownership, provider signature evidence, or required persistence capability is missing.
- **FR-029**: The system MUST keep local development hermetic and able to validate non-live behavior without external services.

### Brownfield Capability Matrix

| Capability | Status | Evidence Summary |
|------------|--------|------------------|
| Payment confirmation | EXISTS | Payment engine processes approved provider events and billing routes can record server-side payments. |
| Payment idempotency | EXISTS | Webhook claim, tenant-scoped provider event identity, canonical payment identity, and retry behavior are present. |
| Payment allocation / settlement | EXISTS | Billing records payments, pending amounts, paid status, account balance projection, and overpayment rejection; webhook settlement winner exists. |
| Blocking overdue balance | PARTIAL | Repo has overdue/delinquent/grace-period concepts and customer balance projection; exact implementation of Spec 001 eligibility belongs to plan. |
| Partial payment behavior | PARTIAL | Billing can record partial payment and suspension policy has partial-payment flag; Spec 001 resolves product behavior by requiring no blocking overdue debt before auto-reactivation. |
| Logical customer reactivation | EXISTS | Payment service can reactivate the customer logically, record timeline/suspension event/alert, and create action evidence. |
| Reactivation order | EXISTS | Suspension engine and repository have reactivation order concepts. |
| Manual suspension/reactivation RBAC | EXISTS | Server-side routes use suspension evaluate roles (`super admin`, `administrador`, `cobranza`) and tests verify denied roles. |
| Router live execution | PARTIAL | Router command generation and workers exist with gates, but safe/default behavior is dry-run or read-only and live evidence remains external. |
| Feature flags / gates | EXISTS | `USE_DB_*` and production gates route persistence/live behavior without authorizing unsafe defaults. |
| Audit evidence | PARTIAL | Payment events, suspension events, timeline, alerts, Mikrotik actions, command audit, and safe-command audit exist, but end-to-end operator reporting needs plan validation. |
| Provider sandbox validation | PARTIAL | Provider integrations and hardening tests exist; real sandbox evidence remains external. |
| Multi-service reactivation | OUT_OF_SCOPE | Spec 001 preserves customer-level behavior; service/subscription-level billing/reactivation requires a future spec. |

### Key Entities *(include if feature involves data)*

- **Confirmed Payment Event**: Provider or manual payment confirmation accepted by the server, tenant-scoped, retryable, and tied to a canonical payment identity.
- **Financial State**: Billing-owned customer-level state containing payment application, invoice balances, overdue balance, grace-period relevance, and whether blocking overdue debt remains.
- **Customer**: The brownfield subject that may be suspended and may become eligible for customer-level reactivation in Spec 001.
- **Suspension State**: Operational/customer state that explains whether the customer is active, suspended, pending suspension, or pending reactivation, and whether the block is financial or independently non-financial when known.
- **Reactivation Family**: The durable group of side effects caused by one canonical payment for one tenant and customer.
- **Network Action**: The planned, queued, dry-run, failed, or confirmed router/network operation needed to restore connectivity.
- **Audit Evidence**: Sanitized records that let operators prove what happened without exposing secrets or private provider/router payloads.

### External Validation Requirements *(include if any NugaCore Impact row is EXTERNAL_BLOCKED)*

- **EV-001**: Staging Supabase evidence must prove payment, billing, suspension, tenant, and idempotency persistence behave the same as local non-live tests.
- **EV-002**: Payment-provider sandbox evidence must prove approved, duplicate, failed, pending, malformed, and signed webhook behaviors.
- **EV-003**: CHR/RouterOS lab evidence must prove controlled live-mode reactivation can be applied, audited, retried, and rolled back without touching production routers.
- **EV-004**: Production strict readiness must remain separate from local/staging PASS and cannot be claimed by this spec-only phase.
- **EV-005**: Restore/readiness evidence must prove any future durable payment/reactivation artifacts can be backed up and restored once implementation changes exist.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid confirmed payments that clear all blocking overdue customer debt and have no independent non-financial block create exactly one reactivation outcome in deterministic local validation.
- **SC-002**: 100% of valid confirmed payments that leave blocking overdue debt do not create automatic reactivation and remain auditable as valid payments.
- **SC-003**: 100% of valid confirmed payments for customers with independent non-financial blocks do not create automatic reactivation and expose the block reason category when known.
- **SC-004**: 100% of duplicate or concurrent deliveries of the same payment event produce no duplicate payment, reactivation, network, alert, timeline, or audit effects.
- **SC-005**: 100% of cross-tenant attempts fail closed without reading or mutating another tenant's payment, invoice, customer, router, action, or audit data.
- **SC-006**: 100% of partial, failed, pending, overpayment, unresolved, automation-disabled, and already-active cases produce explicit non-reactivation or no-op outcomes with audit evidence.
- **SC-007**: Operators can distinguish payment confirmed, debt settled, reactivation eligible, reactivation requested, and network access restored in every acceptance scenario without inspecting raw provider or router payloads.
- **SC-008**: Live router restoration is never claimed unless an approved live execution path produces sanitized confirmation evidence.
- **SC-009**: The final planned implementation, when authorized later, preserves existing lint, typecheck, unit, build, auth, DB, billing DB, readiness, and restore gates for its scope.

## Assumptions

- Existing payment provider, billing, suspension, tenant, and router domains remain the brownfield baseline.
- Spec 001 operates at customer level, matching current customer/client/plan-oriented behavior.
- The default safe runtime is non-live/dry-run for network effects.
- Payment confirmation, financial application, eligibility, reactivation request, and network restoration are separate observable concepts.
- The exact persistence representation, transaction boundaries, retry mechanism, queue/job design, and feature-flag wiring are technical plan decisions.
- Existing manual suspension/reactivation authorization is the permission family to reuse where applicable.
- Operators need sanitized evidence, not secrets, raw provider payloads, raw router scripts, or private infrastructure details.
- This specification does not authorize production use, staging mutation, database migration, live provider write, or live router write.

## Human Decisions

- **HUMAN-001 - RESOLVED**: Automatic reactivation requires no blocking overdue customer balance beyond the applicable grace period after payment is applied; one settled invoice is not sufficient if another blocking overdue debt remains.
- **HUMAN-002 - RESOLVED**: Partial payments are valid and recorded normally, but they do not trigger automatic reactivation while blocking overdue debt remains.
- **HUMAN-003 - RESOLVED**: Spec 001 preserves customer-level behavior; per-service/per-subscription billing, balances, suspension, and reactivation are out of scope.
- **HUMAN-004 - RESOLVED**: Payment-driven automation may clear financial blocks but must not override independent non-financial blocking conditions.
- **HUMAN-005 - RESOLVED**: Overpayment must not create duplicate reactivations; credit/refund/wallet behavior remains existing behavior or future scope.
- **HUMAN-006 - RESOLVED**: Retry, override, cancel, and manual reactivation must reuse the existing server-side suspension/reactivation permission where applicable; no new roles are introduced by Spec 001.

## Deferred To Plan

- **PLAN-001 - DEFER_TO_PLAN**: How to represent the reactivation intent/effect in persistence.
- **PLAN-002 - DEFER_TO_PLAN**: How to calculate blocking overdue customer balance from existing billing records without changing Spec 001 scope.
- **PLAN-003 - DEFER_TO_PLAN**: Exact transaction boundaries for payment application, eligibility, and reactivation side effects.
- **PLAN-004 - DEFER_TO_PLAN**: Exact retry, checkpoint, queue, or job design.
- **PLAN-005 - DEFER_TO_PLAN**: Exact feature-flag wiring for disabling automatic network reactivation while preserving payment processing.
- **PLAN-006 - DEFER_TO_PLAN**: Exact mapping from existing suspension evidence to financial vs non-financial blocking categories.
- **PLAN-007 - DEFER_TO_PLAN**: Exact operator-visible reporting fields and audit record shape.
