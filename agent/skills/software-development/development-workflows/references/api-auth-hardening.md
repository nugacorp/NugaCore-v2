# API auth-hardening contract pattern

Use this reference when tightening API authorization around existing routes, especially staging/production JWT-only systems that still support trusted headers in local/dev tests.

## RED test shape

For each sensitive read endpoint, assert the full matrix before changing route middleware:

1. Anonymous request is rejected (`401`).
2. Spoofed trusted headers are rejected in production/staging mode (`401`), e.g. `x-user-role` / `x-user-id` must not bypass JWT auth.
3. Valid JWT for the least-privileged read role succeeds (`200`).
4. Health/login endpoints remain open if that is the contract.

Example intent:

```ts
const sensitiveReads = [
  '/api/dashboard-stats',
  '/api/clients',
  '/api/plans',
  '/api/billing/invoices',
  '/api/network-towers',
  '/api/olt',
  '/api/onu',
  '/api/tickets',
  '/api/workorders',
  '/api/inventory',
  '/api/alerts',
  '/api/mikrotik/logs',
  '/api/naps',
];

for (const path of sensitiveReads) {
  expect((await request(app).get(path)).status).toBe(401);
  expect((await request(app).get(path).set({ 'x-user-role': 'super admin', 'x-user-id': 'spoofed' })).status).toBe(401);

  const session = await signIn(readonlyUser.email);
  expect((await request(app).get(path).set('Authorization', `Bearer ${session.accessToken}`)).status).toBe(200);
}
```

## GREEN implementation shape

Centralize read roles rather than repeating arrays per route:

```ts
export const READ_ROLES = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'] as const;
```

Then add route middleware with the existing auth/RBAC primitive:

```ts
router.get('/api/clients', requireRoles(READ_ROLES), handler);
```

## Pitfalls

- Real auth-provider JWTs may expire during long contract suites. If a token unexpectedly starts returning `401`, re-sign close to the request under test rather than weakening the assertion.
- Preserve local/dev trusted-header fixtures only if they are an explicit development contract; production/staging tests should force JWT-only behavior.
- Include frontend API callers in the GREEN step. Once GET routes require JWT, dashboard widgets or secondary fetches must reuse the app's auth-header helper, or the UI will silently break after login.
- Do not document or print secret values while running staging auth tests; record only statuses and pass/fail outcomes.
