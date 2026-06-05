# SUSPENSION TEST-TOOLS CLEANUP — AUDITORÍA (Fase 4.5.2 · Tarea 3)

Fecha: 2026-06-05
Síntoma: `DELETE /api/suspension/test-tools/customer/:id` devolvió **500** en el
Escenario B porque la factura pagada dejó dependencias persistentes
(`payments`, `payment_applications`). Hermes tuvo que limpiar a mano.

## 1. Por qué el Escenario B generó dependencias persistentes

El Escenario B crea: cliente → factura → **pago completo**. El pago produce, en
DB, filas en:
- `payments` (FK `client_id` → `clients` **ON DELETE RESTRICT**)
- `payment_applications` (FK `payment_id` → `payments` **RESTRICT**, FK `invoice_id` → `invoices` **RESTRICT**)
- `invoice_items` (FK `invoice_id` → `invoices`)
- `invoices` (del cliente)

El endpoint solo hacía `customers.remove(id)` → `DELETE FROM clients`. Como
`payments.client_id` es **RESTRICT**, Postgres rechaza el borrado → **500**.

## 2. Orden correcto de borrado (hijos → padre)

```
1. payment_applications   (by invoice_id ∈ invoices del cliente, y by payment_id)
2. payments               (by client_id)
3. invoice_items          (by invoice_id ∈ invoices del cliente)
4. invoices               (by client_id)
5. suspension_orders      (by customer_id)
6. reactivation_orders    (by customer_id)
7. suspension_events      (by customer_id)
8. customer_service_state (by customer_id)
9. clients                (by id)
```

(5–8 además tienen `ON DELETE CASCADE` desde `clients`, pero se borran
explícitamente para soportar `USE_DB_SUSPENSION=false` —estado en memoria— y
para ser idempotentes.)

## 3. Cómo se evita el 500

- Borrar los hijos de billing **antes** del cliente, respetando las FKs RESTRICT.
- En modo DB usar `supabaseAdmin` (service-role); en modo mock limpiar el store.
- Operaciones `.delete().eq()/.in()` son **idempotentes** (cero filas no es error).
- Si el cliente ya no existe → respuesta controlada `{ removed:false, reason:'not_found' }` (no 500).

## 4. Qué tablas deben limpiarse

Billing: `payment_applications`, `payments`, `invoice_items`, `invoices`.
Suspension: `suspension_orders`, `reactivation_orders`, `suspension_events`, `customer_service_state`.
Customers: `clients` (+ su timeline, vía `customers.remove`).

> No se crean `credit_notes`/`adjustments`/`service_subscriptions` en los
> escenarios, así que no requieren limpieza.

## 5. Candados de seguridad

- Solo limpia clientes cuyo nombre empieza con `__TEST__` (los que crea test-tools). Clientes reales → **403**.
- Disponible solo si `NODE_ENV != production` y `STAGING_TEST_TOOLS_ENABLED != false`, rol super admin.
- Idempotente y sin secretos en logs/respuestas.
