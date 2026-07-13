# WISP OS — Mapa de módulos

> Fecha: 2026-07-08 · Branch: `cursor/wisp-os-master-plan-0ffb`

Mapeo entre la especificación WISP OS (20 módulos), código, flags y gates de producción.

## Production gates (`backend/config/production-gates.ts`)

| Variable | Subsistema |
|----------|------------|
| `NUGACORE_LIVE_MODE` | Master switch (activa todos) |
| `MIKROTIK_WORKER_LIVE` | Lectura RouterOS |
| `MIKROTIK_WORKER_COMMIT` | Escritura RouterOS (cortes/reactivaciones) |
| `NOTIFICATIONS_LIVE` | Envío real (webhook / IN_APP) |
| `AUTOMATION_EXECUTE` | Automation → acciones downstream |
| `PROVISIONING_EXECUTE` | Provisioning aprobado → red/CRM |
| `PAYMENTS_ROUTER_LIVE` | Pago → orden reactivación |
| `SAFE_COMMAND_QUEUE_LIVE` | Cola segura → ejecución |
| `SERVICE_STATUS_LIVE` | Service status → órdenes suspension |

API: `GET /api/system/production-gates` · UI: `ProductionGateBadge` + `useProductionGates`

| # | Módulo | Backend | Frontend | Flag DB | Gate producción |
|---|--------|---------|----------|---------|-----------------|
| 1 | Dashboard / Control | `dashboard/control-center.ts` | `Dashboard.tsx` | — | SSOT metrics |
| 2 | CRM / Client 360 | `customers/`, `client-360/` | `CrmModule.tsx` | `USE_DB_CUSTOMERS` | Persistencia |
| 3 | Planes | `plans/` | Billing/CRM | `USE_DB_PLANS` | Persistencia |
| 4 | Facturación / Cobranza | `billing/`, `collections/` | `BillingModule.tsx` | `USE_DB_BILLING` | `PAYMENTS_ROUTER_LIVE` |
| 5 | Cortes | `suspension/`, `service-status/` | `SuspensionModule.tsx` | `USE_DB_SUSPENSION` | `MIKROTIK_WORKER_COMMIT` |
| 6 | MikroTik | `mikrotik/`, `router-config-audit/` | `MikrotikModule.tsx` | `USE_DB_MIKROTIK` | §11 checklist |
| 7 | Wireless | `network/service.ts` | `NetworkModule.tsx` | `USE_DB_NETWORK` | Telemetría real |
| 8 | FTTH | `network/routes.ts` (OLT/ONU) | `NetworkModule.tsx` | `USE_DB_FTTH` | OLT adapter |
| 9 | NOC | `noc/`, `noc-telemetry/` | `Noc*Module.tsx` | — | Read-only staging |
| 10 | Tickets + SLA | `tickets/`, `tickets/sla.ts` | `SupportModule.tsx` | `USE_DB_SUPPORT` | DB staging |
| 11 | Instalaciones / OT | `tickets/` work orders | `SupportModule.tsx`, `TechPwaModule` | `USE_DB_SUPPORT` | App campo |
| 12 | Inventario | `inventory/`, `serial-units/` | `InventoryModule.tsx` | `USE_DB_INVENTORY` | 5.2 series |
| 13 | GIS | `gis/` | `GisModule.tsx` | `USE_DB_GIS` | `ssot-services` |
| 14 | Portal cliente | `portal/` | `PortalModule.tsx` | — | Auth cliente |
| 15 | App técnicos | `tickets/` sync-batch | `TechPwaModule.tsx` | — | PWA offline |
| 16 | Ventas | `commercial/` | `CommercialModule.tsx` | `USE_DB_COMMERCIAL` | UI + convert |
| 17 | Comunicaciones | `notifications/`, `automation/` | `NotificationCenterModule` | — | `NOTIFICATIONS_LIVE` |
| 18 | RBAC | `common/rbac.ts` | `rbac.ts` | — | JWT prod |
| 19 | Reportes | `reports/` | `ReportsModule.tsx` | `USE_DB_REPORTS` | Export |
| 20 | Seguridad | `security/`, jobs | — | — | Backups §14 |

## Endpoints clave

- `GET /api/dashboard/control-center` — 8 áreas cabina de mando
- `GET /api/system/production-gates` — estado dry-run vs live
- `GET /api/system/production-readiness` — checklist `readyForLiveWisp` + blockers
- `GET /api/system/persistence-status` + `staging-readiness`
- `GET|POST /api/clients/:id/{tags,contacts,documents,activity,expediente}`
- `GET|POST /api/collections/{promises,cash-register}`
- `POST /api/commercial/prospects/:id/convert`
- `POST /api/tickets/workorders/sync-batch` — PWA técnicos
- `GET /api/gis/health` — mode `ssot-services`
- `POST /api/automation/notify-pending`
- `GET /api/finance/cfdi/status` — stub fiscal

## Olas implementadas

| Ola | Estado |
|-----|--------|
| OLA 0 | Entregado — `USE_DB_*` críticos, staging-readiness, store bypass en dashboard/client-actions |
| OLA 1 | Entregado — control center 8 áreas, Client 360, collections, commercial UI + convert |
| OLA 2 | Entregado — worker commit gated, backup/diff/preview, command-executor |
| OLA 3 | Entregado — GIS ssot-services, network/FTTH flags, NOC telemetry |
| OLA 4 | Entregado — portal, PWA sync-batch, TechPwa offline |
| OLA 5 | Entregado — notifications live gated, SLA, reports, CFDI stub |
| OLA 6 | Diseño — RADIUS stub + tenancy foundation |

## Verificación

```bash
npm run typecheck
npm test
npm run build
```

Tests: `tests/contract/wisp-os.contract.test.ts`, `tests/unit/production-gates.test.ts`
