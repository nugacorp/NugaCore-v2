# NugaCore - Frontend Polling / Rate Limit Hygiene Result

Fecha: 2026-06-19
Estado: Local validation PASS. Pending staging observation.

## 1. Delivered

### Code changes

1. New helper: src/lib/apiBackoff.ts
   - Added per-endpoint cooldown and Retry-After parsing.
   - Added ApiRateLimitError + isApiRateLimitError.
   - Added fetchWithRateLimitBackoff wrapper for fetch.

2. Frontend orchestrator: src/App.tsx
   - Integrated fetchWithRateLimitBackoff in fetchJson.
   - Added rateLimitNotice + rateLimitUntilMs state.
   - Added visibility guard and cooldown guard before polling/fetch.
   - Increased interval from 60s to 120s.
   - Added visibilitychange listener with proper removeEventListener cleanup.
   - Scoped heavy dataset polling to core tabs.
   - Limited tab-specific loads (MikroTik/Suspension/WireGuard) to active tab.
   - Added soft rate-limit notice banner in main layout.

3. Dashboard notifications settings: src/components/Dashboard.tsx
   - Switched GET/POST /api/notifications/settings to fetchWithRateLimitBackoff.
   - Added settingsRateLimited UI message to avoid noisy failure loops.

### Tests

1. New test file: tests/unit/api.backoff.test.ts
   - Retry-After seconds parsing.
   - Retry-After HTTP-date parsing.
   - 429 cooldown recording.
   - cooldown short-circuit without extra network call.
   - cooldown clear after success.

2. Updated test file: tests/unit/rbac.frontend.test.ts
   - Relaxed brittle dependency-array assertion.
   - Added source-scan checks for visibility guard, listener cleanup, and 429 cooldown guard.

## 2. Validation Executed

Commands run:

- npm run typecheck
- npm test
- npm run build

Results:

- typecheck: PASS
- tests: PASS (63 files passed, 7 skipped; 1086 tests passed, 46 skipped)
- build: PASS

## 3. Safety / Scope Notes

- Backend rate-limit policy was not disabled.
- No runtime flags were changed to unsafe values.
- No live router operation was introduced.

## 4. Follow-up in Staging

1. Observe 429 frequency and Retry-After behavior in browser/network logs.
2. Confirm no polling while tab is hidden.
3. Confirm polling resumes after cooldown and visibility restore.
4. Confirm dashboard notification settings remain functional under moderate load.
