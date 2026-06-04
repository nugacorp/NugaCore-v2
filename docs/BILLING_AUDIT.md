# NugaCore — Auditoría del dominio Billing (Pre-Fase 4)

> Fecha: 2026-06-04 · Estado: **100% mock** (store en memoria, sin persistencia DB).
> Relacionado: [BILLING_ARCHITECTURE.md](BILLING_ARCHITECTURE.md) · [BILLING_ROADMAP.md](BILLING_ROADMAP.md)

---

## 1. Resumen ejecutivo

El dominio Billing opera completamente sobre `store.INVOICES`, `store.PAYMENT_ALLOCATIONS`
y `store.SUSPENSION_POLICY`. No hay persistencia real: todos los datos se pierden al
reiniciar el servidor. La lógica financiera es **funcionalmente correcta** para un WISP
pequeño, pero carece de:

- Estructura de cobros recurrentes (billing cycle).
- Créditos, ajustes y notas de crédito.
- Saldo a favor del cliente.
- Separación entre pago (transacción) y aplicación de pago (conciliación).
- Reportes financieros robustos (diario/mensual/morosidad/CxC/flujo de caja).
- Generación real de CFDI (solo simula UUID).
- Portal de cliente para autopago.

---

## 2. Endpoints actuales

### `backend/domains/billing/routes.ts`

| Método | Ruta | RBAC | Descripción |
|--------|------|------|-------------|
| GET | `/api/billing/invoices` | READ_ROLES | Lista facturas + estado de cuenta calculado |
| GET | `/api/billing/invoices/:id/account-state` | READ_ROLES | Detalle de factura + allocations |
| GET | `/api/billing/account-summary` | READ_ROLES | Totales: facturado/cobrado/pendiente/vencidos |
| GET | `/api/billing/revenue-report` | READ_ROLES | Ingresos por método + top pendientes |
| POST | `/api/billing/invoices` | super admin, administrador, cobranza | Crear factura manual |
| POST | `/api/billing/invoices/:id/pay` | super admin, administrador, cobranza | Registrar pago |
| PUT | `/api/billing/invoices/:id` | super admin, administrador, cobranza | Editar factura |

### `backend/domains/suspension/routes.ts`

| Método | Ruta | RBAC | Descripción |
|--------|------|------|-------------|
| GET | `/api/suspension/policy` | público (sin RBAC) | Política de suspensión |
| PUT | `/api/suspension/policy` | super admin, administrador, cobranza | Editar política |
| GET | `/api/suspension/logs` | público | Historial de suspensiones |
| POST | `/api/suspension/run` | super admin, administrador, cobranza | Ejecutar regla automática |
| POST | `/api/suspension/clients/:id/suspend` | super admin, administrador, cobranza | Suspender manual |
| POST | `/api/suspension/clients/:id/reactivate` | super admin, administrador, cobranza | Reactivar manual |

> **Gap de seguridad:** `GET /api/suspension/policy` y `GET /api/suspension/logs` no
> tienen `requireRoles`. En la migración se debe agregar al menos `READ_ROLES`.

---

## 3. Tipos de datos actuales (`src/types.ts` + `store.ts`)

### `Invoice`
```typescript
interface Invoice {
  id: string;            // 'fac-101' (slug secuencial)
  clientId: string;      // referencia a Client
  clientName: string;    // desnormalizado
  amount: number;        // total de la factura
  dateStr: string;       // fecha de emisión (YYYY-MM-DD)
  dueDateStr: string;    // fecha de vencimiento
  status: 'paid' | 'unpaid' | 'overdue' | 'canceled';
  cfdiStatus: 'pending' | 'generated' | 'canceled';
  cfdiUuid?: string;     // simulado
  items: { description: string; price: number; qty: number }[];
  payments: { date: string; amount: number; method: string; transactionId?: string }[];
}
```

**Problemas arquitectónicos:**
- `payments[]` es un array embebido en la factura → no tiene entidad propia (no hay id por pago).
- `amount` es el total; no hay campo `subtotal` ni `tax`.
- `status` se calcula on-the-fly (`syncInvoiceStatus`) pero también se puede sobreescribir con `PUT`.
- No existe concepto de `creditBalance`, `adjustment`, ni `discounts`.

### `PaymentAllocation`
```typescript
interface PaymentAllocation {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  paymentDate: string;
  transactionId?: string;
  remainingAfterPayment: number;
}
```
La `PaymentAllocation` actual es un **log de auditoría de pago**, no una conciliación real.
No permite aplicar un pago a múltiples facturas ni registrar overpayments.

### `SuspensionPolicy`
```typescript
interface SuspensionPolicy {
  enabled: boolean;
  graceDays: number;                       // días de gracia post-vencimiento
  allowAutoReactivateOnPayment: boolean;   // reactivar al pagar
}
```

### `SuspensionActionLog`
```typescript
interface SuspensionActionLog {
  id: string;
  clientId: string;
  clientName: string;
  action: 'suspend' | 'reactivate' | 'rule-scan';
  reason: string;
  source: 'manual' | 'automation';
  actorId?: string;
  createdAt: string;
}
```

---

## 4. Datos mock existentes

**Facturas (`store.INVOICES`):**

| id | clientId | amount | status | cfdiStatus | pagos |
|----|----------|--------|--------|------------|-------|
| fac-101 | c-1 (Sofia) | 449 | paid | generated | 1 pago completo (Stripe) |
| fac-102 | c-2 (Corporativo) | 2499 | paid | generated | 1 pago completo (SPEI) |
| fac-103 | c-4 (Rodrigo) | 299 | unpaid → recalcula a overdue | pending | 0 pagos |
| fac-104 | c-3 (Hotel) | 11999 | paid | generated | 1 pago completo (PayPal) |
| fac-105 | c-5 (Escuela) | 449 | overdue | pending | 0 pagos |

> `fac-103` y `fac-105` tienen `dueDateStr: '2026-05-10'` y hoy es 2026-06-04 → ambas
> son `overdue` al recalcular. El cliente `c-4` (Rodrigo) ya está en status `suspended`.

**`PAYMENT_ALLOCATIONS`:** vacío en el seed (se genera al registrar pagos en runtime).

**Política de suspensión:** `enabled: true`, `graceDays: 3`, `allowAutoReactivateOnPayment: true`.

---

## 5. Clientes vencidos / morosos actuales

| Cliente | Facturas vencidas | Monto pendiente | Status cliente |
|---------|-------------------|-----------------|----------------|
| Rodrigo Flores Ortiz (c-4) | fac-103 | $299 | **suspended** |
| Escuela Primaria Benito Juarez (c-5) | fac-105 | $449 | **active** (no suspendida aún) |

> `c-5` debería estar suspendida según la política (> 3 días de gracia), pero el
> `suspension/run` es manual — no hay tarea programada (cron) en el backend.

---

## 6. Lógica de cobranza actual

### `syncInvoiceStatus(invoice)` (billing/routes.ts)
Calcula `paidAmount` sumando `invoice.payments[]`, luego:
- `pendingAmount <= 0` → `status = 'paid'`, `cfdiStatus = 'generated'`, genera `cfdiUuid` simulado.
- `pendingAmount > 0 && isPastDue` → `status = 'overdue'`.
- `pendingAmount > 0 && !isPastDue` → `status = 'unpaid'`.
- Si `cfdiStatus === 'generated'` pero `pending > 0` → revierte a `'pending'`.

### Pago parcial actual
- `POST /api/billing/invoices/:id/pay` acepta `amount` parcial.
- Si `amount > pendingAmount` → 400 (no permite sobrepago).
- No hay saldo a favor ni nota de crédito.

### Reactivación automática al pagar (billing/routes.ts:162-185)
Al registrar un pago, si el cliente está `suspended` y la política lo permite:
- Cambia `client.status = 'active'`.
- Agrega log MikroTik (simulado).
- Crea `SuspensionActionLog`.
- Agrega `ClientTimelineEvent`.

Esta lógica está **dispersa** en billing/routes.ts en vez de en suspension/routes.ts.

---

## 7. Reportes actuales

| Reporte | Endpoint | Campos |
|---------|----------|--------|
| Account Summary | GET /api/billing/account-summary | totalInvoiced, totalCollected, totalPending, overdueCount, paidCount, unpaidCount |
| Revenue Report | GET /api/billing/revenue-report | byMethod[], topPendingInvoices[] |
| Financial Export | GET /api/reports/export?scope=financial | invoiceId, clientId, amount, paidAmount, pendingAmount, status, dueDate, paymentsCount |

**Gaps de reportes:**
- No hay reporte de ingresos **diario** ni **mensual** por período.
- No hay reporte de **cuentas por cobrar (CxC) por antigüedad** (0-30, 31-60, 61-90, 90+ días).
- No hay reporte de **flujo de caja** proyectado.
- No hay reporte de **MRR** (Monthly Recurring Revenue) real.
- El reporte financiero solo exporta facturas, no pagos individuales.

---

## 8. Deuda técnica identificada

| Item | Impacto | Solución en Fase 4 |
|------|---------|-------------------|
| `payments[]` embebido en `Invoice` | No hay id por pago; difícil auditar | Tabla `payments` independiente |
| `cfdiUuid` simulado | No es fiscal | Integración PAC real (Fase 4.9) |
| `syncInvoiceStatus` en cada GET | Ineficiente; debería ser eventual | Trigger DB o job periódico |
| Reactivación automática en billing/routes | Acoplamiento billing↔suspension | Evento/hook desacoplado |
| `getUniqueInvoiceId()` no atómico | Colisión en concurrencia | Secuencia DB (`fac-` + timestamp o UUID) |
| Sin concepto de billing period | No soporta cobro mensual recurrente | `service_subscriptions` + `billing_periods` |
| `GET /api/suspension/*` sin RBAC | Gap de seguridad | Aplicar `READ_ROLES` |
| Sin validación de `dueDateStr` format | Acepta strings inválidos | Validación en service |

---

## 9. Dependencias actuales del dominio Billing

```
billing/routes.ts
  ← store.INVOICES
  ← store.CLIENTS (validar cliente, reactivar)
  ← store.PLANS (precio del plan en lead conversion — en customers/routes.ts)
  ← store.PAYMENT_ALLOCATIONS
  ← store.SUSPENSION_POLICY (allowAutoReactivateOnPayment)
  ← store.MIKROTIK_LOGS (log simulado)

suspension/routes.ts
  ← store.CLIENTS (mutar status)
  ← store.INVOICES (detectar morosidad)
  ← store.SUSPENSION_POLICY
  ← store.SUSPENSION_ACTION_LOGS
  ← store.MIKROTIK_LOGS (log simulado)

reports/routes.ts
  ← store.INVOICES (financial report)
  ← store.TOWERS (operational report)
  ← store.SECURITY_AUDIT_LOGS (security report)
```

---

## 10. Conclusión

El dominio Billing es el más complejo para migrar: tiene efectos cruzados con
Customers (status del cliente), Suspension (reactivación automática), Reports
(exportación), y eventualmente MikroTik (bloqueo de PPPoE). La estrategia recomendada
es migrar en fases pequeñas (ver [BILLING_ROADMAP.md](BILLING_ROADMAP.md)), empezando
por el modelo de datos y la persistencia de facturas+pagos antes de abordar el ciclo
de cobro recurrente y la integración MikroTik.
