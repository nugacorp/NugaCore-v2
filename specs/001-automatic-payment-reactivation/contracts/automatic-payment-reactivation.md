# Contract: Automatic Payment Reactivation

This contract describes the internal backend interface for the next implementation PR. It is not a new public API and does not authorize runtime changes in this plan-only PR.

## Invocation Points

- Payment webhook path after `BillingService.applyWebhookPayment` returns a canonical payment identity.
- Authorized server-side payment recording path after `BillingService.recordPayment` commits.
- Operator recovery paths may inspect or retry existing reactivation evidence through current suspension/reactivation authorization.

## Input

```ts
interface AutomaticPaymentReactivationInput {
  tenantId: string;
  customerId: string;
  invoiceId: string;
  canonicalPaymentId: string;
  trigger: {
    source: 'webhook' | 'manual-billing-route' | 'server-payment';
    provider?: string;
    providerEventFingerprint?: string;
    actorId?: string;
  };
  paymentAppliedAt: string;
  webhookFence?: {
    eventId: string;
    claimToken: string;
  };
}
```

## Output

```ts
interface AutomaticPaymentReactivationResult {
  tenantId: string;
  customerId: string;
  invoiceId: string;
  canonicalPaymentId: string;
  eligible: boolean;
  outcome:
    | 'eligible'
    | 'blocked_financial'
    | 'blocked_non_financial'
    | 'automation_disabled'
    | 'already_active'
    | 'missing_identity'
    | 'router_deferred'
    | 'not_serviceable';
  reason: string;
  financial: {
    billingStatus: 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'DELINQUENT';
    blockingOverdueDebt: boolean;
    worstInvoiceId?: string;
    currentBalance: number;
    overdueBalance: number;
    pendingInvoices: number;
    overdueInvoices: number;
  };
  suspension: {
    customerStatus: 'active' | 'suspended' | 'lead' | 'baja';
    serviceStatus?: 'ACTIVE' | 'WARNING' | 'PENDING_SUSPENSION' | 'SUSPENDED' | 'PENDING_REACTIVATION';
    blockReasonCategory: 'financial' | 'non_financial' | 'unknown' | 'none';
    activeBlocks: Array<{
      category: 'financial' | 'non_financial' | 'unknown';
      evidenceType?: string;
      evidenceId?: string;
    }>;
  };
  reactivation?: {
    idempotencyKey: string;
    orderId?: string;
    actionId?: string;
    dryRun: boolean;
    networkState: 'dry_run' | 'queued' | 'executed' | 'failed' | 'uncertain';
  };
}
```

## Required Behavior

- The interface must fail closed when `tenantId`, `customerId`, `invoiceId`, or canonical payment identity is missing for webhook-driven effects.
- The implementation must read Billing, Customers, Suspension, and Router inventory with explicit tenant scope.
- The implementation must evaluate customer-level blocking overdue debt after payment application.
- The implementation must not request automatic reactivation when `billingStatus` is `DELINQUENT`.
- The implementation must not infer financial suspension from free-text reason, customer status, or historical order source alone.
- The implementation must not override known non-financial or unknown active suspension blocks.
- The implementation must create or resume at most one reactivation family per `tenantId`, `canonicalPaymentId`, and `customerId`.
- The implementation must preserve payment success if eligibility, audit, reactivation order, alert, timeline, or network dispatch fails after the financial write.
- The implementation must not claim `executed` network state unless worker/RouterOS evidence exists.
- The worker must revalidate active suspension blocks after claiming an order and before live RouterOS commands.
- The implementation must use sanitized fingerprints and IDs for provider evidence.

## Error Semantics

| Condition | Outcome |
|-----------|---------|
| Missing tenant context | Fail closed before side effects |
| Missing canonical payment identity in webhook path | `missing_identity` or existing service error before reactivation effects |
| Customer has remaining beyond-grace debt | `blocked_financial` |
| Customer has independent non-financial block | `blocked_non_financial` |
| Customer has ambiguous/legacy active suspension evidence | `blocked_non_financial` or fail-closed `unknown` classification without RouterOS effects |
| Automation policy disabled | `automation_disabled` |
| Customer already active | `already_active`, unless resuming an existing durable family |
| Router missing or unavailable | `router_deferred` or existing retryable service error after audit |
| Duplicate webhook or retry | Return existing financial/reactivation result or resume incomplete effects |
| Cross-tenant mismatch | Fail closed without reading or mutating the other tenant |
| Active block changes after order creation | Worker stops before live RouterOS mutation and records cancellation/failure evidence |

## Compatibility Notes

- No new roles are introduced.
- No public endpoint is required for the initial implementation.
- Existing dry-run defaults remain intact.
- Existing manual payment and webhook payment contracts remain the money source of truth.
- A future additive persistence migration is required for active suspension-block evidence before runtime enablement.
