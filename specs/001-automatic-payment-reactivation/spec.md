# Feature Specification: Automatic Payment Reactivation

**Feature Branch**: `feature/automatic-payment-reactivation`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "Brownfield specification for automatic service reactivation after confirmed payment in NugaCore v2. Audit current payment, billing, suspension, service-status, worker, MikroTik/RouterOS, feature-flag, tenant-isolation, idempotency, partial-payment, duplicate-webhook, and audit behavior. Do not implement code, migrations, runtime changes, provider writes, router writes, or production operations. Stop before planning."

## Scope & Boundaries *(mandatory)*

**Problem**: Suspended WISP customers who pay successfully must be reactivated without duplicate charges, duplicate network actions, tenant leakage, or false operational evidence. The product needs one brownfield specification that states the desired behavior, identifies what already exists, and records the remaining product decisions before implementation planning.

**Primary Actors**:

- Suspended customer paying through an approved payment channel.
- Billing or cobranza operator recording or reviewing a payment.
- Support/NOC operator investigating pending or failed reactivation.
- Payment provider delivering retryable webhook events.
- NugaCore automated billing, suspension, and network-safety processes.

**In Scope**:

- Automatic eligibility evaluation after a server-confirmed payment.
- Separation between financial settlement, logical customer/service status, and network execution status.
- Duplicate webhook, duplicate payment, retry, crash/reclaim, and concurrent manual-action behavior.
- Tenant-scoped payment, billing, suspension, router, action, and audit evidence.
- Feature-flag and runtime-mode behavior for dry-run, staging, sandbox, and future live execution.
- Brownfield capability classification and unresolved decisions for the next planning phase.

**Out of Scope**:

- Code implementation, refactors, migrations, schema changes, runtime config changes, provider writes, production operations, and live RouterOS writes.
- Changing payment provider contracts or enabling real provider settlement outside sandbox/test evidence.
- Creating a new subscription model or multi-service billing model before human product decisions are made.
- Replacing existing RBAC, tenant-resolution, or readiness-gate architecture.
- Running `speckit-plan`, task generation, checklist command, analysis command, implementation, or convergence.

## Clarifications

### Session 2026-08-13

- Q: What event may start automatic reactivation? -> A: Only a server-confirmed successful payment may start it; UI state, unpaid orders, non-approved webhooks, or router observations are not valid triggers.
- Q: What financial state counts as settled for current brownfield behavior? -> A: Existing webhook behavior treats the specific invoice's first full settlement as the durable trigger; broader customer/account debt scope remains `NEEDS_HUMAN_DECISION`.
- Q: How should network execution be represented before live router approval? -> A: Reactivation may be logical or queued/dry-run, and must not claim router-level restoration until network execution evidence exists.
- Q: How should duplicate webhooks, retries, and lost claims behave? -> A: They must converge to one canonical payment and one tenant-scoped reactivation family, with retryable in-progress outcomes and no duplicate effects.
- Q: Is the feature customer-level or service/subscription-level? -> A: Current repo evidence is customer-level; service/subscription granularity remains `NEEDS_HUMAN_DECISION`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reactivate After Confirmed Settlement (Priority: P1)

As a suspended customer who has paid successfully, I need NugaCore to recognize the confirmed payment and move my account toward reactivation without waiting for duplicate manual work.

**Why this priority**: This is the core business value: fewer support tickets, faster restoration, and fewer manual mistakes after payment.

**Independent Test**: Can be tested by starting from a suspended customer with a payable invoice, confirming a valid payment once, and verifying that financial state is settled, reactivation is requested once, and audit evidence identifies the trigger.

**Acceptance Scenarios**:

1. **Given** a suspended customer with an unpaid invoice and automatic reactivation enabled, **When** a valid full payment is confirmed by the server, **Then** the system records the payment, marks the invoice settled, and creates exactly one reactivation outcome for the eligible customer or service.
2. **Given** a suspended customer with an unpaid invoice, **When** a payment provider sends a non-approved, failed, pending, or unrelated event, **Then** no invoice is settled and no reactivation is started.
3. **Given** a suspended customer whose paid invoice leaves other debt according to the selected product policy, **When** the payment is confirmed, **Then** the system follows the chosen debt-scope rule and does not falsely report full eligibility.

---

### User Story 2 - Preserve Money And Tenant Safety Under Retries (Priority: P1)

As a billing and release owner, I need duplicate deliveries, retries, and concurrent processing to be safe so that a single payment cannot duplicate financial, network, or audit effects.

**Why this priority**: Payment webhooks are retryable by design; exactly-once user outcomes must be achieved with idempotency and tenant isolation.

**Independent Test**: Can be tested by delivering the same approved payment event multiple times, concurrently and after an abandoned in-progress claim, and verifying a single canonical payment, single reactivation family, and tenant-scoped evidence.

**Acceptance Scenarios**:

1. **Given** two deliveries of the same approved provider event for the same tenant, **When** they are processed concurrently, **Then** only one delivery performs mutating effects and the other returns an in-progress or already-processed outcome.
2. **Given** the same provider event identifier appears for two different tenants, **When** both tenants process their events, **Then** each tenant is handled independently and cannot affect the other tenant's invoice, customer, router, or action records.
3. **Given** a processing owner loses its claim after applying an earlier step, **When** a retry reclaims the event, **Then** the retry resumes only missing steps and does not duplicate completed effects.

---

### User Story 3 - Keep Operators Honest About Network State (Priority: P2)

As a support or NOC operator, I need to see whether a paid customer is financially settled, logically reactivated, pending network execution, failed network execution, or actually restored on the router.

**Why this priority**: A paid customer may still be blocked by router execution, missing router assignment, dry-run mode, or operator approval. The product must not hide that distinction.

**Independent Test**: Can be tested by confirming payment while router execution is dry-run or unavailable and verifying that user-facing/operator-facing status says pending/queued/dry-run instead of claiming live restoration.

**Acceptance Scenarios**:

1. **Given** a payment is confirmed while router execution is disabled, **When** automatic reactivation is evaluated, **Then** the customer has an auditable reactivation request but router restoration remains pending or dry-run.
2. **Given** a router action fails or is unavailable, **When** the customer checks status or an operator opens the account, **Then** payment remains recorded and the network action is visible as pending or failed with retry evidence.
3. **Given** a customer is already active, **When** an eligible payment confirmation arrives, **Then** no unnecessary reactivation action is created and the event is still traceable.

---

### User Story 4 - Support Manual Review And Recovery (Priority: P3)

As a cobranza or NOC operator, I need safe manual review and retry paths for ambiguous cases without weakening automatic guarantees.

**Why this priority**: Some cases require human decision: partial payments, non-financial suspensions, multiple services, overpayments, and failed network execution.

**Independent Test**: Can be tested by simulating each ambiguous or failed state and verifying that automatic behavior stops safely, records why, and leaves enough evidence for authorized manual recovery.

**Acceptance Scenarios**:

1. **Given** a partial payment where policy does not authorize partial reactivation, **When** the payment is confirmed, **Then** the invoice/payment is recorded but reactivation is not started.
2. **Given** a manual reactivation overlaps with an automatic reactivation request, **When** both attempt to resolve the same customer or service, **Then** the final state is single, auditable, tenant-scoped, and does not duplicate router work.
3. **Given** a suspension reason that is not financial, **When** a payment is confirmed, **Then** the system does not auto-reactivate unless the product policy explicitly permits it.

---

### Edge Cases

- Partial payment reduces the balance but leaves the invoice or account delinquent.
- Full payment settles one invoice while other overdue invoices remain open.
- Overpayment attempt exceeds the pending invoice balance.
- Duplicate approved webhook deliveries arrive concurrently.
- A webhook claim is abandoned after payment is recorded but before all reactivation side effects complete.
- A provider sends an event for a payment order, invoice, tenant, or customer that cannot be resolved.
- The customer is already active when the event is processed.
- The customer is suspended for non-financial, fraud, legal, manual hold, maintenance, or cancellation reasons.
- The customer has multiple services, subscriptions, plans, or router mappings.
- Router assignment is missing, belongs to another tenant, is offline, or lacks credentials.
- Runtime flags allow logical/dry-run behavior but do not allow live router writes.
- A manual operator action races with a webhook-triggered automatic action.
- A retry occurs after a previous attempt created an audit record, alert, timeline entry, or reactivation order.
- A payment provider sandbox or CHR/router lab is unavailable during validation.

## NugaCore Impact Review *(mandatory)*

| Area | Status | Requirement Impact |
|------|--------|--------------------|
| Security / Authorization | Applicable | Requires tenant fail-closed behavior, server-side auth/RBAC for manual recovery, provider webhook validation, and no frontend-as-source-of-truth decisions. |
| Data / Financial | Applicable | Touches invoices, balances, payments, payment allocation, canonical payment identity, idempotency, duplicate events, and audit evidence. |
| Infrastructure / External Systems | Applicable | Touches payment webhooks, sandbox provider evidence, reactivation orders, MikroTik/RouterOS dry-run/live boundaries, and future worker behavior. |
| External Evidence | EXTERNAL_BLOCKED | Live provider sandbox, staging Supabase, CHR/RouterOS lab, and production-strict readiness evidence cannot be proven by a spec-only local change. |
| Backwards Compatibility | Applicable | Must preserve existing billing payment routes, payment engine webhook behavior, suspension engine semantics, dry-run defaults, and tenant-scoped repository contracts. |

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST start automatic reactivation only after a server-confirmed successful payment event or authorized server-side payment record, never from UI-only state or router state.
- **FR-002**: The system MUST treat Billing as the source of truth for invoice balance, payment allocation, settlement status, canonical payment identity, and overpayment rejection.
- **FR-003**: The system MUST evaluate automatic reactivation only for customers or services that are currently suspended or pending reactivation for a payment-related reason.
- **FR-004**: The system MUST avoid reactivation for non-approved, pending, failed, unrelated, canceled, or unresolved payment-provider events.
- **FR-005**: The system MUST create no more than one automatic reactivation family per tenant, canonical payment, and affected customer or service.
- **FR-006**: The system MUST return retry-safe outcomes for duplicate, concurrent, already-processed, and in-progress webhook deliveries.
- **FR-007**: The system MUST resume an abandoned automatic reactivation from durable progress without redoing completed effects.
- **FR-008**: The system MUST preserve tenant isolation across payment event identity, invoice lookup, customer lookup, router lookup, reactivation action, suspension event, timeline, alert, and audit evidence.
- **FR-009**: The system MUST not consider a customer network-restored merely because the invoice was paid; financial settlement, logical reactivation, queued/dry-run action, failed action, and live network confirmation are distinct states.
- **FR-010**: The system MUST keep router execution disabled by default unless the configured runtime and explicit human authorization allow live writes.
- **FR-011**: The system MUST record sanitized audit evidence for every automatic reactivation decision, including trigger, tenant, customer or service, invoice/payment identity, result, and whether network execution was dry-run, queued, failed, or confirmed.
- **FR-012**: The system MUST not weaken payment integrity, tenant isolation, RBAC, RLS expectations, readiness gates, or auditability through feature flags.
- **FR-013**: The system MUST reject or defer automatic reactivation when router ownership, router availability, tenant mismatch, or credential readiness cannot be established.
- **FR-014**: The system MUST keep successful financial payment recording durable even if downstream reactivation, alerts, timeline, suspension event, or network dispatch fails.
- **FR-015**: The system MUST prevent overpayment from silently creating credit or reactivation side effects unless a product-approved credit policy exists.
- **FR-016**: The system MUST handle partial payment according to policy, with the default behavior preventing automatic reactivation while payment-related debt remains unsettled.
- **FR-017**: The system MUST expose enough operator-visible state to distinguish active, suspended, pending reactivation, pending network execution, dry-run execution, failed network execution, and already-active no-op outcomes.
- **FR-018**: The system MUST preserve existing manual reactivation semantics while preventing manual and automatic paths from duplicating durable effects for the same canonical payment outcome.
- **FR-019**: The system MUST fail closed when required tenant context, canonical payment identity, webhook ownership, provider signature evidence, or required persistence capability is missing.
- **FR-020**: The system MUST keep local development hermetic and able to validate non-live behavior without external services.

### Brownfield Capability Matrix

| Capability | Status | Evidence Summary |
|------------|--------|------------------|
| Payment confirmation | EXISTS | Payment engine processes approved provider events and billing routes can record server-side payments. |
| Payment idempotency | EXISTS | Webhook claim, tenant-scoped provider event identity, canonical payment identity, and retry behavior are present. |
| Payment allocation / settlement | EXISTS | Billing records payments, pending amounts, paid status, and overpayment rejection; webhook settlement winner exists. |
| Suspension decision engine | EXISTS | Suspension policy, billing status aggregation, pending reactivation state, and idempotent orders exist. |
| Logical reactivation | EXISTS | Payment service can reactivate the customer logically, record timeline/suspension event/alert, and create action evidence. |
| Router live execution | PARTIAL | Router command generation and workers exist with gates, but safe/default behavior is dry-run or read-only and live evidence remains external. |
| Feature flags / gates | EXISTS | `USE_DB_*` and production gates route persistence/live behavior without authorizing unsafe defaults. |
| Audit evidence | PARTIAL | Payment events, suspension events, timeline, alerts, Mikrotik actions, command audit, and safe-command audit exist, but end-to-end operator reporting needs product validation. |
| Provider sandbox validation | PARTIAL | Provider integrations and hardening tests exist; real sandbox evidence remains external. |
| Multi-service reactivation | NEEDS_HUMAN_DECISION | Current evidence is primarily customer-level, with plan/client fields but no accepted service/subscription reactivation contract. |

### Key Entities *(include if feature involves data)*

- **Confirmed Payment Event**: Provider or manual payment confirmation accepted by the server, tenant-scoped, retryable, and tied to a canonical payment identity.
- **Invoice / Balance State**: Billing-owned financial state containing billed amount, paid amount, pending amount, status, and settlement outcome.
- **Customer / Service Subject**: The customer or future service/subscription that may be suspended and may become eligible for reactivation.
- **Suspension State**: Operational/customer state that explains whether the subject is active, suspended, pending suspension, or pending reactivation.
- **Reactivation Family**: The durable group of side effects caused by one canonical payment for one tenant and subject.
- **Network Action**: The planned, queued, dry-run, failed, or confirmed router/network operation needed to restore connectivity.
- **Audit Evidence**: Sanitized records that let operators prove what happened without exposing secrets or private provider/router payloads.

### External Validation Requirements *(include if any NugaCore Impact row is EXTERNAL_BLOCKED)*

- **EV-001**: Staging Supabase evidence must prove payment, billing, suspension, tenant, and idempotency persistence behave the same as local non-live tests.
- **EV-002**: Payment-provider sandbox evidence must prove approved, duplicate, failed, pending, and malformed webhook behaviors.
- **EV-003**: CHR/RouterOS lab evidence must prove live-mode reactivation can be applied, audited, retried, and rolled back without touching production routers.
- **EV-004**: Production strict readiness must remain separate from local/staging PASS and cannot be claimed by this spec-only phase.
- **EV-005**: Restore/readiness evidence must prove new durable payment/reactivation artifacts can be backed up and restored once implementation changes exist.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid full-payment confirmations for eligible suspended subjects create exactly one reactivation outcome in local deterministic validation.
- **SC-002**: 100% of duplicate or concurrent deliveries of the same payment event produce no duplicate payment, reactivation, network, alert, timeline, or audit effects.
- **SC-003**: 100% of cross-tenant attempts fail closed without reading or mutating another tenant's payment, invoice, customer, router, action, or audit data.
- **SC-004**: 100% of partial, failed, pending, overpayment, unresolved, and already-active cases produce explicit non-reactivation or no-op outcomes with audit evidence.
- **SC-005**: Operators can distinguish financial settlement from network restoration in every acceptance scenario without inspecting raw provider or router payloads.
- **SC-006**: Live router restoration is never claimed unless an approved live execution path produces sanitized confirmation evidence.
- **SC-007**: The final planned implementation, when authorized later, preserves existing lint, typecheck, unit, build, auth, DB, billing DB, readiness, and restore gates for its scope.

## Assumptions

- Existing payment provider, billing, suspension, tenant, and router domains remain the brownfield baseline.
- The default safe runtime is non-live/dry-run for network effects.
- Full settlement means the applicable invoice has no pending balance unless the owner later chooses a broader debt-scope policy.
- `reactivateOnPartialPayment` exists, but the product policy for partial reactivation requires explicit human confirmation before implementation planning.
- Current repo evidence models service restoration mostly at customer level; service/subscription-level behavior is intentionally deferred.
- Operators need sanitized evidence, not secrets, raw provider payloads, raw router scripts, or private infrastructure details.
- This specification does not authorize production use, staging mutation, database migration, live provider write, or live router write.

## Human Decisions Required

- **HUMAN-001**: `NEEDS_HUMAN_DECISION` - Debt scope for eligibility: paid invoice only, all overdue invoices for the customer, total customer balance, or subscription/service-specific balance.
- **HUMAN-002**: `NEEDS_HUMAN_DECISION` - Partial-payment policy: never reactivate by partial payment, reactivate when policy flag is true, or require a threshold/payment agreement.
- **HUMAN-003**: `NEEDS_HUMAN_DECISION` - Subject granularity: customer-level reactivation for v1 or service/subscription-level reactivation where a customer has multiple services.
- **HUMAN-004**: `NEEDS_HUMAN_DECISION` - Suspension reason taxonomy: which suspension reasons are financial and eligible for automatic reactivation versus manual-only.
- **HUMAN-005**: `NEEDS_HUMAN_DECISION` - Overpayment/credit behavior: reject overpayment, create credit, or apply across debts before eligibility.
- **HUMAN-006**: `NEEDS_HUMAN_DECISION` - Operator recovery roles: which roles may retry, cancel, override, or force-complete a pending/failed automatic reactivation.
