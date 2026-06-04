# Billing 4.2.1 — Validación staging de persistencia

Fecha: 2026-06-04T16:49:59+00:00

URL staging: https://nugacore-staging.5.180.151.109.sslip.io

Commit validado: `84fa25f615a71ec5a1d1eedc8a41c9d06cc26ad8`

Commit funcional esperado: `84fa25f feat(billing): add persistence layer behind USE_DB_BILLING flag (Fase 4.2)`

## Restricciones cumplidas

- No se modificó código fuente.
- No se tocó frontend.
- No se crearon migraciones nuevas.
- No se tocó MikroTik, Tickets, Inventory ni GIS.
- No se avanzó a Fase 4.3.
- No se imprimieron secretos.
- No se realizaron cambios destructivos sobre datos reales.
- Solo se creó y limpió una factura de prueba controlada.

## Repo actualizado

Últimos commits al validar:

```text
84fa25f feat(billing): add persistence layer behind USE_DB_BILLING flag (Fase 4.2)
6393172 docs(billing): update 4.1 result with staging validation
1341aa3 feat(billing): add financial schema migrations (Fase 4.1)
9d705a2 docs(billing): add pre-phase 4 architecture and roadmap
da4dc2f docs(staging): add sanitized deployment notes
```

## Backup ligero previo

Snapshot seguro guardado fuera del repo:

`/root/nugacore-ops-notes/billing-4.2.1-pre-activation-2026-06-04T16-41-55-064Z.json`

Conteos previos:

| Tabla | Conteo |
|---|---:|
| clients | 3 |
| plans | 5 |
| invoices | 0 |
| payments | 0 |
| payment_applications | 0 |

## Activación Billing DB

Flags finales confirmados en staging:

| Flag | Estado |
|---|---|
| USE_DB_CUSTOMERS | true |
| USE_DB_PLANS | true |
| USE_DB_BILLING | true |
| AUTH_TRUST_HEADERS | false |

Log esperado observado:

```text
Billing domain: persistencia = Supabase (USE_DB_BILLING=true)
```

## Healthchecks

| Endpoint | Resultado |
|---|---|
| GET /api/health | PASS 200; `domainsOnDb=[customers, plans, billing]` |
| GET /api/health/live | PASS 200 |
| GET /api/health/ready | PASS 200 |

## Factura de prueba

Factura creada con endpoint oficial `POST /api/billing/invoices`.

| Campo | Resultado |
|---|---|
| Cliente | `c-1` |
| Monto | 299 |
| Invoice ID | `fac-101` |
| HTTP create | 201 |
| Status inicial | unpaid |
| Pending inicial | 299 |
| Recuperable vía account-state | PASS |
| Persistida en Supabase | PASS |
| DB balance inicial | 29900 cents |

## Pago parcial

Endpoint usado: `POST /api/billing/invoices/fac-101/pay`

| Campo | Resultado |
|---|---|
| Monto | 100 |
| HTTP | 200 |
| Status factura | unpaid |
| Paid amount | 100 |
| Pending amount | 199 |
| Allocations | 1 |
| Remaining after payment | 199 |

## Pago completo

Endpoint usado: `POST /api/billing/invoices/fac-101/pay`

| Campo | Resultado |
|---|---|
| Monto restante | 199 |
| HTTP | 200 |
| Status factura | paid |
| Paid amount | 299 |
| Pending amount | 0 |
| DB applied_cents | 29900 |
| DB balance_cents | 0 |
| Payment applications | 2 |

## Persistencia tras reinicio

Se reinició el contenedor de aplicación y se volvió a consultar backend.

| Verificación | Resultado |
|---|---|
| Health tras reinicio | PASS 200 |
| Invoice recuperable | PASS |
| Status tras reinicio | paid |
| Paid amount tras reinicio | 299 |
| Pending amount tras reinicio | 0 |
| Allocations tras reinicio | 2 |
| Account summary tras reinicio | PASS |
| Revenue report tras reinicio | PASS |

## Reportes backend

| Endpoint | Resultado |
|---|---|
| GET /api/billing/account-summary | PASS 200; totalInvoiced=299, totalCollected=299, totalPending=0, invoicesCount=1 |
| GET /api/billing/revenue-report | PASS 200; byMethod válido, topPendingInvoices válido |

## Tests DB

Comando:

```bash
RUN_DB_TESTS=true npm run test:db
```

Resultado:

```text
Test Files  4 passed (4)
Tests       21 passed (21)
```

Incluyó:

- Customers DB contract.
- Plans DB contract.
- Billing schema DB.
- Billing DB contract.

## Limpieza

Se eliminó la factura de prueba y sus entidades relacionadas.

| Entidad | Antes | Después |
|---|---:|---:|
| invoices `fac-101` | 1 | 0 |
| invoice_items | 1 | 0 |
| payment_applications | 2 | 0 |
| payments vinculados | 2 | 0 |

Conteos finales:

| Tabla | Conteo final |
|---|---:|
| clients | 3 |
| plans | 5 |
| invoices | 0 |
| payments | 0 |
| payment_applications | 0 |
| service_subscriptions | 1 |

## Riesgos / observaciones

- `USE_DB_BILLING=true` quedó activo en staging, junto con `USE_DB_CUSTOMERS=true` y `USE_DB_PLANS=true`.
- El flujo backend de Billing ya persiste en Supabase y sobrevive reinicio.
- La validación no cubrió UI/frontend por restricción explícita.
- La limpieza dejó staging sin facturas/pagos de prueba creados en esta validación.
- No se validaron integraciones futuras como CFDI real, pagos en línea, suspensión automática, MikroTik ni Fase 4.3.

## Resultado final

PASS — Billing Persistence Fase 4.2 quedó validado en staging real usando Supabase con `USE_DB_BILLING=true`.

## Recomendación para Fase 4.3

Avanzar a Fase 4.3 solo después de mantener observación breve de staging con `USE_DB_BILLING=true` y agregar una prueba E2E backend automatizada para el flujo factura -> pago parcial -> pago completo -> account-state.
