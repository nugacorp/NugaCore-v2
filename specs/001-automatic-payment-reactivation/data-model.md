# Data Model: Automatic Payment Reactivation

## Confirmed Payment Trigger

**Purpose**: Represents a server-approved payment event or authorized server-side payment record that may start eligibility evaluation after Billing applies it.

**Existing anchors**: `payment_events`, `payment_orders`, `payments`, `payment_applications`, `BillingService.recordPayment`, `BillingService.applyWebhookPayment`.

**Fields**:

- `tenantId`: Required tenant scope. Missing tenant context fails closed.
- `provider`: Provider name for webhook/online payments; manual payments keep existing Billing semantics.
- `providerEventId`: Provider delivery identity for webhook claim and retry handling.
- `invoiceId`: Invoice to which the payment is applied.
- `customerId`: Billing customer/client associated with the invoice.
- `canonicalPaymentId`: Durable Billing payment identity after application.
- `amount`: Applied amount according to Billing.
- `approved`: True only for provider-approved or authorized server-side payments.
- `source`: `webhook`, `manual-billing-route`, or another server-side authorized payment entry.

**Validation rules**:

- Evaluation starts only after payment application succeeds.
- Provider events must be approved and signature/claim validated by the existing webhook path.
- Duplicate provider events and duplicate canonical payments converge to one financial result.
- Cross-tenant invoice/customer/order references fail closed.

## Financial Eligibility Snapshot

**Purpose**: Captures the post-payment billing condition used to decide whether automatic reactivation may proceed.

**Existing anchors**: `BillingService.listInvoices`, `BillingService.getCustomerBalance`, `aggregateBillingStatus`, suspension policy `graceDays`.

**Fields**:

- `tenantId`
- `customerId`
- `evaluatedAt`
- `billingStatus`: `CURRENT`, `DUE_SOON`, `OVERDUE`, or `DELINQUENT`.
- `blockingOverdueDebt`: Boolean; true when customer debt is beyond the applicable grace period.
- `worstInvoiceId`: Invoice driving the blocking/warning state when known.
- `partialPaid`: Whether any open invoice has partial payment.
- `pendingInvoices`
- `overdueInvoices`
- `currentBalance`
- `overdueBalance`

**Validation rules**:

- `DELINQUENT` blocks automatic reactivation.
- `CURRENT` and `DUE_SOON` allow financial eligibility when other blocks are absent.
- `OVERDUE` inside grace remains visible and does not represent beyond-grace blocking debt.
- Partial payments are valid but do not allow reactivation while `blockingOverdueDebt` is true.

## Suspension Block Snapshot

**Purpose**: Captures whether the customer is suspended for a financial reason that automation may resolve, or an independent non-financial reason that automation must not override.

**Existing anchors**: customer `status`, `customer_service_state`, `suspension_events`, `suspension_orders`, manual suspension routes and reasons.

**Persistence decision**: **NEW_REQUIRED**. Existing anchors are useful evidence, but they are not sufficient as the durable source of truth for active blocking causes.

**Fields**:

- `tenantId`
- `customerId`
- `customerStatus`: `active`, `suspended`, `lead`, or `baja`.
- `serviceStatus`: Current suspension engine service status when available.
- `financialBlockKnown`: Boolean when existing evidence identifies delinquency/financial suspension.
- `nonFinancialBlockKnown`: Boolean when existing evidence identifies manual/admin/fraud/cancellation/maintenance/security/baja or other independent block.
- `blockReasonCategory`: `financial`, `non_financial`, `unknown`, or `none`.
- `sourceEvidence`: Sanitized references to event/order/state IDs or reason category, not raw sensitive payloads.

**Validation rules**:

- Already active customers produce no reactivation action unless an existing durable family is being resumed.
- `lead` and `baja` are not serviceable for automatic reactivation.
- Known non-financial blocks and unknown active blocks prevent automatic payment reactivation.
- Financial eligibility is not enough by itself. The active-block snapshot must also prove that no non-financial or unknown block is currently active.
- Manual recovery remains possible through existing server-side suspension/reactivation permissions.
- Free-text reasons and historical event/order source values may contribute evidence but must not be the only authority for automatic reactivation.

## Customer Suspension Block

**Purpose**: Minimal additive persistence required by the future implementation PR to distinguish active financial blocks from non-financial and unknown blocks without creating a broad suspension taxonomy.

**Status**: **NEW_REQUIRED** in a future implementation PR. No migration is created by this plan-only PR.

**Tentative table**: `public.customer_suspension_blocks`

**Fields**:

- `id`: Durable identifier.
- `tenantId`: Required tenant scope.
- `customerId`: Required customer scope.
- `category`: `financial`, `non_financial`, or `unknown`.
- `source`: Sanitized producer/source identifier such as `suspension-engine`, `manual`, `automation`, `payment-engine`, `system`, or `legacy`.
- `reason`: Operator-safe reason, not raw provider/router payload.
- `evidenceType`: Optional reference type, such as `suspension_event`, `suspension_order`, `reactivation_order`, `billing_snapshot`, or `manual_action`.
- `evidenceId`: Optional durable evidence ID.
- `createdAt`
- `clearedAt`: Null means the block is active.
- `clearedBy`
- `clearReason`

**Indexes and constraints**:

- Index active lookup by `(tenantId, customerId)` where `clearedAt IS NULL`.
- Index active lookup by `(tenantId, customerId, category)` where `clearedAt IS NULL`.
- Optional unique partial index on `(tenantId, evidenceType, evidenceId)` where `evidenceId IS NOT NULL` to prevent duplicate blocks from the same durable evidence.
- RLS/grants must preserve tenant isolation and least privilege. Service writes are allowed only through trusted backend paths.

**Validation rules**:

- Multiple active blocks may coexist for the same customer.
- Automatic reactivation is allowed only when all active blocks are financial and the post-payment financial snapshot is regularized.
- Any active `non_financial` or `unknown` block blocks automatic reactivation.
- Legacy ambiguous suspended customers must not be reclassified as financial from free text alone.
- Clearing a financial block after payment must not clear unrelated non-financial or unknown blocks.

## Reactivation Eligibility Decision

**Purpose**: The pure decision result consumed by payment and billing flows before any downstream side effect.

**Fields**:

- `tenantId`
- `customerId`
- `canonicalPaymentId`
- `invoiceId`
- `eligible`: Boolean.
- `outcome`: `eligible`, `blocked_financial`, `blocked_non_financial`, `automation_disabled`, `already_active`, `missing_identity`, `router_deferred`, or `not_serviceable`.
- `reason`: Operator-safe explanation.
- `financialSnapshot`
- `suspensionSnapshot`
- `networkMode`: `disabled`, `dry_run`, `queued`, or `live_candidate`.
- `idempotencyKey`: Root key for eligible durable families.

**Validation rules**:

- `canonicalPaymentId` is required for webhook-driven automatic effects.
- `eligible` requires no blocking overdue debt, active blocks limited to financial blocks that the payment regularized, customer status `suspended`, policy `autoReactivate=true`, and policy `reactivateOnPayment=true`.
- A disabled automation policy records a non-reactivation decision without preventing payment success.
- The decision is auditable whether eligible or blocked, using an existing tenant-scoped `suspension_events` decision record plus any active-block evidence.

## Reactivation Family

**Purpose**: Durable group of effects caused by one canonical payment for one tenant and customer.

**Existing anchors**: `reactivation_orders`, `mikrotik_actions`, `client_timeline`, `suspension_events`, `noc_alerts`, payment webhook checkpoints.

**Fields**:

- `tenantId`
- `customerId`
- `canonicalPaymentId`
- `idempotencyKey`
- `invoiceId`
- `triggeredBy`
- `orderId`
- `actionId`
- `dryRun`
- `routerId`
- `progress`: `customerReactivated`, `timelineAdded`, `networkDispatched`, `suspensionEventRecorded`, `alertCreated`.
- `status`: requested, resumed, completed, blocked, failed, or no-op.

**Validation rules**:

- At most one family exists for the same `tenantId`, `canonicalPaymentId`, and `customerId`.
- Replays return or resume the existing family.
- Progress is monotonic and never rewinds a completed effect.
- Router tenant ownership and credential readiness must be verified before live network dispatch.

## Network Restoration Evidence

**Purpose**: Separates reactivation request from actual RouterOS restoration.

**Existing anchors**: `reactivation_orders`, Mikrotik worker runs, command execution results, action dry-run fields.

**Fields**:

- `tenantId`
- `customerId`
- `routerId`
- `orderId`
- `actionId`
- `networkState`: `not_requested`, `dry_run`, `queued`, `executed`, `failed`, or `uncertain`.
- `workerRunId`
- `workerNote`
- `effectStartedAt`
- `effectConfirmedAt`
- `executedAt`

**Validation rules**:

- Payment confirmation, eligibility, and logical reactivation do not imply live network restoration.
- Live restoration is claimable only when worker/RouterOS evidence confirms execution.
- The worker must revalidate the latest active-block state after claiming an order and before live RouterOS commands. A new non-financial or unknown block cancels/fails the automatic effect before RouterOS mutation.
- Failed or uncertain RouterOS effects require operator-visible recovery evidence and must not duplicate payment effects.

## Persistence Fit Matrix

| Requirement | Decision | Evidence / Required Work |
|-------------|----------|--------------------------|
| Canonical payment identity | REUSE | Existing `payments`, `payment_events`, `payment_applications`, provider transaction identity, and `webhook_payment_id`. |
| Tenant/customer/payment scope | REUSE | Existing tenant-scoped Billing, Payment, Suspension, Customer, Router, order, and action paths. |
| Reactivation family identity | REUSE | Existing root key `payment:${canonicalPaymentId}:reactivate:${customerId}` plus tenant-scoped unique idempotency indexes. |
| Exactly-once order/action progress | REUSE | Existing `reactivation_orders`, `mikrotik_actions`, checkpoint RPC, claim fields, and worker recovery fields. |
| Decision audit | EXTEND | Existing `suspension_events` can store evaluated/blocked/disabled/no-op outcomes with idempotency keys and sanitized metadata. |
| Active suspension classification | NEW_REQUIRED | Add a minimal active-block model. Existing status/reason/event/order history is not sufficient as a safety boundary. |
| Worker pre-RouterOS safety | ADAPT | Existing worker claim/effect fields remain, but the future implementation must add final eligibility revalidation before live commands. |
| Legacy suspended customers | ADAPT | Treat ambiguous legacy state as `unknown` unless deterministic evidence proves a current financial block. |

## Audit Evidence

**Purpose**: Provides operator-visible proof without exposing secrets.

**Existing anchors**: payment events, suspension events, timeline entries, alerts, Mikrotik actions, readiness reports.

**Fields**:

- `tenantId`
- `customerId`
- `invoiceId`
- `canonicalPaymentId`
- `triggerFingerprint`
- `decisionOutcome`
- `decisionReason`
- `financialStatus`
- `blockReasonCategory`
- `networkState`
- `createdAt`
- `actorId`

**Validation rules**:

- Evidence must be sanitized and tenant-scoped.
- Raw provider payloads, secrets, JWTs, router credentials, and private operational logs are not evidence.
- Every eligible, blocked, disabled, dry-run, failed, no-op, and resumed path leaves an operator-visible record.

## State Transitions

```text
payment approved
  -> payment applied by Billing
  -> eligibility evaluated
  -> blocked_financial | blocked_non_financial | automation_disabled | already_active | eligible
  -> reactivation family created/resumed
  -> logical customer reactivation
  -> network dry-run/queued
  -> worker executed/failed/uncertain
  -> network restored only when execution evidence exists
```

Failed downstream steps never roll back the financial payment. Retries resume from durable progress when identity is available.
