# NugaCore - Frontend Polling / Rate Limit Audit

Fecha: 2026-06-19
Scope: frontend polling and repeated fetch patterns in App and Dashboard.

## 1. Objective

Identify where frontend traffic can trigger HTTP 429 in staging, then define mitigation without disabling backend rate limits.

## 2. Findings

| Component | Endpoint(s) | Trigger | Frequency / concurrency | Hidden tab behavior | Cleanup on unmount | 429 handling (before) | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| src/App.tsx (global fetchData) | /api/dashboard-stats, /api/clients, /api/plans, /api/billing/invoices, /api/network-towers, /api/olt, /api/onu, /api/tickets, /api/workorders, /api/inventory, /api/alerts, /api/mikrotik/logs, /api/naps, /api/billing/account-summary, /api/billing/revenue-report | Mount + interval polling + manual refresh | Previous behavior loaded full dataset every 60s with Promise.all | Previous behavior did not guard hidden tabs | Interval cleanup existed, visibility listener cleanup was incomplete | No endpoint cooldown, no Retry-After parsing, retries could amplify pressure | High |
| src/App.tsx (tab-specific loads) | /api/mikrotik/routers, /api/mikrotik/worker/runs, /api/suspension/*, /api/wireguard/* | Follow-up loads after global fetchData | Triggered during fetch cycles even when module was not active (legacy risk) | No explicit hidden-tab skip in legacy flow | N/A (function-level calls) | No rate-limit aware cooldown | Medium |
| src/components/Dashboard.tsx (notification settings) | GET /api/notifications/settings, POST /api/notifications/settings | Dashboard mount and save actions | Not a fixed interval, but repeated mounts/retries can still stack | N/A | React effect cleanup standard | Direct fetch without central 429 hygiene | Medium |

## 3. Root Cause Summary

1. High fan-out polling in App: one interval triggered many endpoints concurrently.
2. Polling cadence (60s) plus strict mode / re-renders increased request pressure in staging.
3. No shared endpoint cooldown and no Retry-After compliance made retry behavior noisy.
4. Hidden-tab requests were not sufficiently suppressed.

## 4. Mitigation Implemented

1. Added shared helper in src/lib/apiBackoff.ts:
   - parse Retry-After header.
   - exponential backoff with min/max guardrails.
   - per-endpoint cooldown map.
   - typed ApiRateLimitError with retryAfterMs and fromCooldown.
2. Updated src/App.tsx:
   - fetchJson now uses fetchWithRateLimitBackoff.
   - polling interval increased to 120s.
   - polling blocked when document is hidden.
   - visibilitychange listener now added and removed correctly.
   - rateLimitUntilMs blocks fetch loops during cooldown windows.
   - rateLimitNotice surfaced as soft UI message.
   - core dataset fetched only for relevant tabs; non-core tabs avoid full fan-out.
   - tab-specific module loads executed only for the active tab.
3. Updated src/components/Dashboard.tsx:
   - notifications settings GET/POST now use fetchWithRateLimitBackoff.
   - soft message when endpoint is rate-limited.

## 5. Current State After Audit

- Frontend no longer depends on backend rate-limit disablement as first response.
- Polling now applies hygiene controls: visibility guard, cooldown guard, lower cadence, scoped endpoint loading.
- Centralized 429 behavior is covered by dedicated unit tests.

## 6. Remaining Risk

- Load spikes can still occur under heavy multi-user activity; backend limits must remain enabled and monitored.
- If future modules add polling, they must reuse src/lib/apiBackoff.ts and document cadence explicitly.
