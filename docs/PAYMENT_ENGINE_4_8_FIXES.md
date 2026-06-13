# Payment Engine — Fase 4.8 HOTFIX: Staging DB Alignment

## Contexto

Hermes devolvió **NO APROBADA** en el commit `f5a97f1` de la Fase 4.8 por tres blockers detectados en staging con `USE_DB_CUSTOMERS=true` y `USE_DB_BILLING=true`.

---

## Blocker 1 — Contrato `amount` vs `amountCents`

**Causa raíz:** `POST /api/payments/orders` sólo aceptaba `amountCents` (centavos). El portal UI y los tests de Hermes envían `amount` en pesos.

**Solución:** Lógica dual en `routes.ts`:

| Campo recibido | Comportamiento |
|---|---|
| Solo `amountCents` | Se usa directamente (entero en centavos) |
| Solo `amount` | Se convierte: `Math.round(amount * 100)` |
| Ambos, coincidentes | Se acepta (sin error) |
| Ambos, contradictorios | `400 AMOUNT_MISMATCH` |
| Ninguno | `400` — monto requerido |

**Archivo modificado:** `backend/domains/payments/routes.ts`

---

## Blocker 2 — Payment Engine leer clientes de DB

**Causa raíz:** `reactivateCustomerService()` en `service.ts` leía `store.CLIENTS` directamente. En staging con `USE_DB_CUSTOMERS=true` los clientes reales están en Supabase y el array del store queda vacío → `NotFoundError` para cualquier cliente.

**Solución:** Se creó `backend/domains/payments/data-provider.ts` con el patrón `PaymentDataProvider` (idéntico a `SuspensionDataProvider` de Fase 4.5.1):

- `StorePaymentDataProvider` — lee/escribe `store.CLIENTS` directamente (modo mock).
- `ServicePaymentDataProvider` — delega a `getCustomersService()` que ya enruta a DB cuando `USE_DB_CUSTOMERS=true`.
- `buildPaymentDataProvider()` — fábrica que selecciona según flag.

**Archivos nuevos / modificados:**
- `backend/domains/payments/data-provider.ts` (nuevo)
- `backend/domains/payments/service.ts` — usa `buildPaymentDataProvider()` en lugar de `store.CLIENTS`

---

## Blocker 3 — Validación factura-cliente

**Causa raíz:** `createOrder()` no verificaba que la factura perteneciera al cliente indicado. Un operador podía crear una payment_order con `customerId=c-1, invoiceId=fac-102` (que es de c-2) sin error.

**Solución:** Antes de crear la order, se resuelve la factura vía `BillingService.findInvoiceById()` y se valida `invoice.clientId === customerId`. Error: `400 INVOICE_CLIENT_MISMATCH`.

**Archivo modificado:** `backend/domains/payments/service.ts` (método `createOrder`)

---

## Contrato final — POST /api/payments/orders

```
POST /api/payments/orders
Authorization: Bearer <JWT>   (roles: super admin | administrador | cobranza)

Body (application/json):
{
  "customerId": "c-4",                    // requerido
  "invoiceId":  "fac-103",               // requerido; debe pertenecer a customerId
  "provider":   "manual",                 // manual | mercado_pago | openpay | spei
  "amount":     299,                      // pesos (alias UI-friendly)  ─┐ uno de los dos
  "amountCents": 29900                    // centavos (canónico interno)  ─┘
}

Responses:
  201  { id, customerId, invoiceId, provider, amountPesos, status, statusLabel, createdAt, ... }
  400  { error, code: "INVOICE_CLIENT_MISMATCH" }   // factura no es del cliente
  400  { error, code: "AMOUNT_MISMATCH" }            // amount y amountCents contradictorios
  400  { error }                                     // campos faltantes o monto inválido
  403  { error }                                     // sin permisos de escritura
```

---

## Checklist para Hermes

- [x] `POST /api/payments/orders` acepta `amount` en pesos
- [x] `POST /api/payments/orders` acepta `amountCents` en centavos
- [x] Ambos coincidentes → 201; contradictorios → 400 AMOUNT_MISMATCH
- [x] `reactivateCustomerService` usa `PaymentDataProvider` (funciona con `USE_DB_CUSTOMERS=true`)
- [x] Factura que no pertenece al cliente → 400 INVOICE_CLIENT_MISMATCH
- [x] Factura inexistente → 400
- [x] Idempotencia de webhooks funcionando con store y con DB
- [x] `dryRun=true` en todas las `mikrotik_actions` (NO se ejecuta en router real)
- [x] Sin tokens/secrets expuestos en la vista de payment_order
- [x] Todos los tests pasan (hermético + `npm run typecheck`)

---

## Restricciones mantenidas

- NO commit mode MikroTik activado.
- NO reactivación real ejecutada (solo `dryRun=true`).
- NO se tocan routers ni PPP/Queues reales.
- NO se relajó Auth (JWT + RBAC intactos).
- NO se usan trusted headers.
- NO se guarda rawPayload sensible en la vista pública.
