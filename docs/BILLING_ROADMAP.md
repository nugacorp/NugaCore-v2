# NugaCore — Roadmap de Billing (Fase 4)

> Fecha: 2026-06-04 · Estado: **planificación** — sin implementar.
> Relacionado: [BILLING_ARCHITECTURE.md](BILLING_ARCHITECTURE.md) · [BILLING_AUDIT.md](BILLING_AUDIT.md)

---

## Principio de ejecución

**Cada sub-fase es independiente y entregable.** El frontend y el contrato API v1 no se
rompen en ningún punto del camino. El flag `USE_DB_BILLING` (default `false`) protege
cada sub-fase: en `false` usa el store mock; en `true` usa la DB real.

---

## FASE 4.1 — Modelo financiero y migración de datos

**Objetivo:** crear el esquema DB y migrar los datos mock a la nueva estructura.

**Tareas:**
1. Nueva migración SQL: crear tablas `service_subscriptions`, `payments`,
   `payment_applications`, `credit_notes`, `credit_applications`, `adjustments`,
   `payment_receipts`.
2. `ALTER TABLE public.invoices`: añadir columnas `subscription_id`, `billing_period_start/end`,
   `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `applied_cents`,
   `credit_applied_cents`, `balance_cents` (columna calculada), `canceled_at`, `cancel_reason`,
   `idempotency_key`.
3. `ALTER TABLE public.clients`: añadir `credit_balance_cents`.
4. Script de migración de datos: convertir `invoice.payments[]` (array embebido) a filas
   en `payments` + `payment_applications`.
5. Convertir `invoice.amount` (pesos float) a `total_cents` (centavos entero).
6. Seed de `service_subscriptions` para los clientes mock existentes.
7. Índices críticos (ver BILLING_ARCHITECTURE §9).
8. Validar seeds con `RUN_DB_TESTS=true`.

**Entregables:**
- `supabase/migrations/20260604000000_billing_schema.sql`
- `supabase/migrations/20260604000001_billing_data_migration.sql`
- `docs/BILLING_4_1_RESULT.md`

**Riesgos:**
- La migración de `payments[]` embebido debe ser idempotente (si se corre dos veces no duplica).
- `balance_cents` como columna calculada requiere revisar compatibilidad antes de aplicar.

**Criterio de éxito:** `psql` + `SELECT * FROM public.payments LIMIT 5` devuelve las
5 transacciones de los datos mock correctamente migradas.

---

## FASE 4.2 — Persistencia CRUD con feature flag

**Objetivo:** crear `repository / service / mappers` para Billing, detrás de
`USE_DB_BILLING`. El contrato API v1 se mantiene byte por byte.

**Tareas:**
1. `backend/domains/billing/mappers.ts`:
   - `InvoiceRow`, `PaymentRow`, `PaymentApplicationRow` → tipos de DB.
   - `rowToInvoice()`, `invoiceToRow()`, `rowToPayment()`, `paymentToRow()`.
   - Conversión centavos ↔ pesos en los mappers (no en el service).
2. `backend/domains/billing/repository.ts`:
   - Interface `BillingRepository`.
   - `StoreBillingRepository` (mock, idéntico al comportamiento actual de routes.ts).
   - `SupabaseBillingRepository` (DB real).
3. `backend/domains/billing/service.ts`:
   - `BillingService` con validaciones (amount > 0, fecha válida, etc.).
   - `getBillingService()` factoría por flag.
4. Refactor `backend/domains/billing/routes.ts`:
   - Usar `getBillingService()` en lugar de `store.*` directamente.
   - `asyncHandler` en todos los handlers.
   - Mantener exactamente los mismos endpoints y payloads.
5. Tests:
   - `tests/unit/billing.mappers.test.ts`
   - `tests/unit/billing.service.test.ts`
   - `tests/contract/billing.contract.test.ts` (hermético)
   - `tests/contract/billing.db.contract.test.ts` (opt-in `RUN_DB_TESTS`)
6. `npm run typecheck && npm test && npm run build`.

**Entregables:**
- 3 archivos nuevos en `backend/domains/billing/`
- routes.ts refactorizado (no rompe nada en modo `false`)
- 4 archivos de test

**Criterio de éxito:** `npm test` pasa 100% hermético; `npm run test:db` pasa con
Supabase staging.

---

## FASE 4.3 — UI: gestión de facturas

**Objetivo:** conectar el `BillingModule.tsx` existente a la API real y añadir
funcionalidades faltantes en el frontend sin rediseñar desde cero.

**Tareas:**
1. Revisar qué operaciones usa `BillingModule.tsx` hoy:
   - Ver lista de facturas: `GET /api/billing/invoices` ✓ (ya funciona).
   - Pagar: `POST /api/billing/invoices/:id/pay` ✓.
   - Crear: `POST /api/billing/invoices` ✓.
   - Editar: `PUT /api/billing/invoices/:id` ✓.
2. Añadir al frontend:
   - Botón "Cancelar factura" (con confirmación) → `DELETE` o `POST .../cancel`.
   - Vista de historial de pagos de una factura (tabla de `payment_applications`).
   - Indicador de saldo a favor del cliente en la vista de cliente.
3. Conectar `FinanceOwnerModule.tsx` al reporte real:
   - Actualmente usa datos prop de `invoices[]`; migrar a `GET /api/billing/account-summary`.

**Criterio de éxito:** crear factura → pagar → ver saldo = $0 en la UI, sin recargar
manualmente.

---

## FASE 4.4 — Reportes financieros

**Objetivo:** implementar los 6 reportes diseñados en la arquitectura.

**Endpoints nuevos:**
- `GET /api/billing/reports/daily?from=&to=` — ingresos diarios.
- `GET /api/billing/reports/monthly?year=` — ingresos mensuales.
- `GET /api/billing/reports/receivables` — CxC por antigüedad (0-30, 31-60, 61-90, 90+).
- `GET /api/billing/reports/delinquent` — clientes vencidos/morosos.
- `GET /api/billing/reports/cashflow?weeks=4` — flujo de caja proyectado.
- `GET /api/billing/reports/collection-by-method?month=` — colección por método.

**UI:**
- Panel de reportes en `FinanceOwnerModule.tsx` con gráficas (recharts o Chart.js).
- Exportación CSV/XLSX (reusa la lógica de `reports/routes.ts`).

**Criterio de éxito:** reporte de CxC muestra $0 para clientes sin morosidad y el
monto correcto para los clientes de staging.

---

## FASE 4.5 — Suspensiones automatizadas

**Objetivo:** convertir `POST /api/suspension/run` en un job periódico real y
desacoplar la reactivación del billing service.

**Tareas:**
1. `pg_cron` en Supabase: job diario a las 6 AM que ejecute la lógica de
   `hasOverdueBalanceBeyondGrace` y mute `clients.status`.
   - Alternativa: cron job en el VPS (Coolify scheduled job) que llame al endpoint.
2. Separar la reactivación automática de `billing/routes.ts`:
   - Extraer a `suspension/service.ts` (método `checkAndReactivateIfClear`).
   - Billing service llama al suspension service después de aplicar un pago exitoso.
3. Agregar `RBAC` a `GET /api/suspension/policy` y `GET /api/suspension/logs` (gap actual).
4. Tabla `suspension_policy` en DB (ya existe en el esquema; migrar singleton default).
5. Tests de la lógica de regla automática.

**Criterio de éxito:** cliente con factura vencida + graceDays superados aparece como
`suspended` sin intervención manual el día siguiente.

---

## FASE 4.6 — Integración MikroTik (solo señal)

**Objetivo:** cuando ocurra una suspensión o reactivación real, enviar la señal al
router MikroTik correspondiente (PPPoE disable/enable).

> Esta fase **no** diseña la integración MikroTik completa (eso es Fase 5). Solo
> añade el hook de billing→mikrotik.

**Tareas:**
1. Al suspender: `POST /api/mikrotik/:routerId/pppoe/disable` (usuario del cliente).
2. Al reactivar: `POST /api/mikrotik/:routerId/pppoe/enable`.
3. Manejo de fallos: la suspensión en DB es exitosa aunque MikroTik falle (log de error).
4. Audit trail: `MikrotikCommandAudit` para cada señal enviada.

**Criterio de éxito:** suspender cliente → el PPPoE se deshabilita en el router real
de staging (si MikroTik está configurado); si no está configurado, el error es logeado
y la operación de billing no falla.

---

## FASE 4.7 — Portal de cliente (self-service)

**Objetivo:** vista read-only para que el cliente final vea sus facturas y saldo.

**Tareas:**
1. Ruta pública autenticada: `GET /api/portal/invoices` (filtrada por `authContext.clientId`).
2. Vista React mínima: facturas + estado + botón "Pagar" (redirige a pasarela).
3. Sin edición: el cliente solo lee; el pago lo redirige a la pasarela (Fase 4.8).

---

## FASE 4.8 — Pagos en línea

**Objetivo:** integración con pasarela de pago (Stripe o MercadoPago) para autopago.

**Tareas:**
1. `POST /api/billing/checkout/session` — crea sesión de pago en Stripe.
2. Webhook de Stripe → `POST /api/billing/webhooks/stripe` — confirma pago y registra
   `payment` + `payment_application`.
3. Idempotencia por `idempotency_key` (Stripe event ID).
4. Notificación al cliente (email/WhatsApp) al recibir pago.

---

## FASE 4.9 — CFDI (Facturación electrónica SAT)

**Objetivo:** emitir CFDI real a través de un PAC (Proveedor Autorizado de
Certificación del SAT, p.ej. Finkok, SW Sapien, Diverza).

**Tareas:**
1. Integración con PAC: `POST /api/billing/invoices/:id/timbrar`.
2. Almacenar `cfdi_xml_url` y `cfdi_uuid` real.
3. Cancelación de CFDI: proceso de cancelación SAT con motivo y UUID.
4. Complemento de pago (CFDI de pago) al registrar cada pago.
5. Retención de XMLs (obligación fiscal: 5 años).

---

## Resumen del roadmap

| Sub-fase | Descripción | Prioridad | Dependencia |
|----------|-------------|:---------:|-------------|
| **4.1** | Modelo financiero + migración DB | 🔴 Alta | Plans migrado ✓ |
| **4.2** | Persistencia CRUD con feature flag | 🔴 Alta | 4.1 |
| **4.3** | UI: gestión de facturas | 🟠 Media | 4.2 |
| **4.4** | Reportes financieros | 🟠 Media | 4.2 |
| **4.5** | Suspensiones automatizadas | 🟠 Media | 4.2 |
| **4.6** | Integración MikroTik (señal) | 🟡 Normal | 4.5 |
| **4.7** | Portal de cliente | 🟡 Normal | 4.2, Auth |
| **4.8** | Pagos en línea (Stripe/MP) | 🟢 Baja | 4.7 |
| **4.9** | CFDI / Facturación electrónica | 🟢 Baja | 4.2, PAC |

**Orden de ejecución recomendado para Hermes:**
```
4.1 → 4.2 → 4.5 → 4.4 → 4.3 → 4.6 → 4.7 → 4.8 → 4.9
```

Las fases 4.1 y 4.2 son el **camino crítico** — todo lo demás depende de tener
la persistencia real funcionando.

---

## Recomendación para Fase 4.1 (primer paso)

**Empezar por la migración del esquema**, no por el código:

1. Escribir y revisar `billing_schema.sql` con el usuario antes de aplicar.
2. Validar el esquema en una DB de desarrollo limpia (sin datos de staging).
3. Una vez aprobado el esquema, aplicarlo en staging con migración de datos.
4. Solo después implementar los mappers y el repository (Fase 4.2).

El riesgo más alto es la conversión `amount (float pesos)` → `total_cents (int centavos)`
y la migración de `payments[]` embebido a tabla independiente. Ambos se resuelven en
un script SQL idempotente antes de tocar cualquier línea de TypeScript.

**No avanzar a Fase 4.2 sin que el esquema esté aprobado y aplicado en staging.**
