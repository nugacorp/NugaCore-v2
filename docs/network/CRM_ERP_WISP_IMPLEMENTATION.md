# CRM/ERP WISP — Implementación del plan

> Fecha: 2026-07-07 · Branch: `cursor/crm-erp-wisp-plan-0ffb`

## Resumen

Implementación de las 5 prioridades del plan de criterio CRM/ERP WISP:

1. **Persistencia crítica** — Support/tickets con repository+service (`USE_DB_SUPPORT`), endpoint `/api/system/persistence-status`
2. **CRM comercial** — Dominio `commercial` (prospectos, cotizaciones, citas) + migración DB
3. **ERP operativo** — Compras ligeras, P&L operativo, inventario serial (schema 5.2)
4. **Operación red / Client 360** — Puente `/api/client-actions/*` → billing + support + service-status (gates)
5. **Escalabilidad** — Paginación opcional en clientes, jobs runner, health ampliado

## Feature flags nuevas

| Flag | Dominio |
|------|---------|
| `USE_DB_SUPPORT` | tickets + work orders |
| `USE_DB_COMMERCIAL` | CRM comercial |
| `USE_DB_PURCHASES` | órdenes de compra |
| `USE_DB_FINANCE` | gastos operativos |

## Endpoints nuevos

### CRM Comercial
- `GET /api/commercial/pipeline`
- `GET|POST /api/commercial/prospects`
- `POST /api/commercial/prospects/:id/advance`
- `GET|POST /api/commercial/quotes`
- `GET|POST /api/commercial/appointments`

### ERP Operativo
- `GET|POST /api/purchases/suppliers`
- `GET|POST /api/purchases/orders`
- `POST /api/purchases/orders/:id/receive`
- `GET|POST /api/finance/operational/expenses`
- `GET /api/finance/operational/pnl`

### Client 360 (backends reales)
- `POST /api/client-actions/:clientId/payment` → billing (requiere factura pendiente)
- `POST /api/client-actions/:clientId/ticket` → support
- `POST /api/client-actions/:clientId/work-order` → support

### Infra
- `GET /api/system/persistence-status`
- `GET /api/jobs` · `POST /api/jobs/run`
- `GET /api/clients?page=1&limit=50` (respuesta paginada aditiva)
- `GET|POST /api/inventory/serial-units`
- `POST /api/inventory/serial-units/:id/assign-client`

## Migración

`supabase/migrations/20260707000000_crm_erp_wisp_schema.sql`

## Gates operación red (sin saltos)

La secuencia PROD-3→PROD-7 del ROADMAP permanece obligatoria. Client 360 **no** ejecuta RouterOS ni suspension live; usa service-status dry-run y billing/support reales.

## CFDI

P&L incluye nota: timbrado PAC pendiente (ROADMAP Fase 4.9). Evaluar proveedor fiscal antes de producción México.

## Verificación

```bash
npm run typecheck
npm test
npm run build
```

Tests de contrato: `tests/contract/crm-erp-wisp.contract.test.ts`
