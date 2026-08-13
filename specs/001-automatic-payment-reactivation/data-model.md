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
- Known or unknown independent non-financial blocks prevent automatic payment reactivation.
- Manual recovery remains possible through existing server-side suspension/reactivation permissions.

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
- `eligible` requires no blocking overdue debt, no independent non-financial block, customer status `suspended`, policy `autoReactivate=true`, and policy `reactivateOnPayment=true`.
- A disabled automation policy records a non-reactivation decision without preventing payment success.
- The decision is auditable whether eligible or blocked.

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
- Failed or uncertain RouterOS effects require operator-visible recovery evidence and must not duplicate payment effects.

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
