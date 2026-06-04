# NugaCore — Arquitectura Financiera Completa (Fase 4)

> Fecha: 2026-06-04 · Estado: **diseño** — sin implementar.
> Relacionado: [BILLING_AUDIT.md](BILLING_AUDIT.md) · [BILLING_ROADMAP.md](BILLING_ROADMAP.md) · [DATA_CONTRACT.md](DATA_CONTRACT.md)

---

## 1. Principios de diseño

1. **Sin big bang:** cada sub-fase entrega valor por sí sola detrás de un feature flag.
2. **Contrato v1 intacto:** los endpoints actuales (`/api/billing/invoices`, `/api/billing/invoices/:id/pay`, etc.) no cambian de forma mientras el flag esté apagado.
3. **Dinero como entero:** todos los montos en centavos (`INTEGER`) en la DB; el mapper divide por 100 antes de exponer al frontend. Esto elimina errores de floating-point en acumulaciones.
4. **Auditabilidad total:** ningún registro financiero se borra lógicamente; se cancela con contra-asiento.
5. **Separación de responsabilidades:** pago ≠ aplicación de pago. Un pago es una transacción de caja; una aplicación es la conciliación contra una factura.
6. **Idempotencia de pagos:** `idempotency_key` en la tabla de pagos para prevenir doble cobro en reintentos.

---

## 2. Modelo financiero completo

### 2.1 Diagrama de entidades

```
clients (ya migrado)
  │
  ├──< service_subscriptions (un cliente puede tener N contratos)
  │        │
  │        ├── plan_id → plans (ya migrado)
  │        └── billing_period (día de corte, día de cobro)
  │
  ├──< invoices (facturas)
  │        │
  │        ├──< invoice_items (renglones de la factura)
  │        ├──< payment_applications (conciliaciones pago↔factura)
  │        └── credit_note_id? → credit_notes (nota de crédito que cancela)
  │
  ├──< payments (transacciones de caja recibidas)
  │        │
  │        ├──< payment_applications (distribución a facturas)
  │        └── receipt_id? → payment_receipts (comprobante emitido)
  │
  ├──< credit_notes (notas de crédito a favor del cliente)
  │        └──< credit_applications (uso de crédito en facturas)
  │
  └── credit_balance_cents (saldo a favor del cliente — campo en clients)
```

### 2.2 Tabla: `service_subscriptions`

Registra el contrato activo de un cliente con un plan. Permite que un cliente
tenga múltiples servicios (por ejemplo: un servicio residencial y uno empresarial).

```sql
CREATE TABLE public.service_subscriptions (
  id TEXT PRIMARY KEY,                    -- slug: 'sub-1'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | suspended | canceled
  billing_day INTEGER NOT NULL DEFAULT 1, -- día del mes para generar factura (1-28)
  due_days INTEGER NOT NULL DEFAULT 10,   -- días de gracia post-billing_day
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  canceled_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_subs_client ON public.service_subscriptions (client_id);
CREATE INDEX idx_subs_status ON public.service_subscriptions (status);
```

**Notas:**
- `billing_day = 1` → factura generada el día 1 de cada mes.
- `due_days = 10` → vence el día 11; la política de gracia empieza ahí.
- Un cliente puede tener máximo 1 suscripción activa por plan (UNIQUE en `client_id, plan_id, status='active'`).

---

### 2.3 Tabla: `invoices`

```sql
CREATE TABLE public.invoices (
  id TEXT PRIMARY KEY,                           -- slug: 'fac-101'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,                     -- desnormalizado para historial
  subscription_id TEXT REFERENCES public.service_subscriptions(id) ON DELETE SET NULL,
  billing_period_start DATE,                     -- inicio del período facturado
  billing_period_end DATE,                       -- fin del período facturado
  subtotal_cents INTEGER NOT NULL DEFAULT 0,     -- suma de items antes de descuentos
  discount_cents INTEGER NOT NULL DEFAULT 0,     -- descuento total aplicado
  tax_cents INTEGER NOT NULL DEFAULT 0,          -- IVA u otros impuestos
  total_cents INTEGER NOT NULL,                  -- subtotal - discount + tax
  applied_cents INTEGER NOT NULL DEFAULT 0,      -- suma de payment_applications
  credit_applied_cents INTEGER NOT NULL DEFAULT 0, -- crédito de notas aplicado
  balance_cents INTEGER GENERATED ALWAYS AS
    (total_cents - applied_cents - credit_applied_cents) STORED, -- pendiente a pagar
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
    -- unpaid | overdue | partial | paid | canceled | void
  cfdi_status TEXT NOT NULL DEFAULT 'pending',   -- pending | generated | canceled
  cfdi_uuid TEXT,
  cfdi_xml_url TEXT,                             -- URL al XML en storage
  canceled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  idempotency_key TEXT UNIQUE,                   -- para generación idempotente
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inv_client ON public.invoices (client_id);
CREATE INDEX idx_inv_status ON public.invoices (status);
CREATE INDEX idx_inv_due    ON public.invoices (due_date);
CREATE INDEX idx_inv_period ON public.invoices (billing_period_start, billing_period_end);
```

**Estados de factura:**

| Estado | Significado |
|--------|-------------|
| `unpaid` | Emitida, dentro del plazo, sin pagos o con pago parcial |
| `overdue` | Plazo vencido, saldo pendiente |
| `partial` | Tiene pagos parciales (subtipo visual, internamente `unpaid`/`overdue`) |
| `paid` | `balance_cents = 0` |
| `canceled` | Cancelada con nota de crédito o ajuste; genera contra-asiento |
| `void` | Anulada antes de enviar (error de captura); sin efecto contable |

> `balance_cents` es columna calculada en la DB → siempre consistente, nunca se calcula en app.

---

### 2.4 Tabla: `invoice_items`

```sql
CREATE TABLE public.invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.16,  -- 16% IVA por default
  subtotal_cents INTEGER GENERATED ALWAYS AS
    ((unit_price_cents * quantity) - discount_cents) STORED,
  tax_cents INTEGER GENERATED ALWAYS AS
    (ROUND(((unit_price_cents * quantity) - discount_cents) * tax_rate)) STORED,
  total_cents INTEGER GENERATED ALWAYS AS
    (((unit_price_cents * quantity) - discount_cents) +
     ROUND(((unit_price_cents * quantity) - discount_cents) * tax_rate)) STORED,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inv_items_inv ON public.invoice_items (invoice_id);
```

---

### 2.5 Tabla: `payments`

Un pago es una **transacción de caja** — dinero recibido del cliente.
Es independiente de las facturas a las que se aplica.

```sql
CREATE TABLE public.payments (
  id TEXT PRIMARY KEY,                          -- slug: 'pay-1'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,                    -- desnormalizado
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'Efectivo',
    -- Efectivo | Transferencia | OXXO | MercadoPago | Stripe | PayPal | SPEI | Otro
  transaction_id TEXT,                          -- referencia externa (Stripe charge_id, SPEI folio, …)
  idempotency_key TEXT UNIQUE,                  -- previene doble registro
  reference TEXT,                               -- folio o nota del cajero
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by TEXT,                             -- actorId del cajero
  notes TEXT,
  -- Estado del pago en sí (no de la factura)
  status TEXT NOT NULL DEFAULT 'confirmed',     -- pending | confirmed | reversed
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_client ON public.payments (client_id);
CREATE INDEX idx_payments_date   ON public.payments (payment_date);
CREATE INDEX idx_payments_method ON public.payments (method);
```

---

### 2.6 Tabla: `payment_applications`

Conciliación entre un pago y una (o varias) facturas.
Un pago puede aplicarse a múltiples facturas; una factura puede recibir pagos de
múltiples transacciones.

```sql
CREATE TABLE public.payment_applications (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL CHECK (applied_cents > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT,                              -- actorId
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (payment_id, invoice_id)               -- un pago solo se aplica una vez a una factura
);

-- La suma de applied_cents por invoice_id debe ser <= invoices.total_cents.
-- La suma de applied_cents por payment_id debe ser <= payments.amount_cents.
-- Se valida en la capa de aplicación (service) y opcionalmente con trigger.

CREATE INDEX idx_pa_payment ON public.payment_applications (payment_id);
CREATE INDEX idx_pa_invoice ON public.payment_applications (invoice_id);
```

**Regla de negocio:** al insertar una `payment_application`, el service actualiza
atómicamente `invoices.applied_cents` y verifica que no supere `total_cents`.

---

### 2.7 Tabla: `credit_notes`

Nota de crédito: monto a favor del cliente por devolución, error de cobro o ajuste.

```sql
CREATE TABLE public.credit_notes (
  id TEXT PRIMARY KEY,                          -- slug: 'cn-1'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,
  invoice_id TEXT REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',     -- available | fully_applied | voided
  applied_cents INTEGER NOT NULL DEFAULT 0,     -- cuánto se ha usado
  voided_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cn_client ON public.credit_notes (client_id);
```

---

### 2.8 Tabla: `credit_applications`

Cómo se aplica una nota de crédito a facturas específicas.

```sql
CREATE TABLE public.credit_applications (
  id TEXT PRIMARY KEY,
  credit_note_id TEXT NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL CHECK (applied_cents > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT,
  UNIQUE (credit_note_id, invoice_id)
);

CREATE INDEX idx_ca_cn      ON public.credit_applications (credit_note_id);
CREATE INDEX idx_ca_invoice ON public.credit_applications (invoice_id);
```

---

### 2.9 Tabla: `adjustments`

Ajuste manual: corrección de saldo sin generar nota de crédito formal.
Puede ser positivo (cargo extra) o negativo (descuento/quita).

```sql
CREATE TABLE public.adjustments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,               -- positivo = cargo; negativo = descuento
  reason TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',         -- manual | late_fee | discount | promotion
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_adj_invoice ON public.adjustments (invoice_id);
CREATE INDEX idx_adj_client  ON public.adjustments (client_id);
```

> Al insertar un ajuste, el service recalcula `invoices.total_cents` sumando el ajuste.
> Esto actualiza automáticamente `balance_cents` (columna calculada).

---

### 2.10 Tabla: `payment_receipts`

Comprobante de pago emitido al cliente (independiente del CFDI).

```sql
CREATE TABLE public.payment_receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL UNIQUE,         -- folio del recibo: REC-2026-001
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_url TEXT,                                -- URL al PDF en storage
  sent_via TEXT,                               -- email | whatsapp | printed | portal
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.11 Campo `credit_balance_cents` en `clients`

Saldo a favor acumulado del cliente (overpayments no aplicados a ninguna factura).

```sql
ALTER TABLE public.clients ADD COLUMN credit_balance_cents INTEGER NOT NULL DEFAULT 0;
```

> El service suma el pago al `credit_balance_cents` cuando `payment.amount_cents >` suma
> total de facturas pendientes. El saldo se puede aplicar en futuras facturas.

---

## 3. Ciclo de facturación completo

```
CLIENTE registrado
  │
  └── SUSCRIPCIÓN creada (service_subscriptions)
        │ billing_day = 1, due_days = 10
        │
  Mes N, día 1 → JOB: generar_facturas()
        │
        ├── Crea invoice (status=unpaid, due_date=día 11)
        │     └── invoice_items (plan.price/100 + IVA)
        │
  Días 1-10 → CORRIENTE
        │   Cliente puede pagar: POST /api/billing/invoices/:id/pay
        │   └── Crea payment → payment_application → recalcula balance_cents → status=paid
        │
  Día 11 → VENCIDO (due_date superada)
        │   job: sync_invoice_statuses() → status=overdue
        │
  Días 11-14 → PERÍODO DE GRACIA (graceDays=3)
        │   Cliente puede pagar; estado es overdue pero sin suspensión.
        │
  Día 15 → MOROSO (beyond grace)
        │   job: suspension_run() → client.status=suspended
        │   → log SuspensionActionLog
        │   → event ClientTimeline ('status_change: active→suspended')
        │   → (futuro) MikroTik: bloquear PPPoE
        │
  Cliente paga (POST /api/billing/invoices/:id/pay)
        │   → payment → payment_application → balance_cents=0 → invoice status=paid
        │   → si allowAutoReactivateOnPayment && no hay más overdue:
        │     client.status=active
        │     → log SuspensionActionLog
        │     → (futuro) MikroTik: reactivar PPPoE
        │
  Cancelación de factura:
        │   → invoice.status=canceled
        │   → si había pagos: genera credit_note por el monto pagado
        │   → credit_note se aplica a próximas facturas o se devuelve
```

---

## 4. Estados del cliente desde la perspectiva financiera

| Estado | Condición |
|--------|-----------|
| `corriente` | Todas sus facturas en `unpaid` (dentro del plazo) |
| `próximo a vencer` | Factura con `due_date` a ≤ 5 días |
| `vencido` | Al menos una factura en `overdue`, dentro del período de gracia |
| `moroso` | Al menos una factura en `overdue`, fuera del período de gracia |
| `suspendido` | `client.status = 'suspended'` (puede estar con factura pagada si fue suspensión manual) |
| `activo con saldo` | Todas las facturas pagadas + `credit_balance_cents > 0` |

> Estos son **estados calculados** por el service al consultar; `clients.status` solo guarda
> `active | suspended | lead | baja`. El estado financiero no muta `clients.status` directamente
> excepto la suspensión.

---

## 5. Reglas de negocio

### 5.1 Pago parcial
- Se acepta un pago menor al saldo pendiente de la factura.
- `invoice.applied_cents += payment.amount_cents`.
- `invoice.status` permanece `unpaid` o `overdue` (con `balance_cents > 0`).
- Visualmente: estado `partial` (label UI, no campo DB).

### 5.2 Pago completo
- `balance_cents = 0` → `invoice.status = 'paid'`.
- Si la factura tenía CFDI pendiente → `cfdi_status = 'generated'` (en el futuro, dispara el PAC).
- Si el cliente estaba `suspended` y no quedan facturas `overdue` → reactivar (ver §5.7).

### 5.3 Pago adelantado (anticipo)
- Se registra como `payment` vinculado al cliente (sin `payment_application` inmediata).
- El excedente se acumula en `clients.credit_balance_cents`.
- Al generar la siguiente factura, el service puede aplicar el crédito automáticamente.

### 5.4 Pago con sobrepago (overpayment)
- `payment.amount_cents > invoice.balance_cents`:
  - Se aplica lo necesario a la factura (`payment_application`).
  - El excedente se suma a `clients.credit_balance_cents`.
- Opción alternativa: crear `credit_note` por el overpayment.

### 5.5 Saldo a favor (credit balance)
- `clients.credit_balance_cents > 0`.
- Al crear nueva factura, el service puede aplicar automáticamente el saldo:
  - Crea `credit_application` con `min(credit_balance_cents, invoice.balance_cents)`.
  - Reduce `credit_balance_cents` proporcionalmente.

### 5.6 Nota de crédito
- Emitida cuando: factura cancelada con pagos, ajuste negativo aprobado, quita comercial.
- `credit_note.amount_cents` disponible para aplicar a futuras facturas del mismo cliente.
- No se mezcla con `credit_balance_cents`; son conceptos separados:
  - `credit_balance_cents`: overpayment de efectivo.
  - `credit_notes`: crédito contable formalizado (puede generar CFDI de egreso).

### 5.7 Ajuste manual
- **Cargo extra:** `adjustments.amount_cents > 0` → suma al `total_cents` de la factura.
- **Descuento/quita:** `adjustments.amount_cents < 0` → reduce el `total_cents`.
- Requiere `reason` y `created_by`.
- Solo `super admin` y `administrador` pueden crear ajustes.

### 5.8 Reactivación por pago
**Condiciones para reactivación automática:**
1. `SUSPENSION_POLICY.allowAutoReactivateOnPayment = true`.
2. El cliente estaba `suspended`.
3. Después de aplicar el pago, **no quedan facturas `overdue`** para ese cliente.
4. La suspensión fue por morosidad (source: `automation` o `manual` con reason de cobranza).

**Proceso:**
1. `POST /api/billing/invoices/:id/pay` → `payment_application` → `invoice.status = 'paid'`.
2. Service verifica: ¿quedan `overdue` para el cliente?
3. Si no quedan → emite evento `CLIENT_REACTIVATED` (desacoplado del billing service).
4. Suspension service escucha el evento → `client.status = 'active'` + logs.
5. (Futuro) MikroTik service escucha el evento → desbloquea PPPoE.

> El acoplamiento actual (billing/routes.ts muta directamente `client.status`) se
> reemplaza por eventos internos o un método en el service de suspensión.

### 5.9 Cancelación de factura
- Solo facturas en `unpaid`, `overdue` o `partial` pueden cancelarse.
- Las facturas `paid` requieren emitir nota de crédito (no se cancelan directamente).
- Al cancelar:
  - `invoice.status = 'canceled'`, `invoice.canceled_at = NOW()`.
  - Si tenía pagos parciales → `credit_note` por el monto pagado.
  - Si tenía CFDI generado → proceso de cancelación SAT (Fase 4.9).

---

## 6. Diseño de suspensiones

### 6.1 Tipos de suspensión

| Tipo | Disparador | Reversión |
|------|------------|-----------|
| **Por cobranza (automática)** | `suspension/run` detecta factura overdue + beyond grace | Automática al pagar, o manual |
| **Manual por operador** | `POST /api/suspension/clients/:id/suspend` | Manual por operador |
| **Preventiva** | Operador suspende sin factura vencida (baja solicitada, fraude) | Manual |

### 6.2 Lógica de `suspension_run`

```
PARA CADA cliente activo (no lead, no baja):
  SI tiene factura overdue con (NOW - due_date) > graceDays:
    → suspender (source: automation)
  ELSE SI está suspended Y no tiene facturas overdue:
    SI allowAutoReactivateOnPayment:
      → reactivar (source: automation)
```

El `suspension_run` actualmente es manual (endpoint). En Fase 4.5 se convierte en
job periódico (cron en el backend o job externo).

### 6.3 Reactivación manual
- `POST /api/suspension/clients/:id/reactivate` con `reason`.
- No requiere que las facturas estén pagadas (es decisión operativa).
- Registra `SuspensionActionLog` con `source: 'manual'`.

### 6.4 Reactivación automática
- Disparada por el evento `INVOICE_FULLY_PAID` del billing service.
- Condición: no quedan facturas `overdue` para el cliente.
- Registra `SuspensionActionLog` con `source: 'automation'`.

### 6.5 Tabla `suspension_action_logs` (ya existe)

Compatible con el diseño actual; solo agregar índices:

```sql
CREATE INDEX idx_sus_logs_client ON public.suspension_action_logs (client_id);
CREATE INDEX idx_sus_logs_date   ON public.suspension_action_logs (created_at);
```

---

## 7. Reportes financieros

### 7.1 Ingresos diarios
```sql
SELECT
  DATE(payment_date) AS day,
  method,
  COUNT(*) AS payments_count,
  SUM(amount_cents) / 100.0 AS total_mxn
FROM public.payments
WHERE status = 'confirmed'
  AND payment_date BETWEEN :start AND :end
GROUP BY day, method
ORDER BY day DESC;
```

### 7.2 Ingresos mensuales (MRR)
```sql
SELECT
  DATE_TRUNC('month', payment_date) AS month,
  SUM(amount_cents) / 100.0 AS collected_mxn,
  COUNT(DISTINCT client_id) AS paying_clients
FROM public.payments
WHERE status = 'confirmed'
GROUP BY month
ORDER BY month DESC;
```

### 7.3 Cuentas por cobrar (CxC) por antigüedad

```sql
SELECT
  CASE
    WHEN NOW() - due_date <= INTERVAL '30 days'  THEN '0-30 dias'
    WHEN NOW() - due_date <= INTERVAL '60 days'  THEN '31-60 dias'
    WHEN NOW() - due_date <= INTERVAL '90 days'  THEN '61-90 dias'
    ELSE '90+ dias'
  END AS bucket,
  COUNT(*) AS invoices,
  SUM(balance_cents) / 100.0 AS balance_mxn
FROM public.invoices
WHERE status IN ('unpaid', 'overdue')
GROUP BY bucket;
```

### 7.4 Clientes vencidos / morosos

```sql
SELECT
  c.id, c.full_name, c.status AS client_status,
  COUNT(i.id) AS overdue_invoices,
  SUM(i.balance_cents) / 100.0 AS total_pending_mxn,
  MAX(NOW() - i.due_date) AS max_days_overdue
FROM public.clients c
JOIN public.invoices i ON i.client_id = c.id
WHERE i.status IN ('unpaid', 'overdue')
GROUP BY c.id, c.full_name, c.status
ORDER BY max_days_overdue DESC;
```

### 7.5 Flujo de caja proyectado

```sql
SELECT
  due_date AS expected_date,
  SUM(balance_cents) / 100.0 AS expected_mxn,
  COUNT(*) AS invoices_count
FROM public.invoices
WHERE status IN ('unpaid', 'overdue')
GROUP BY due_date
ORDER BY due_date;
```

### 7.6 Resumen de colección por método

```sql
SELECT
  method,
  COUNT(*) AS transactions,
  SUM(amount_cents) / 100.0 AS total_mxn
FROM public.payments
WHERE status = 'confirmed'
  AND payment_date >= DATE_TRUNC('month', NOW())
GROUP BY method;
```

---

## 8. RBAC financiero

| Acción | Super Admin | Administrador | Cobranza | Técnico | Soporte | Solo lectura |
|--------|:-----------:|:-------------:|:--------:|:-------:|:-------:|:------------:|
| Ver facturas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ver estado de cuenta | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ver reportes financieros | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Exportar reportes | ✓ | ✓ | ✓ | — | ✓ | — |
| Crear factura manual | ✓ | ✓ | ✓ | — | — | — |
| Editar factura | ✓ | ✓ | ✓ | — | — | — |
| Cancelar factura | ✓ | ✓ | — | — | — | — |
| Registrar pago | ✓ | ✓ | ✓ | — | — | — |
| Aplicar crédito | ✓ | ✓ | ✓ | — | — | — |
| Emitir nota de crédito | ✓ | ✓ | — | — | — | — |
| Ajuste manual (cargo) | ✓ | ✓ | — | — | — | — |
| Ajuste manual (descuento) | ✓ | — | — | — | — | — |
| Suspender cliente | ✓ | ✓ | ✓ | — | — | — |
| Reactivar cliente | ✓ | ✓ | ✓ | — | — | — |
| Ver logs suspensión | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Editar política suspensión | ✓ | ✓ | — | — | — | — |
| Ejecutar regla automática | ✓ | ✓ | ✓ | — | — | — |
| Ver ingresos diarios/mensuales | ✓ | ✓ | ✓ | — | — | — |

**Acciones nuevas que requieren `action-permissions.ts`:**
- `billing.invoice.cancel`
- `billing.payment.register`
- `billing.credit.apply`
- `billing.creditnote.create`
- `billing.adjustment.create`

---

## 9. Índices y restricciones clave

```sql
-- Factura: no se puede pagar más de lo que vale
-- (validado en service; opcional trigger para consistencia eventual)
-- invoices.applied_cents + credit_applied_cents <= invoices.total_cents

-- Pagos idempotentes
ALTER TABLE public.payments
  ADD CONSTRAINT uq_payment_idempotency UNIQUE (idempotency_key);

-- No duplicar aplicación de un pago a una factura
ALTER TABLE public.payment_applications
  ADD CONSTRAINT uq_pa UNIQUE (payment_id, invoice_id);

-- Índices críticos para reportes
CREATE INDEX idx_payments_date_method ON public.payments (payment_date, method);
CREATE INDEX idx_inv_balance ON public.invoices (balance_cents) WHERE balance_cents > 0;
CREATE INDEX idx_inv_overdue ON public.invoices (due_date) WHERE status IN ('unpaid', 'overdue');
```

---

## 10. Riesgos

| Riesgo | Severidad | Mitigation |
|--------|:---------:|------------|
| Migración de `invoice.payments[]` a tabla `payments` | 🔴 | Script de migración idempotente; datos mock son 5 facturas |
| `amount` en pesos float → `amount_cents` entero | 🔴 | Mapper multiplica/divide por 100; contrato v1 sigue en pesos |
| Columna calculada `balance_cents` requiere PG >= 12 | 🟡 | Supabase usa PG 15; sin riesgo |
| Efectos cruzados: billing ↔ customers ↔ suspension | 🔴 | Desacoplar con eventos internos; migrar en orden |
| Sin cron en backend para `suspension_run` | 🟡 | Usar `pg_cron` (Supabase lo soporta) o job externo |
| CFDI real requiere PAC (proveedor autorizado SAT) | 🟠 | Independiente; Fase 4.9 con integración PAC |
| `credit_balance_cents` en `clients` requiere migración | 🟡 | `ALTER TABLE` simple; sin perder datos |
