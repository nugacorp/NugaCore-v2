# NugaCore — Data Consistency Audit · RESULTADO (Pre-PROD-7)

Resultado de la auditoría y normalización de consistencia de datos previa a
PROD-7. Ver el detalle de fases en
[`DATA_CONSISTENCY_AUDIT.md`](./DATA_CONSISTENCY_AUDIT.md).

**Estado: ✅ COMPLETADO** — `healthy: true`, sin desajustes.
No se implementó PROD-7, ni suspensión/reactivación automática, ni RouterOS
Write, ni Worker Live, ni MikroTik Runtime, ni Billing Runtime. No se modificó
UI, navegación ni branding.

---

## 1. KPIs auditados y su fuente oficial

| KPI | Fuente Oficial | Valor (data semilla) | Consistente |
| --- | --- | --- | --- |
| Clientes Activos | CRM (`CustomersService`) | 4 | ✅ |
| Suspendidos | CRM | 1 | ✅ |
| Leads | CRM | 2 | ✅ |
| MRR | Billing/Revenue (`systemMetrics.mrr`) | 15 695 | ✅ |
| Facturación Mes | Billing (mes en curso) | 0 | ✅ |
| Cobrado Mes | Billing (mes en curso) | 0 | ✅ |
| Pendiente Cobro | Billing | 748 | ✅ |
| Facturas Vencidas | Billing | 2 | ✅ |
| Clientes con Adeudo | Billing | — | ✅ |
| Tickets Abiertos | Support (store.TICKETS) | 2 | ✅ |
| Torres Online | Network (store.TOWERS) | 2 | ✅ |
| Clientes por Torre / Capacidad | IPAM (`IpamService`) | — | ✅ |
| Equipos Reservados / Instalaciones | Inventory + Tickets | — | ✅ |

> Nota: con la data semilla las facturas son de **mayo/2026** y la fecha actual
> es **junio/2026**, por lo que "del mes" = 0. Esto es **correcto**: el KPI dice
> "del mes" y ahora coincide en todos los endpoints (antes el dashboard mostraba
> el histórico acumulado).

---

## 2. Inconsistencias encontradas y corregidas

| # | Inconsistencia | Antes | Después |
| - | --- | --- | --- |
| 1 | Cobrado del mes ≠ Cobranza acumulada | `dashboard-stats.cobranzaMes` = Σ todas las facturas pagadas (histórico) | = Billing del mes en curso (igual a `billing-kpis.cobradoMes`) |
| 2 | Facturación Mes = histórico total | `dashboard-stats.facturacionMes` = Σ `store.INVOICES` | = Billing del mes en curso |
| 3 | MRR recalculado en el dashboard | fórmula inline en la ruta | `systemMetrics.mrr` (única definición) |
| 4 | Conteos duplicados (clientes/tickets/torres) | `buildExecutiveKpis` + handler recomputaban por separado | un solo snapshot SSOT (`getMetricsSnapshot`) |
| 5 | Clientes Activos vs Clientes por Torre | percibido como bug | documentado: CRM (conteo) vs IPAM (capacidad con baseline) — métricas distintas |

---

## 3. Endpoints agregados

- `GET /api/system/data-consistency` — auditoría read-only de consistencia de KPIs
  entre módulos. Devuelve `{ healthy, checkedAt, modules, checks, mismatches }`.

## 4. Endpoints normalizados (misma forma de respuesta, sin cambios de contrato)

- `GET /api/dashboard-stats` — ahora sirve los KPIs desde `systemMetrics` (SSOT);
  `cobranzaMes`/`facturacionMes` pasan a ser del **mes en curso** vía Billing.
- `GET /api/dashboard/billing-kpis` — ahora consume `systemMetrics.billing()`
  (misma fuente que el dashboard; se elimina la duplicación).
- `GET /api/dashboard/executive-summary` — conteos base desde el snapshot SSOT.

---

## 5. Archivos

### Creados

- `backend/domains/system/metrics.ts` — SSOT: una fórmula por KPI desde la fuente oficial.
- `backend/domains/system/consistency.ts` — auditor (recálculo independiente + comparación).
- `backend/domains/system/routes.ts` — `GET /api/system/data-consistency`.
- `tests/unit/data-consistency.service.test.ts` — 9 tests.
- `tests/contract/data-consistency.contract.test.ts` — 4 tests.
- `docs/DATA_CONSISTENCY_AUDIT.md` — inventario (FASE A) + SSOT (FASE B).
- `docs/DATA_CONSISTENCY_AUDIT_RESULT.md` — este documento.

### Modificados

- `backend/domains/dashboard/routes.ts` — consume SSOT; `buildDashboardStats` /
  `buildBillingKpis` exportados; fix de `cobranzaMes`/`facturacionMes`.
- `backend/register-routes.ts` — registra `systemRoutes`.

---

## 6. Tests agregados

| Archivo | Tests | Cobertura |
| --- | --- | --- |
| `tests/unit/data-consistency.service.test.ts` | 9 | SSOT vs recálculo directo, comparador del auditor, `healthy:true` |
| `tests/contract/data-consistency.contract.test.ts` | 4 | endpoint sano, concordancia dashboard↔billing-kpis, activos↔CRM, MRR↔resumen |

---

## 7. Evidencia de validación

### `GET /api/system/data-consistency` (data semilla)

```jsonc
{
  "healthy": true,
  "modules": ["CRM", "Billing", "Support", "Network", "IPAM", "Inventory"],
  "checks": [
    { "metric": "activeCustomers",   "source": "CRM",     "official": 4,     "consumers": { "dashboard": 4 },               "consistent": true },
    { "metric": "suspendedCustomers","source": "CRM",     "official": 1,     "consumers": { "dashboard": 1 },               "consistent": true },
    { "metric": "leads",             "source": "CRM",     "official": 2,     "consumers": { "dashboard": 2 },               "consistent": true },
    { "metric": "mrr",               "source": "Billing", "official": 15695, "consumers": { "dashboard": 15695 },           "consistent": true },
    { "metric": "facturacionMes",    "source": "Billing", "official": 0,     "consumers": { "dashboard": 0, "billingKpis": 0 }, "consistent": true },
    { "metric": "cobradoMes",        "source": "Billing", "official": 0,     "consumers": { "dashboard": 0, "billingKpis": 0 }, "consistent": true },
    { "metric": "pendienteCobro",    "source": "Billing", "official": 748,   "consumers": { "billingKpis": 748 },           "consistent": true },
    { "metric": "facturasVencidas",  "source": "Billing", "official": 2,     "consumers": { "billingKpis": 2 },             "consistent": true },
    { "metric": "openTickets",       "source": "Support", "official": 2,     "consumers": { "dashboard": 2 },               "consistent": true },
    { "metric": "towersOnline",      "source": "Network", "official": 2,     "consumers": { "dashboard": 2 },               "consistent": true }
  ],
  "mismatches": []
}
```

### Comandos obligatorios

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ PASS — 1590 passed, 49 skipped (DB opt-in) |
| `npm run build` | ✅ PASS |

---

## 8. Riesgos detectados antes de avanzar a PROD-7

1. **`reports/routes.ts` recalcula montos inline** (paidAmount/pendingAmount).
   Son vistas por-factura para exportación, no KPIs agregados; bajo riesgo. Deuda
   menor: migrar a `BillingService.listInvoices()` en una iteración futura.
2. **MRR depende de `store.PLANS` para el precio.** Si Plans migra a DB
   (`USE_DB_PLANS`), `systemMetrics.mrr` debe leer el precio vía `PlansService`
   para mantener la fuente única. Revisar al activar ese flag.
3. **IPAM "Clientes por Torre" usa un baseline + asignaciones**, distinto del
   conteo de CRM. No es inconsistencia, pero conviene etiquetarlo en la UI como
   "capacidad" para no confundir con "clientes activos" del CRM.
4. **El auditor compara contra los builders en memoria, no por HTTP.** Cubre el
   cableado de datos; no sustituye un smoke E2E de los endpoints en staging
   (lo valida Hermes).
5. ~~**PROD-7 introducirá `serviceStatus` como posible 3ª noción de "suspendido"**~~
   ✅ **RESUELTO** (Pre-PROD-7, Service Status SSOT): se creó el dominio
   `service-status` como fuente oficial de `serviceStatus`. El KPI "Suspendidos"
   (`dashboard-stats.suspendedClients`) y el auditor (`suspendedCustomers`, source
   `ServiceStatus`) ya consumen `serviceStatus === SUSPENDED`. Ver
   [SERVICE_STATUS_SSOT_RESULT.md](./SERVICE_STATUS_SSOT_RESULT.md).
