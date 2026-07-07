# WISP OS — Mapa de módulos

> Fecha: 2026-07-07 · Branch: `cursor/wisp-os-full-plan-0ffb`

Mapeo entre la especificación WISP OS (20 módulos), código, flags y gates.

| # | Módulo | Backend | Frontend | Flag DB | Gate producción |
|---|--------|---------|----------|---------|-----------------|
| 1 | Dashboard / Control | `dashboard/control-center.ts` | `Dashboard.tsx` | — | SSOT metrics |
| 2 | CRM / Client 360 | `customers/`, `client-360/` | `CrmModule.tsx` | `USE_DB_CUSTOMERS` | Persistencia |
| 3 | Planes | `plans/` | Billing/CRM | `USE_DB_PLANS` | Persistencia |
| 4 | Facturación / Cobranza | `billing/`, `collections/` | `BillingModule.tsx` | `USE_DB_BILLING` | Webhooks reales |
| 5 | Cortes | `suspension/`, `service-status/` | `SuspensionModule.tsx` | `USE_DB_SUSPENSION` | PROD-5→7 |
| 6 | MikroTik | `mikrotik/`, `router-config-audit/` | `MikrotikModule.tsx` | `USE_DB_MIKROTIK` | §11 checklist |
| 7 | Wireless | `network/service.ts` | `NetworkModule.tsx` | `USE_DB_NETWORK` | Telemetría real |
| 8 | FTTH | `network/routes.ts` (OLT/ONU) | `NetworkModule.tsx` | `USE_DB_FTTH` | OLT adapter |
| 9 | NOC | `noc/`, `noc-telemetry/` | `Noc*Module.tsx` | — | Read-only staging |
| 10 | Tickets + SLA | `tickets/`, `tickets/sla.ts` | `SupportModule.tsx` | `USE_DB_SUPPORT` | DB staging |
| 11 | Instalaciones / OT | `tickets/` work orders | `SupportModule.tsx`, `TechPwaModule` | `USE_DB_SUPPORT` | App campo |
| 12 | Inventario | `inventory/`, `serial-units/` | `InventoryModule.tsx` | `USE_DB_INVENTORY` | 5.2 series |
| 13 | GIS | `gis/` | `GisModule.tsx` | `USE_DB_GIS` | store-backed-v2 |
| 14 | Portal cliente | `portal/` | `PortalModule.tsx` | — | Auth cliente |
| 15 | App técnicos | `tickets/` | `TechPwaModule.tsx` | — | PWA offline |
| 16 | Ventas | `commercial/` | `CommercialModule.tsx` | `USE_DB_COMMERCIAL` | UI + DB |
| 17 | Comunicaciones | `notifications/`, `automation/` | `NotificationCenterModule` | — | PROD-9 real send |
| 18 | RBAC | `common/rbac.ts` | `rbac.ts` | — | JWT prod |
| 19 | Reportes | `reports/` | `ReportsModule.tsx` | `USE_DB_REPORTS` | Export |
| 20 | Seguridad | `security/`, jobs | — | — | Backups §14 |

## Endpoints nuevos (esta implementación)

- `GET /api/dashboard/control-center`
- `GET|POST /api/clients/:id/{tags,contacts,documents,activity,expediente}`
- `GET|POST /api/collections/{promises,cash-register}`
- `GET /api/portal/:clientId/{summary,invoices,tickets,payment-promise}`
- `GET /api/tickets/sla/breaches`
- `GET|POST /api/mikrotik/:routerId/backups` + `operations/preview` (gated)
- `POST /api/automation/decisions/:id/notify-preview` + `POST /api/automation/notify-pending`
- `GET /api/system/staging-readiness`
- `GET /api/radius/status` + `GET /api/radius/sessions`
- `GET /api/tenancy/status` + `GET /api/tenants`
- `POST /api/ipam/pools/:poolId/propose-allocation` (dry-run)

## Olas implementadas

| Ola | Estado |
|-----|--------|
| OLA 0 | `.env.example` flags, jobs auditoría, persistencia-status |
| OLA 1 | Control center, Client 360, collections, commercial UI |
| OLA 2 | Router backup/diff/preview (dry-run) |
| OLA 3 | Network/FTTH SSOT, GIS RBAC + service layer | Entregado |
| OLA 4 | Portal completo + PWA técnicos ampliada | Entregado |
| OLA 5 | SLA support DB, Reports fix, notify UI, CFDI banner | Entregado |
| OLA 6 | RADIUS stub + tenancy foundation | Entregado (diseño) |

## Verificación

```bash
npm run typecheck
npm test
npm run build
```

Tests: `tests/contract/wisp-os.contract.test.ts`
