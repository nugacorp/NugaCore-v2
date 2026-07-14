# Rate Limit / Polling Hotfix — Staging Result

Fecha UTC: 2026-06-22

## Resultado

✅ HOTFIX APROBADO en staging.

Se corrigió el spam de `429 Too Many Requests` observado en consola del navegador durante navegación rápida entre módulos WISP/NOC/MikroTik.

## Síntoma reportado

El bundle desplegado emitía múltiples `GET /api/* 429 Too Many Requests`, incluyendo:

- `/api/network-towers`
- `/api/onu`
- `/api/naps`
- `/api/mikrotik/logs`
- `/api/billing/revenue-report`
- `/api/billing/account-summary`
- `/api/alerts`
- `/api/notifications/settings`
- `/api/payments/orders`
- `/api/payments/actions`
- `/api/noc/*`
- `/api/inventory/*`
- `/api/routeros/*`

## Causa raíz

El shell principal (`src/App.tsx`) cargaba un dataset global amplio en cada navegación/poll para varias pestañas. En la práctica, cada cambio de módulo podía disparar alrededor de 15 endpoints base, además de los endpoints propios del módulo activo.

Al navegar rápidamente entre Dashboard, Clientes, Pagos, NOC, Inventario, Routers, Laboratorio MikroTik, etc., la SPA consumía la cuota del rate-limit normal de staging y generaba cascadas de `429`.

## Fix aplicado

Commit:

- `51613b4 fix(ui): scope app data polling by active tab`

Cambios:

- `src/App.tsx`: `fetchData` ahora carga solo los endpoints que necesita la vista activa.
- `tests/unit/rbac.frontend.test.ts`: se agregó regresión estática para evitar reintroducir el dataset global.

Ejemplos de reducción:

| Vista | Antes | Ahora |
| --- | --- | --- |
| Dashboard | dataset global amplio | `dashboard-stats`, `alerts` |
| Clientes | dataset global amplio | `clients`, `plans` |
| Facturación / Planes | dataset global amplio | `clients`, `billing/invoices`, `billing/account-summary`, `billing/revenue-report` |
| Red / GIS | dataset global amplio | `clients`, `network-towers`, `olt`, `onu`, `naps` |
| Inventario | dataset global amplio | `inventory` |
| MikroTik | dataset global amplio | `mikrotik/logs`, `mikrotik/routers`, `mikrotik/worker/runs` |

## Validación

Checks locales:

- `npm run test -- tests/unit/rbac.frontend.test.ts tests/unit/navigation.ui.test.ts tests/unit/dashboard.ui.test.ts tests/unit/api.backoff.test.ts`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm test`: PASS.
  - 93 test files passed.
  - 7 skipped.
  - 1359 tests passed.
  - 46 skipped.

Deploy staging:

- Contenedor healthy.
- Artefacto desplegado: `51613b4`.
- `/api/health`: 200.
- `/api/health/live`: 200.
- `/api/health/ready`: 200.
- Bundle activo observado en staging: `assets/index-qAbec4NZ.js`.

Validación browser:

- Login Super Admin OK.
- Navegación rápida por módulos críticos OK.
- Consola sin errores JavaScript críticos.
- Logs recientes post-deploy: `rate_limit_lines=0`.

## Guardrails

- No se avanzó a PROD-5.
- No se conectó CHR real.
- No se activó RouterOS real.
- No se activó Worker Live.
- No se tocaron routers reales.
- No se imprimieron secretos.

## Resultado final

✅ Spam 429 corregido en staging.
