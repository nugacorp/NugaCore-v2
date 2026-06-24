# NugaCore — Data Consistency Audit (Pre-PROD-7)

> Auditoría de consistencia de datos previa a PROD-7 (Suspension & Reactivation
> Engine). **Sin** funcionalidades nuevas, **sin** RouterOS/MikroTik Runtime,
> **sin** Worker Live, **sin** Billing Runtime, **sin** tocar UI/branding/navegación.
> Objetivo exclusivo: detectar y corregir inconsistencias de **origen de datos**.

---

## FASE A — Inventario de KPIs

Cada KPI ejecutivo, dónde se muestra, qué módulo lo posee y desde qué endpoint
se sirve hoy. La columna **Fuente Real** indica el dato crudo de origen.

| KPI | Dashboard (consumidor) | Módulo Fuente | Endpoint Fuente | Fuente Real |
| --- | --- | --- | --- | --- |
| Clientes Activos | `/api/dashboard-stats`.activeClients | CRM | `/api/clients?status=active` | `CustomersService.list()` → store.CLIENTS |
| Suspendidos | `/api/dashboard-stats`.suspendedClients | CRM | `/api/clients?status=suspended` | `CustomersService.list()` → store.CLIENTS |
| Leads | `/api/dashboard-stats`.leadsCount | CRM | `/api/clients?status=lead` | `CustomersService.list()` → store.CLIENTS |
| Tickets Abiertos | `/api/dashboard-stats`.activeTickets | Support | `/api/tickets` | store.TICKETS (status ≠ resolved/closed) |
| MRR | `/api/dashboard-stats`.mrr | Billing/Revenue | `/api/dashboard-stats` | suscripciones active+suspended × `store.PLANS[].price` |
| Facturación Mes | `/api/dashboard-stats`.facturacionMes | Billing | `/api/dashboard/billing-kpis` | `BillingService.listInvoices()` (mes en curso) |
| Cobrado Mes | `/api/dashboard-stats`.cobranzaMes | Billing | `/api/dashboard/billing-kpis` | `BillingService.listInvoices()` (mes en curso, `paidAmount`) |
| Pendiente Cobro | `/api/dashboard/billing-kpis`.pendienteCobro | Billing | `/api/dashboard/billing-kpis` | `BillingService.listInvoices()` (`pendingAmount`) |
| Facturas Vencidas | `/api/dashboard/billing-kpis`.facturasVencidas | Billing | `/api/dashboard/billing-kpis` | facturas con status `overdue` |
| Clientes con Adeudo | `/api/dashboard/billing-kpis`.clientesConAdeudo | Billing | `/api/dashboard/billing-kpis` | clientes distintos con `pendingAmount > 0` |
| Clientes por Torre | `/api/dashboard-stats`.wispOperations.clientsByTower | IPAM | `/api/ipam/routers/:id/capacity` | `IpamService.capacity()` |
| Capacidad Utilizada | `/api/dashboard-stats`.wispOperations.capacityUtilizationPercent | IPAM | `/api/ipam/routers/:id/capacity` | `IpamService.capacity()` |
| Equipos Reservados | `/api/dashboard-stats`.wispOperations.reservedEquipment | Inventory | (interno) | `CustomerEquipmentService.countReservations()` |
| Instalaciones Pendientes | `/api/dashboard-stats`.wispOperations.pendingInstallations | Tickets + Inventory | `/api/workorders` | WORK_ORDERS (installation abiertas) + reservas |
| Torres Online | `/api/dashboard-stats`.towers.online | Network | `/api/network-towers` | store.TOWERS (status `online`) |
| SLA Red | `/api/dashboard-stats`.executive.towerAvailabilityPct | Network | `/api/dashboard-stats` | disponibilidad de torres (online + warning×0.5) |

---

## FASE B — Single Source of Truth (fuente oficial por KPI)

Regla: **cada KPI tiene una sola fuente oficial**; el resto de módulos la
**consumen**, nunca la recalculan. Implementado en
[`backend/domains/system/metrics.ts`](../backend/domains/system/metrics.ts)
(`systemMetrics`), consumido por el Dashboard, el panel de Cobranza y el auditor.

| KPI | Fuente Oficial | Consumidores | Regla |
| --- | --- | --- | --- |
| Clientes Activos / Leads | **CRM** (`CustomersService`) | Dashboard, Client 360 | Billing NO recalcula clientes |
| **Suspendidos** | **Service Status** (`serviceStatus === SUSPENDED`) | Dashboard, Client 360 | CRM `status` ya NO es la fuente del KPI — ver [SERVICE_STATUS_SSOT_RESULT.md](./SERVICE_STATUS_SSOT_RESULT.md) |
| MRR | **Billing/Revenue** (`systemMetrics.mrr`) | Dashboard, Client 360 | CRM NO recalcula MRR |
| Facturación / Cobrado / Pendiente / Vencidas / Adeudo | **Billing** (`BillingService`) | Dashboard, Cobranza | Dashboard NO recalcula cobranza |
| Tickets | **Support** (store.TICKETS) | Dashboard, NOC | NOC deriva alertas, no el conteo oficial |
| Capacidad / Clientes por torre | **IPAM** (`IpamService`) | Dashboard, Router Enrollment | El dashboard consume IPAM |
| Torres / SLA Red | **Network** (store.TOWERS) | Dashboard, NOC | — |
| Equipos reservados / Instalaciones | **Inventory + Tickets** | Dashboard | — |

### Principio de implementación

- `systemMetrics` calcula **cada KPI una sola vez** leyendo la fuente oficial.
- `/api/dashboard-stats` y `/api/dashboard/billing-kpis` **consumen** `systemMetrics`;
  ya no hay fórmulas duplicadas ni divergentes entre ambos.
- El auditor [`/api/system/data-consistency`](../backend/domains/system/consistency.ts)
  recalcula cada KPI de forma **independiente** desde la fuente cruda y lo compara
  contra lo que cada endpoint publica. Si divergen → `healthy:false` + detalle.

---

## FASE C — Auditoría automática

`GET /api/system/data-consistency` (read-only, RBAC de lectura).

```jsonc
{
  "healthy": true,
  "checkedAt": "2026-06-24T20:37:26.838Z",
  "modules": ["CRM", "Billing", "Support", "Network", "IPAM", "Inventory"],
  "checks": [
    { "metric": "activeCustomers", "source": "CRM", "official": 3,
      "consumers": { "dashboard": 3 }, "consistent": true }
    // …
  ],
  "mismatches": []
}
```

Cuando exista una divergencia:

```jsonc
{
  "healthy": false,
  "mismatches": [
    { "metric": "activeCustomers", "source": "CRM", "official": 124,
      "diverging": { "dashboard": 126 } }
  ]
}
```

KPIs auditados automáticamente: `activeCustomers`, `suspendedCustomers`, `leads`,
`mrr`, `facturacionMes`, `cobradoMes`, `pendienteCobro`, `facturasVencidas`,
`openTickets`, `towersOnline`.

---

## FASE D — Tests

- [`tests/unit/data-consistency.service.test.ts`](../tests/unit/data-consistency.service.test.ts)
  — SSOT vs recálculo directo; comparador del auditor; `healthy:true` con semilla.
- [`tests/contract/data-consistency.contract.test.ts`](../tests/contract/data-consistency.contract.test.ts)
  — endpoint `healthy:true`; concordancia dashboard↔billing-kpis; activos↔CRM; MRR↔resumen.

---

## Inconsistencias detectadas (origen)

| # | Inconsistencia | Causa raíz | Estado |
| - | --- | --- | --- |
| 1 | **Cobrado del mes ≠ Cobranza acumulada** | `/api/dashboard-stats`.cobranzaMes sumaba **todas** las facturas pagadas (histórico), mientras `/api/dashboard/billing-kpis`.cobradoMes filtraba por mes | ✅ Corregido — ambos = Billing (mes en curso) |
| 2 | **Facturación Mes = histórico total** | `/api/dashboard-stats`.facturacionMes sumaba `store.INVOICES` completo | ✅ Corregido — Billing (mes en curso) |
| 3 | **MRR recalculado en el dashboard** | MRR se computaba inline en la ruta del dashboard, no en la capa oficial | ✅ Corregido — `systemMetrics.mrr` (única fórmula) |
| 4 | **Conteos de clientes/tickets/torres duplicados** | `buildExecutiveKpis` y el handler recomputaban los mismos conteos por separado | ✅ Corregido — un solo snapshot SSOT |
| 5 | Clientes Activos vs Clientes por Torre | Conceptos distintos (CRM vs capacidad IPAM con baseline). No es bug, se documenta como métricas diferentes | ℹ️ Documentado |

> **Observación (no bloqueante):** `backend/domains/reports/routes.ts` recalcula
> `paidAmount`/`pendingAmount` inline para sus exportaciones. Son vistas por-factura
> (no KPIs agregados) y conservan el contrato de export; se deja como deuda menor
> a migrar a `BillingService.listInvoices()` en una iteración futura.
