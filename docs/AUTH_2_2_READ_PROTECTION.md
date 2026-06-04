# Auth 2.2 — Protección de lecturas sensibles

Fecha: 2026-06-04
Entorno validado: staging / producción JWT-only

## Objetivo

Cerrar lecturas GET sensibles para que staging/producción no expongan datos operativos sin un JWT Supabase válido.

No se cambió diseño visual.
No se migraron Billing, MikroTik, Tickets ni Inventory.
No se cambió Coolify.

## Cambio aplicado

Se agregó `READ_ROLES` como conjunto explícito de roles que pueden leer datos operativos:

- super admin
- administrador
- cobranza
- tecnico
- soporte
- solo lectura

Las rutas sensibles ahora usan `requireRoles(READ_ROLES)`. En producción/staging esto exige `Authorization: Bearer <JWT válido>` porque los trusted headers se ignoran en modo producción.

## Rutas cubiertas en contrato staging

Las pruebas E2E reales validan que estas rutas:

1. rechazan lectura anónima con 401,
2. rechazan spoofing por `x-user-role`/`x-user-id` con 401,
3. aceptan JWT válido de `solo lectura` con 200.

Rutas verificadas:

- `/api/dashboard-stats`
- `/api/clients`
- `/api/plans`
- `/api/billing/invoices`
- `/api/network-towers`
- `/api/olt`
- `/api/onu`
- `/api/tickets`
- `/api/workorders`
- `/api/inventory`
- `/api/alerts`
- `/api/mikrotik/logs`
- `/api/naps`

También quedaron protegidas lecturas relacionadas de detalle/listado en Customers, Billing, Dashboard/Monitoring, Network, Inventory, Tickets/WorkOrders y Plans.

## Frontend

El flujo principal ya agregaba `Authorization` en las cargas de datos de `App.tsx`.

Se ajustaron las llamadas internas del Dashboard a:

- `/api/notifications/settings`
- `/api/notifications/trigger-simulation`

para reutilizar los headers de autenticación existentes sin cambiar el diseño visual.

## Validación ejecutada

Comando con secretos locales cargados sin imprimir valores:

```bash
SUPABASE_URL='https://elshnzkceutvjzxvzqad.supabase.co' \
SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
NODE_ENV=production \
npx vitest run tests/contract/auth.db.contract.test.ts
```

Resultado:

- PASS: 10 tests / 10 tests

Suite completa local:

```bash
npm run typecheck
npm test
npm run build
```

Resultado:

- `npm run typecheck`: PASS
- `npm test`: PASS, 34 passed / 12 skipped
- `npm run build`: PASS

## Notas de seguridad

- Health checks (`/api/health`, `/api/health/live`, `/api/health/ready`, `/api/auth/health`) siguen abiertos por diseño.
- En desarrollo sin Supabase, trusted headers siguen habilitados para no romper contratos locales y fixtures.
- En producción/staging, trusted headers no autentican: la identidad viene de Supabase JWT.
- No se imprimieron ni commitearon secretos.
