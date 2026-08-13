# Quickstart: Automatic Payment Reactivation Validation

This guide is for the future implementation PR. It does not authorize production operations, staging mutations, provider writes, or live RouterOS writes.

## Prerequisites

- Work on a feature branch derived from `main`.
- Keep local development hermetic unless explicit staging validation is authorized.
- Keep RouterOS live execution disabled by default.
- Use existing Store and Supabase repository contracts; do not bypass Billing or Suspension services.

## Local Non-Live Scenarios

1. Customer has one blocking delinquent invoice and pays enough to clear all beyond-grace debt.
   - Expected: payment is recorded, eligibility is true, one reactivation family is created, logical reactivation/audit evidence exists, network state is dry-run or queued.

2. Customer has two blocking delinquent invoices and pays only one.
   - Expected: payment is recorded, eligibility is false, outcome is `blocked_financial`, no automatic reactivation family is created.

3. Customer makes a partial payment while blocking debt remains.
   - Expected: partial payment is recorded, outcome is `blocked_financial`, no automatic reactivation starts.

4. Customer has no blocking financial debt but has an independent non-financial hold.
   - Expected: outcome is `blocked_non_financial`, no automatic reactivation starts, manual recovery remains available to authorized roles.

5. Duplicate approved webhook deliveries are processed concurrently.
   - Expected: one financial result, one canonical payment identity, one reactivation family, monotonic progress, and no duplicate timeline/event/alert/network effect.

6. Same provider event identifier appears for two tenants.
   - Expected: tenant-scoped idempotency allows independent processing and prevents cross-tenant invoice, customer, router, action, or audit access.

7. Payment clears debt while RouterOS execution is disabled.
   - Expected: payment success remains durable, reactivation request is visible, and network restoration is not claimed as live.

8. Customer is already active when an eligible payment is processed.
   - Expected: no new unnecessary reactivation action; existing durable family may be resumed if one already exists.

## Suggested Targeted Commands

Run narrow tests first in the implementation PR:

```powershell
npm run test:unit -- tests/unit/suspension.engine.test.ts
npm run test:unit -- tests/unit/payments.webhook-idempotency-claim.test.ts
npm run test:unit -- tests/unit/payments.reactivation-durable-saga.test.ts
npm run test:integration -- tests/contract/suspension.scenarios.contract.test.ts
```

Then run broader gates:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:auth
npm run test:db
npm run test:db:billing
npm run validate-production-readiness
npm run validate-restore-checklist
```

## External Validation Gates

These require separate authorization and evidence:

- Staging Supabase DB parity for payment, billing, suspension, tenant, and idempotency persistence.
- Payment-provider sandbox approved, duplicate, failed, pending, malformed, and signed webhook behavior.
- CHR/RouterOS lab execution with live worker commit enabled only for lab, never production.
- Production strict readiness and restore evidence after implementation artifacts exist.

## Expected Evidence

Every validation report should include:

- Exact branch and SHA.
- Command, result, and observation table.
- Sanitized tenant/customer/payment/action/order IDs or fingerprints.
- Explicit distinction between payment confirmed, debt cleared, reactivation requested, network dry-run/queued, and network restored.
- Confirmation that no secrets, raw provider payloads, JWTs, router credentials, or production identifiers were printed.
