# Billing & Collections Foundation — resultado de implementación

Fecha: 2026-06-23
Rama: `main` (trabajo directo sobre main, según protocolo del repo)

## Objetivo

Convertir NugaCore en la fuente real de facturación y cobranza del WISP, sin
tocar RouterOS Write, Worker Live, MikroTik Runtime, Inventory Sync, RouterOS
Read-Only, Router Enrollment ni NOC. Todo el motor MikroTik permanece intacto.

> **Decisión de arquitectura:** El dominio `billing` ya existía y estaba maduro
> (facturas, pagos, account-summary, revenue-report, persistencia dual store/DB
> detrás de `USE_DB_BILLING`). En lugar de reescribirlo se **extendió** de forma
> aditiva, respetando el DATA_CONTRACT (API v1 idéntica en modo mock y DB) y sin
> romper ningún test ni contrato existente.

## Mapeo de nomenclatura (spec → implementación)

La spec usa `customerId/customerName/dueDate/status MAYÚSCULAS`. NugaCore ya tiene
un contrato canónico (`src/types.ts` → `Invoice`) con `clientId/clientName/dueDateStr`
y estados en minúscula (`paid | unpaid | overdue | canceled`). Se conservó el
contrato canónico y los recursos NUEVOS (balance, pagos, ciclo) usan los nombres
de la spec donde no había contrato previo. Mapeo documentado en
[backend/domains/billing/types.ts](../backend/domains/billing/types.ts).

---

## 1. Archivos creados

- `backend/domains/billing/types.ts` — contratos de la Foundation: `AccountBalance`,
  `PaymentRecord`, `BillingPeriod`, tipos de ciclo (`BillingCycleResult`, etc.).
- `backend/domains/billing/cycle.ts` — `BillingCycleService` (simulación de
  facturación automática mensual/quincenal/semanal).
- `tests/contract/dashboard.billing.test.ts` — contrato de KPIs de cobranza.
- `tests/contract/rbac.billing.test.ts` — matriz RBAC de billing (read/write).
- `tests/contract/billing.secret-scan.test.ts` — secret scan (FASE I).
- `tests/unit/billing.ui.test.ts` — UI billing usa Bearer JWT + `canManageBilling`.
- `tests/unit/customer360.billing.test.ts` — Client 360 cobranza + acciones.
- `docs/BILLING_COLLECTIONS_FOUNDATION_RESULT.md` — este documento.

## 2. Archivos modificados

- `backend/domains/billing/repository.ts` — contrato `cancelInvoice`; `syncStatus`
  y `getAccountSummary` ahora tratan `canceled` como terminal (no recalculan ni
  inflan el pendiente); implementaciones store + Supabase.
- `backend/domains/billing/service.ts` — `cancelInvoice`, `getCustomerBalance`,
  `listPayments`, `createPayment` (con normalización de alias `paymentMethod`/`reference`).
- `backend/domains/billing/routes.ts` — endpoints nuevos (ver abajo).
- `backend/domains/dashboard/routes.ts` — `GET /api/dashboard/billing-kpis`.
- `src/components/Client360Panel.tsx` — sección "Cobranza" + acciones rápidas.
- `src/components/CrmModule.tsx` — carga del balance del cliente (Bearer) y wiring.
- `src/components/ClientActionsMenu.tsx` — acción `view-invoices`.
- `src/components/Dashboard.tsx` — sección "Cobranza Ejecutiva" (KPIs + Top 10).
- `tests/unit/billing.service.test.ts` — `FakeRepo.cancelInvoice` + tests nuevos.
- `tests/contract/billing.contract.test.ts` — contrato de endpoints nuevos.

## 3. Endpoints creados

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET  | `/api/billing/invoices/:id` | read | Factura enriquecida por id |
| POST | `/api/billing/invoices/:id/cancel` | write | Cancela factura (terminal) |
| GET  | `/api/billing/customers/:customerId/balance` | read | Estado de cuenta (saldo actual/vencido, último pago) |
| GET  | `/api/billing/payments` | read | Pagos como recurso (`?customerId=&invoiceId=`) |
| POST | `/api/billing/payments` | write | Registra pago como recurso |
| POST | `/api/billing/run-cycle` | write | Simulación de facturación automática |
| GET  | `/api/dashboard/billing-kpis` | read | KPIs ejecutivos de cobranza |

`read` = los 6 roles. `write` = super admin / administrador / cobranza.

> No se integró SAT, CFDI real, Stripe, MercadoPago, CoDi ni Dimo. Mock local.
> `run-cycle` es **simulación**: no usa cron real ni workers; `commit:true` solo
> escribe en modo mock (`USE_DB_BILLING=false`), nunca contra la DB.

## 4. UI creada (sin cambios de diseño/tema/branding/sidebar)

- **Client 360 → Cobranza:** saldo actual, saldo vencido, facturas pendientes,
  facturas vencidas, último pago y fecha. Acciones: Ver facturas, Registrar pago,
  Ver estado de cuenta. (No suspende ni reactiva desde cobranza.)
- **Dashboard → Cobranza Ejecutiva:** Facturación del mes, Cobrado del mes,
  Pendiente de cobro, Clientes con adeudo, Facturas vencidas, Top 10 adeudos.

## 5. FASE F (JWT) y FASE G (RBAC)

- Todo el flujo billing usa `Authorization: Bearer` vía el helper central
  `getAuthHeaders`/`fetchJson` (App) y `getAuthHeaders` en CRM/Dashboard. El
  módulo Payments ya no autoafirma `x-user-role`/`x-user-id` (hotfix previo).
- RBAC backend = fuente de verdad: `READ_ROLES` (6 roles) leen; `WRITE_ROLES`
  (super admin/administrador/cobranza) escriben. Espejo en UI con `canManageBilling`.
- Técnico/Soporte/Solo lectura tienen **lectura** de billing (endpoints + Client 360
  balance) sin botones de escritura. No se alteró el sidebar para respetar
  "NO cambios visuales globales".

## 6. Tests agregados (FASE H + I)

`billing.contract.test.ts` (31), `billing.service.test.ts` (extendido),
`billing.ui.test.ts`, `customer360.billing.test.ts`, `dashboard.billing.test.ts`,
`rbac.billing.test.ts`, `billing.secret-scan.test.ts`.

Cobertura: balances, invoices, payments, overdue, cancel, run-cycle, customer 360,
dashboard KPIs, auth JWT/RBAC y secret scan.

## 7. Resultados de verificación

- `npm run typecheck`: **PASS** (exit 0).
- `npm test` (hermético): **PASS** — 1554 passed, 49 skipped (opt-in db/auth).
- `npm run build`: ver sección de entrega.

### Validation gate (importante para Hermes)

> **Billing Foundation se valida con `npm run test:db:billing`.** Ese gate ejecuta
> únicamente las suites DB de Billing + sus dependencias (Customers, Plans) más la
> cobertura hermética de billing. **El gate global `npm run test:db` cubre otros
> dominios y puede fallar por pendientes NO relacionados** (p.ej.
> `router-enrollment.db.contract.test.ts` requiere `AUTH_TRUST_HEADERS`,
> `inventory.db.contract.test.ts` con errores propios). Esos fallos NO bloquean la
> aprobación de Billing: usar el gate enfocado.

Suites incluidas en `test:db:billing` (solo DB, diseñadas para Supabase real):

- `tests/contract/billing.schema.db.test.ts`
- `tests/contract/billing.db.contract.test.ts`
- `tests/contract/customers.db.contract.test.ts`
- `tests/contract/plans.db.contract.test.ts`

> La cobertura **hermética** de billing (contract, dashboard-kpis, rbac,
> secret-scan, unit) vive en `npm test`: esas suites asumen store-mode +
> `AUTH_TRUST_HEADERS=true` y NO deben correr bajo `RUN_DB_TESTS` (en staging
> `USE_DB_BILLING=true` no tiene el seed mock `fac-101`). Así se evita la misma
> contaminación cruzada que tumbó a router-enrollment.

NO incluye router-enrollment, inventory, routeros, mikrotik ni wireguard.

## 8. Reglas críticas respetadas

- No se tocó RouterOS Write, Worker Live, MikroTik Runtime, Inventory Sync,
  RouterOS Read-Only, Router Enrollment ni NOC.
- No se activó `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE`,
  `MIKROTIK_COMMIT_MODE` ni `MIKROTIK_WRITE_ENABLED`.
- No migraciones destructivas; no routers/CHR reales; no cambios visuales globales.

## 9. Qué debe validar Hermes (staging)

1. Health: `GET /api/health` y `/api/health/live` → 200 tras redeploy.
2. Billing read: `GET /api/billing/invoices`, `/payments`, `/customers/:id/balance`,
   `/account-summary`, `/revenue-report` → 200 con forma de contrato.
3. Billing write (rol cobranza): `POST /api/billing/payments`,
   `/invoices/:id/cancel`, `/run-cycle` → 200/201; roles de lectura → 403.
4. Dashboard: `GET /api/dashboard/billing-kpis` → 200; Top 10 adeudos coherente.
5. Con `USE_DB_BILLING=true` en staging: los mismos contratos contra Supabase
   (la cancelación persiste `canceled`/`cancel_reason`/`canceled_at`).
6. Secret scan: ninguna respuesta de billing expone material sensible.

## 10. Siguiente fase recomendada

Persistencia real de la Foundation: validar el dominio con `USE_DB_BILLING=true`
en staging (Hermes) y, una vez verde, planear la integración de un proveedor de
pago real (Stripe/MercadoPago) detrás de feature flag, manteniendo el motor
MikroTik intacto.
