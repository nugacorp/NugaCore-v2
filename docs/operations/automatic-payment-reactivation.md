# Automatic Payment Reactivation Operations

This runbook covers Spec 001 automatic service reactivation after confirmed payment. It is an operations and release document, not an authorization to mutate production, enable live RouterOS writes, or fabricate external evidence.

## Runtime Flags And Defaults

Automatic reactivation is controlled by two layers:

| Layer | Control | Default / Safe State | Effect |
| --- | --- | --- | --- |
| Suspension policy | `autoReactivate` | Repository default is enabled for the policy model; operators may disable it per policy. | When false, confirmed payments remain durable but no automatic reactivation is requested. |
| Suspension policy | `reactivateOnPayment` | Repository default is enabled for the policy model; operators may disable it per policy. | When false, confirmed payments remain durable but no automatic reactivation is requested. |
| Payment/router handoff | `PAYMENTS_ROUTER_LIVE` | `false` unless explicitly set or `NUGACORE_LIVE_MODE=true`. | When false, payment paths can record logical/audit outcomes but do not claim live network restoration. |
| Worker live reads | `MIKROTIK_WORKER_LIVE` | `false` unless explicitly set or `NUGACORE_LIVE_MODE=true`. | When false, worker router reads are simulated/dry-run. |
| Worker live writes | `MIKROTIK_WORKER_COMMIT` | `false` unless explicitly set or `NUGACORE_LIVE_MODE=true`. | When false, RouterOS command execution is blocked. Commit also requires live worker mode. |
| Persistence | `USE_DB_CUSTOMERS`, `USE_DB_BILLING`, `USE_DB_PAYMENTS`, `USE_DB_SUSPENSION` | Local tests default to store/in-memory unless configured. | DB-backed staging/production validation requires the relevant Supabase migrations and flags. |

Payment application is the money source of truth. If a confirmed payment is accepted and durably applied, later audit, timeline, order, alert, worker, or RouterOS failures must not roll back that payment. The recovery path is to retry or manually reconcile the network state, not to destroy financial records.

## Operator State Model

Operators must distinguish these states:

| State | Meaning | Allowed Claim |
| --- | --- | --- |
| `payment confirmed` | Trusted server-side payment confirmation was accepted. | Money can be treated as applied only after Billing commits it. |
| `financial eligibility` | Customer-level blocking overdue debt was evaluated after payment application. | Eligible only when no beyond-grace blocking debt remains. |
| `blocked_financial` | Payment did not clear all blocking customer debt. | No automatic reactivation. Payment stays recorded. |
| `blocked_non_financial` | Active non-financial hold or unknown blocker exists. | No automatic reactivation. Manual recovery required. |
| `automation_disabled` | Policy/gates disable automatic behavior. | Payment stays recorded; no automatic network action. |
| `reactivation requested` | One canonical reactivation family was created or resumed. | Logical request exists; do not claim router restored yet. |
| `queued` / `dry_run` | Worker/order evidence exists but live write has not been confirmed. | Network restoration is pending or simulated. |
| `failed` / `uncertain` | Worker could not prove final RouterOS effect. | Payment remains settled; operator reconciliation or retry is needed. |
| `restored` | Worker/RouterOS evidence confirms the effect. | Only this state can be reported as network restored. |
| `manual` / `automatic` | Origin preserved in events/order metadata. | Keep origin in reports and incident notes. |

Decision and worker evidence must stay tenant scoped and sanitized. Do not paste provider secrets, raw webhook payloads, JWTs, router credentials, full RouterOS scripts, private keys, or production-only identifiers into tickets or reports.

## Operator Recovery

Use existing server-side RBAC and routes. Do not introduce ad hoc DB edits for normal recovery.

| Need | Safe Path | Notes |
| --- | --- | --- |
| Inspect policy | `GET /api/suspension/policies` | View roles can inspect. |
| Disable automatic reactivation | `PUT /api/suspension/policies` with `autoReactivate=false` and/or `reactivateOnPayment=false` | Use authorized policy roles. This is the first rollback lever. |
| Inspect decision/audit events | `GET /api/suspension/events?customerId=<id>` | Evidence is sanitized and tenant scoped. |
| Retry pending worker work | `POST /api/mikrotik/worker/run` | Authorized provisioning/script roles only. Live writes still require gates. |
| Reconcile uncertain RouterOS effect | `POST /api/mikrotik/worker/orders/:id/reconcile-confirmed` with `routerId` | Super admin/admin only, after out-of-band confirmation of the router state. |
| Manual non-financial suspension | `POST /api/suspension/clients/:id/suspend` | Creates a structured `non_financial` active block. |
| Manual recovery/reactivation | `POST /api/suspension/clients/:id/reactivate` | Clears active blocks for that customer through the authorized manual route. |

Unknown classification fails closed. A customer with `status = suspended` and no structured deterministic financial block is not eligible for automatic reactivation. The operator path is manual review, then authorized manual reactivation or a future approved data repair/migration.

## Structured Financial Blocks (Who Creates Them)

`public.customer_suspension_blocks` is the only structured authority on why a customer is currently blocked. Two producers exist, and they are deliberately different:

| Producer | Path | Category | Evidence |
| --- | --- | --- | --- |
| Suspension engine | `applyEvaluation` in `backend/domains/suspension/engine.ts`, via `ensureEngineFinancialBlock` in `backend/domains/suspension/financial-blocks.ts` | `financial` | `evidence_type = 'suspension_order'`, `evidence_id = <id of the engine suspension order>` |
| Manual operator suspension | `POST /api/suspension/clients/:id/suspend` | `non_financial` | `evidence_type = 'manual_action'` |

The engine creates a `financial` block only when it emits a suspension order for `DELINQUENT` billing — that is, debt beyond the applicable grace window. Debt still inside grace (`OVERDUE`) produces no order and no block. A disabled policy produces neither.

`source` is `suspension-engine`, which distinguishes automation-produced evidence from an operator action. `reason` is operator-safe text; it never carries provider payloads, router output, or secrets.

### Idempotency

The block's identity is `(tenant_id, evidence_type, evidence_id)`, protected by the unique partial index `uq_customer_suspension_blocks_evidence`. Creation is therefore create-or-return in both persistence modes:

- Store (`USE_DB_SUSPENSION=false`): the in-memory store returns the existing block when the evidence matches.
- Supabase (`USE_DB_SUSPENSION=true`): the insert conflicts with `23505` and the existing row is read back.

Re-evaluating the same customer converges to the same order and the same block. It never creates a second one.

### Reconciliation After A Partial Failure

The order is written first, because the order *is* the evidence. If the block write then fails, the evaluation fails visibly and the suspension order stays open.

An open engine suspension order makes `decideServiceStatus` return `action: 'none'`, so without an explicit reconciliation path the retry could never repair the missing block. The engine therefore also ensures the block when it finds, for a `DELINQUENT` customer, an already-open engine suspension order. That converges idempotently:

```text
existing open suspension order + missing financial block
  -> next evaluation
  -> block created from the same order id
  -> no second order
```

This is convergence, not atomicity. Order and block are two writes and there is no transaction spanning them. The residual window is narrow but real: if the block write fails **and** the worker executes the suspension order before the next evaluation, the order leaves the open set and that customer keeps no structured evidence. Such a customer stays `unknown` and fail-closed, exactly like any other legacy case, and needs the manual path below.

### Legacy Suspended Customers

Customers suspended before this behavior existed — or suspended outside the engine — have no structured evidence. They stay `unknown` and fail closed. This is intentional:

- No backfill is executed. The engine never infers a financial cause from `status = 'suspended'` alone.
- The recovery path is manual review followed by authorized manual reactivation.
- A future repair could deterministically derive `financial` evidence from historical `source='engine'` suspension orders tied to delinquency. That is a **proposal only**; it requires separate authorization, a migration plan, preflight, and evidence, and it is not part of this change.

### Tenant Scope

Block, order, customer, and invoices all belong to the same tenant. Engine evaluations that produce effects resolve their tenant before doing anything else and fail closed when tenant isolation is active (multi-tenant enabled, hardened runtime, or suspension/customers/billing on the database). The historical single-WISP `tenant-default` fallback survives only in the fully hermetic local mode.

The `suspension-cycle` job has no HTTP request to inherit a tenant from. It requires an explicit `SUSPENSION_CYCLE_TENANT_ID` and fails closed otherwise; it must never evaluate every tenant as if they were one. A per-tenant authoritative enumeration for that job does not exist yet and remains open work.

### Clearing

Only the payment path clears financial blocks, through `clearFinancialSuspensionBlocksForDecision`, and only when the decision is `eligible`. It never clears `non_financial` or `unknown` blocks. Clearing is an update, not a delete: `cleared_at`, `cleared_by`, and `clear_reason` preserve the audit trail, and repeating it is a no-op.

The engine does not clear financial blocks when it emits a reactivation order. A stale active `financial` block does not block anything — `classifyActiveSuspension` only blocks on `non_financial` and `unknown` — whereas clearing it early would turn the customer's classification into `unknown` and could fail a later payment evaluation closed.

## Rollback Strategy

Rollback order:

1. Disable automation at policy level: set `autoReactivate=false` and/or `reactivateOnPayment=false`.
2. Keep `PAYMENTS_ROUTER_LIVE=false`, `MIKROTIK_WORKER_LIVE=false`, and `MIKROTIK_WORKER_COMMIT=false` unless a separately approved lab/live phase exists.
3. Let confirmed payments remain in Billing. Do not delete valid payments, applications, invoices, or provider events to undo network behavior.
4. Recover network state with worker retry, confirmed reconciliation, or authorized manual reactivation/suspension.
5. If code rollback is required, deploy a version that ignores additive active-block persistence only after automation is disabled.
6. Do not drop the additive `customer_suspension_blocks` table or related indexes while any deployed runtime may read or write them.

Migration rollback is conceptual only in this scope. Do not execute destructive migration rollback in staging or production without a separate approved plan, preflight, backups, and rollback evidence.

## Release Validation Checklist

Run these gates from a clean branch SHA before merge:

| Gate | Command | Expected Local Result | Notes |
| --- | --- | --- | --- |
| Lint | `npm run lint` | PASS with zero errors | Existing warnings may remain if the gate permits them. |
| Typecheck | `npm run typecheck` | PASS | `npm run lint` also invokes typecheck, but keep explicit evidence for release. |
| Unit/contract/e2e Vitest | `npm test` | PASS | Skips must be reported, not hidden. |
| Build | `npm run build` | PASS | Chunk-size warnings are not blockers by themselves. |
| Auth DB gate | `npm run test:auth` | PASS or explicitly skipped by missing live config | Use `NODE_OPTIONS=--use-system-ca` locally if the machine requires system CA trust. Do not commit that setting. |
| DB gate | `npm run test:db` | PASS | Requires configured live Supabase/test DB. |
| Billing DB gate | `npm run test:db:billing` | PASS | Requires configured live Supabase/test DB. |
| Security/static review | targeted tests under `tests/unit`, `tests/contract`, `tests/db` | PASS | Cover RLS, tenant isolation, RBAC, idempotency, fail-closed unknown, and Router gates. |
| Dependency audit | `npm audit --omit=dev` | PASS, 0 vulnerabilities | Production dependencies only. |
| Readiness | `npm run validate-production-readiness` | PASS exit or documented local/external blockers | Local relaxed readiness is not production strict evidence. |
| Restore | `npm run validate-restore-checklist` | PASS exit or `EXTERNAL_BLOCKED` evidence gap | Restore HMAC/live evidence remains external until proven. |

## External Evidence Requests

These items are intentionally `EXTERNAL_BLOCKED` until separately authorized and captured with sanitized evidence. Do not mark them PASS from mocks or local-only runs.

| Task | Status | Evidence Required |
| --- | --- | --- |
| T069 provider sandbox | `EXTERNAL_BLOCKED` | Signed approved webhook, duplicate retry behavior, failed/pending/malformed events, real sandbox payment confirmation, sanitized event/payment fingerprints. |
| T070 CHR/RouterOS lab | `EXTERNAL_BLOCKED` | Dry-run, controlled lab write, duplicate/retry behavior, cleanup verification, confirmation no production routers were touched. |
| T071 staging Supabase parity/drift | `EXTERNAL_BLOCKED` | Staging migration history and drift report for payment, billing, suspension, tenant, and idempotency persistence, with no production access. |
| T072 production strict readiness | `EXTERNAL_BLOCKED` | Strict readiness output from the real production configuration, separated from local/staging PASS claims. |
| T073 restore/readiness evidence | `EXTERNAL_BLOCKED` | Restore evidence for durable payment/reactivation artifacts, HMAC/key-file validation, and documented restore operator. |

## Scope Exclusions

Spec 001 does not add:

- per-service billing,
- a credit ledger or wallet,
- a refund subsystem,
- new RBAC roles,
- a new queue framework,
- a new payment provider,
- direct RouterOS writes from payment request paths,
- a large suspension taxonomy.

Any of those requires a new Spec Kit feature and separate design approval.
