# NugaCore — Roadmap de Billing (Fase 4)

> Última actualización: 2026-06-12 · Estado: **Fases 4.1–4.7 completadas. Fase 4.8 planificada.**
> Relacionado: [BILLING_ARCHITECTURE.md](../billing/BILLING_ARCHITECTURE.md) · [BILLING_AUDIT.md](../audits/BILLING_AUDIT.md)

---

## Principio de ejecución

**Cada sub-fase es independiente y entregable.** El frontend y el contrato API v1 no se
rompen en ningún punto del camino. El flag `USE_DB_<DOMINIO>` (default `false`) protege
cada sub-fase: en `false` usa el store mock; en `true` usa la DB real.

---

## Estado de fases completadas

| Sub-fase | Descripción | Estado | Aprobación |
|----------|-------------|--------|------------|
| **4.1** | Modelo financiero + migración DB | ✅ Completado | `BILLING_4_1_RESULT.md` |
| **4.2** | Persistencia CRUD con feature flag | ✅ Completado | `BILLING_4_2_RESULT.md` |
| **4.3** | UI: gestión de facturas | ✅ Completado | `BILLING_4_3_FINAL_APPROVAL.md` |
| **4.4** | Reportes financieros | ✅ Completado | — |
| **4.5** | Suspension Engine + Motor de corte | ✅ Completado | `SUSPENSION_ENGINE_4_5_2_FINAL_APPROVAL.md` |
| **4.6** | MikroTik Provisioning + WireGuard Manager + RouterOS Templates | ✅ Completado | `WIREGUARD_MANAGER_STAGING_RESULT.md` |
| **4.7** | WireGuard Auto Enrollment | ✅ Completado | `WIREGUARD_AUTO_ENROLLMENT_REVIEW_FIXES.md` |
| **4.8** | Payment Engine + Reactivación Automática | 🔲 Planificado | — |

---

## FASE 4.1 — Modelo financiero y migración de datos ✅

**Objetivo:** crear el esquema DB y migrar los datos mock a la nueva estructura.

**Entregables completados:**
- `supabase/migrations/20260604000000_billing_schema.sql`
- `supabase/migrations/20260604000001_billing_data_migration.sql`
- Tablas: `service_subscriptions`, `payments`, `payment_applications`, `credit_notes`, `payment_receipts`

---

## FASE 4.2 — Persistencia CRUD con feature flag ✅

**Objetivo:** crear `repository / service / mappers` para Billing, detrás de `USE_DB_BILLING`.

**Entregables completados:**
- `backend/domains/billing/mappers.ts`
- `backend/domains/billing/repository.ts` (Store + Supabase)
- `backend/domains/billing/service.ts`
- Tests hermético + opt-in DB

---

## FASE 4.3 — UI: gestión de facturas ✅

**Objetivo:** conectar BillingModule.tsx a la API real, añadir cancelación y saldo.

**Entregables completados:**
- Pago parcial/total, historial de pagos, indicador saldo a favor
- FinanceOwnerModule conectado a `GET /api/billing/account-summary`

---

## FASE 4.4 — Reportes financieros ✅

**Objetivo:** implementar los 6 reportes financieros operativos.

**Endpoints entregados:**
- `GET /api/billing/reports/daily`
- `GET /api/billing/reports/monthly`
- `GET /api/billing/reports/receivables`
- `GET /api/billing/reports/delinquent`
- `GET /api/billing/reports/cashflow`
- `GET /api/billing/reports/collection-by-method`

---

## FASE 4.5 — Suspension Engine ✅

**Objetivo:** motor de suspensión y reactivación con reglas configurables.

**Entregables completados:**
- Suspension Engine con Motor de Órdenes
- `SuspensionOrder` → `processPendingOrders()` (dry-run)
- MikroTik Worker (Fase 4.5.2): integración read-only confirmada
- Tests: `SUSPENSION_ENGINE_4_5_1`, `SUSPENSION_ENGINE_4_5_2`

---

## FASE 4.6 — MikroTik Provisioning + WireGuard Manager + RouterOS Templates ✅

**Objetivo:** stack completo de conectividad remota y automatización de routers.

**Entregables completados:**
- MikroTik Provisioning: credenciales cifradas AES-256-GCM, health check
- WireGuard Manager: IPAM, keypairs, rotación de claves, cifrado
- RouterOS Templates Library: 13 plantillas en 8 categorías

---

## FASE 4.7 — WireGuard Auto Enrollment ✅

**Objetivo:** flujo de enrollment automatizado: router → peer WG → script → confirmación online.

**Entregables completados:**
- Dominio `backend/domains/router-enrollment/`
- 6 endpoints REST con RBAC
- UI Wizard 7 pasos (`RouterEnrollmentWizard.tsx`)
- 57 tests (unit + contrato)
- Hotfix pre-Hermes: rollback router huérfano + routerosVersion persistida
- Commit: `b683867` (main)

---

## FASE 4.8 — Payment Engine + Reactivación Automática 🔲

> **Estado: PLANIFICADA — No iniciada. No implementada. No validada.**
> Detalle completo: [PAYMENT_ENGINE_PHASE_PLAN.md](./PAYMENT_ENGINE_PHASE_PLAN.md)

### Objetivo

Permitir que un cliente final consulte facturas, pague desde el portal, reactive su servicio
automáticamente y deje auditoría completa — sin intervención manual del operador.

### Subfases

| Sub-fase | Descripción | Prioridad |
|----------|-------------|:---------:|
| **4.8.1** | Payment Database (tablas + migraciones) | 🔴 Alta |
| **4.8.2** | Payment Providers (abstracción + adaptadores) | 🔴 Alta |
| **4.8.3** | Webhooks (endpoints + validación de firma) | 🔴 Alta |
| **4.8.4** | Billing Integration (conciliación pago → factura → suscripción) | 🟠 Media |
| **4.8.5** | Reactivación MikroTik (idempotente + auditoría) | 🟠 Media |
| **4.8.6** | Portal Cliente (self-service UI) | 🟡 Normal |
| **4.8.7** | Seguridad y Auditoría (audit_logs, RBAC, idempotencia) | 🔴 Alta |

### Dependencias previas obligatorias

- Fase 4.1 ✅ — esquema billing (payments, invoices, subscriptions)
- Fase 4.2 ✅ — repositorio billing con feature flag
- Fase 4.5 ✅ — Suspension Engine (para generar órdenes de reactivación)
- Fase 4.7 ✅ — WireGuard Auto Enrollment (routers enrolados para actuar sobre ellos)

### Nuevas tablas previstas

```
payment_orders      — órdenes de pago iniciadas desde el portal
payment_events      — eventos webhook recibidos (raw + procesados)
mikrotik_actions    — log de acciones ejecutadas sobre routers tras reactivación
```

### Proveedores de pago previstos

- `manual` — confirmación manual por operador
- `mercado_pago` — API + webhooks MercadoPago
- `openpay` — API + webhooks OpenPay
- `spei_provider_future` — transferencias SPEI (fase futura)

### Flujo de reactivación

```
Webhook recibido
  └→ Validación de firma del proveedor
    └→ Registro en payment_events
      └→ Actualización payment.status = confirmed
        └→ invoice.status = paid
          └→ subscription.status = active
            └→ customer.status = active
              └→ Orden de reactivación MikroTik
                └→ Audit log completo
```

---

## FASE 4.9 — CFDI (Facturación electrónica SAT) 🔲

**Objetivo:** emitir CFDI real a través de un PAC (Finkok, SW Sapien, Diverza).

**Dependencia:** Fase 4.8 completada y validada.

---

## Resumen del roadmap actualizado

| Sub-fase | Descripción | Prioridad | Estado | Dependencia |
|----------|-------------|:---------:|--------|-------------|
| **4.1** | Modelo financiero + migración DB | 🔴 | ✅ | Plans ✓ |
| **4.2** | Persistencia CRUD con feature flag | 🔴 | ✅ | 4.1 |
| **4.3** | UI: gestión de facturas | 🟠 | ✅ | 4.2 |
| **4.4** | Reportes financieros | 🟠 | ✅ | 4.2 |
| **4.5** | Suspension Engine | 🟠 | ✅ | 4.2 |
| **4.6** | MikroTik + WireGuard + Templates | 🟡 | ✅ | 4.5 |
| **4.7** | WireGuard Auto Enrollment | 🟡 | ✅ | 4.6 |
| **4.8** | Payment Engine + Reactivación Auto | 🔴 | 🔲 Futuro | 4.1, 4.2, 4.5, 4.7 |
| **4.9** | CFDI / Facturación electrónica | 🟢 | 🔲 Futuro | 4.8 |

**Orden de ejecución recomendado para continuar:**
```
4.8.1 → 4.8.2 → 4.8.3 → 4.8.7 → 4.8.4 → 4.8.5 → 4.8.6 → 4.9
```

La subfase 4.8.7 (seguridad y auditoría) debe diseñarse en paralelo a 4.8.1 para que
el esquema de tablas incluya `audit_logs` y `payment_events` desde el inicio.
