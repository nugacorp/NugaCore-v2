# Fase 4.8 — Payment Engine + Reactivación Automática

> Estado: **PLANIFICADA — No iniciada. No implementada. No validada.**
> Última actualización: 2026-06-12
> Relacionado: [BILLING_ROADMAP.md](./BILLING_ROADMAP.md) · [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) · [NUGACORE_ROADMAP.md](./NUGACORE_ROADMAP.md)

---

## Objetivo

Permitir que un cliente final consulte sus facturas, pague desde el portal (con proveedor real o confirmación manual), y reactive su servicio de internet automáticamente — sin intervención manual del operador — dejando auditoría completa de cada paso.

---

## Dependencias previas (todas completadas)

| Fase | Artefacto necesario |
|------|---------------------|
| **4.1** ✅ | Tablas `payments`, `invoices`, `service_subscriptions` |
| **4.2** ✅ | `BillingRepository` + `BillingService` con `USE_DB_BILLING` |
| **4.5** ✅ | Suspension Engine — genera `SuspensionOrder` de corte |
| **4.6** ✅ | WireGuard Manager + MikroTik Provisioning |
| **4.7** ✅ | Router Enrollment — routers enrolados y activos en DB |

---

## Subfases

### 4.8.1 — Payment Database

**Objetivo:** definir el esquema de base de datos para el motor de pagos.

**Entregables esperados:**

- Migración SQL con tablas:

```
payment_orders
  id                TEXT        PRIMARY KEY
  customer_id       TEXT        NOT NULL
  invoice_id        TEXT        NOT NULL
  provider          TEXT        NOT NULL   -- manual | mercado_pago | openpay | spei
  amount            NUMERIC     NOT NULL
  currency          TEXT        NOT NULL   DEFAULT 'MXN'
  status            TEXT        NOT NULL   DEFAULT 'pending'
                                           -- pending | confirmed | failed | refunded | cancelled
  external_ref      TEXT                   -- ID externo del proveedor
  external_url      TEXT                   -- URL de pago (si aplica)
  idempotency_key   TEXT        UNIQUE      -- previene duplicados
  created_by        TEXT        NOT NULL
  created_at        TIMESTAMPTZ NOT NULL   DEFAULT now()
  updated_at        TIMESTAMPTZ NOT NULL   DEFAULT now()

payment_events
  id                TEXT        PRIMARY KEY
  order_id          TEXT        NOT NULL   REFERENCES payment_orders(id)
  provider          TEXT        NOT NULL
  event_type        TEXT        NOT NULL   -- payment.approved | payment.rejected | refund | etc.
  raw_payload       JSONB
  signature_valid   BOOLEAN     NOT NULL
  processed         BOOLEAN     NOT NULL   DEFAULT false
  processed_at      TIMESTAMPTZ
  created_at        TIMESTAMPTZ NOT NULL   DEFAULT now()

mikrotik_actions
  id                TEXT        PRIMARY KEY
  customer_id       TEXT        NOT NULL
  router_id         TEXT
  action_type       TEXT        NOT NULL   -- disable | enable | reactivate
  triggered_by      TEXT        NOT NULL   -- webhook | manual | suspension_engine
  status            TEXT        NOT NULL   -- pending | success | failed
  executed_at       TIMESTAMPTZ
  result_payload    JSONB
  created_at        TIMESTAMPTZ NOT NULL   DEFAULT now()
```

- RLS deny-by-default en las 3 tablas
- Índices sobre: `payment_orders(customer_id)`, `payment_orders(status)`, `payment_events(order_id)`, `payment_events(processed)`, `mikrotik_actions(customer_id)`, `mikrotik_actions(status)`
- Feature flag `USE_DB_PAYMENT_ENGINE`

**Criterio de cierre:** `npx tsc --noEmit` limpio + migración aplicada en staging sin errores.

---

### 4.8.2 — Payment Providers (abstracción + adaptadores)

**Objetivo:** interfaz común que soporte múltiples proveedores de pago.

**Interfaz prevista:**

```typescript
interface PaymentProviderInterface {
  name: PaymentProviderName;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  getOrderStatus(externalRef: string): Promise<OrderStatusResult>;
  refund(externalRef: string, amount: number): Promise<RefundResult>;
  validateWebhookSignature(payload: Buffer, headers: Record<string, string>): boolean;
}

type PaymentProviderName = 'manual' | 'mercado_pago' | 'openpay' | 'spei_future';
```

**Adaptadores esperados:**

| Adaptador | Descripción |
|-----------|-------------|
| `ManualProvider` | Operador confirma manualmente; no integración externa |
| `MercadoPagoProvider` | API v2 MercadoPago + webhooks HMAC-SHA256 |
| `OpenPayProvider` | API OpenPay + webhooks x-openpaymex-signature |
| `SpeiProvider` _(futuro)_ | SPEI vía CLABE; confirmación por referencia bancaria |

**Criterio de cierre:** tests unitarios para `ManualProvider` + mocks de `MercadoPagoProvider` y `OpenPayProvider`; TypeScript estricto; sin credenciales hardcodeadas.

---

### 4.8.3 — Webhooks (endpoints + validación de firma)

**Objetivo:** recibir y procesar eventos de pago desde proveedores externos.

**Endpoints esperados:**

```
POST /api/payment-engine/webhooks/mercado_pago
POST /api/payment-engine/webhooks/openpay
POST /api/payment-engine/webhooks/manual
```

**Requisitos de seguridad:**

- Validación de firma antes de procesar (rechazar 401 si firma inválida)
- Registro inmediato en `payment_events` (raw_payload + signature_valid) antes de procesar
- Idempotencia: si `event_type` + `external_ref` ya está procesado → responder 200 sin reprocesar
- No bloquear: el webhook responde 200 en < 2 s; el procesamiento real se encola

**Criterio de cierre:** tests de contrato que verifiquen:
- Firma válida → `payment_events.processed = true`
- Firma inválida → 401 + registro con `signature_valid = false`
- Evento duplicado → 200 sin nuevo registro en `payment_events`

---

### 4.8.4 — Billing Integration (conciliación pago → factura → suscripción)

**Objetivo:** aplicar el pago confirmado al estado del cliente en el sistema de billing.

**Flujo de conciliación:**

```
payment_event confirmado
  └→ payment_orders.status = 'confirmed'
    └→ BillingService.applyPayment(orderId)
        ├─ payment.status = 'confirmed'
        ├─ invoice aplicada (payment_allocations)
        ├─ invoice.status = 'paid' (si saldo cubierto)
        ├─ service_subscription.status = 'active'
        └─ customer.status = 'active'
              └→ emitir evento: CustomerReactivated
```

**Criterio de cierre:** test de integración end-to-end: webhook → conciliación → cliente activo. Idempotente: aplicar el mismo pago dos veces no duplica allocations.

---

### 4.8.5 — Reactivación MikroTik (idempotente + auditoría)

**Objetivo:** reactivar el acceso de red del cliente tras confirmar el pago.

**Flujo:**

```
CustomerReactivated (evento interno)
  └→ MikrotikReactivationService
      ├─ buscar routers activos del cliente (enrollment status='online')
      ├─ crear mikrotik_actions(action_type='enable', status='pending')
      ├─ encolar comando en Worker MikroTik
      └─ Worker ejecuta PPPoE enable (o equivalente)
           └─ mikrotik_actions.status = 'success' | 'failed'
                └─ reintentos si falla (máx 3, backoff exponencial)
```

**Garantías requeridas:**

- Idempotente: si el router ya está activo → no lanzar error, registrar como no-op
- Auditoría: cada acción queda en `mikrotik_actions` con resultado y timestamp
- El fallo de reactivación MikroTik NO revierte la conciliación de pago (son independientes)

**Criterio de cierre:** tests unitarios con mocks de Worker MikroTik. Log de `mikrotik_actions` poblado correctamente en todos los caminos (success / failed / idempotent).

---

### 4.8.6 — Portal Cliente (self-service UI)

**Objetivo:** UI de autoservicio para que el cliente consulte y pague sus facturas.

**Vistas previstas:**

- **Resumen de cuenta:** saldo pendiente, próximo vencimiento, estado del servicio
- **Historial de facturas:** lista paginada con estado y botón de pago
- **Iniciar pago:** selector de proveedor → redirige a proveedor externo o muestra instrucciones SPEI
- **Estado del pago:** polling del `payment_orders.status` con feedback visual
- **Confirmación:** "Servicio reactivado" o "Pago recibido, pendiente de confirmación"

**RBAC previsto:**

- Ruta protegida por rol `cliente` (nuevo rol)
- Solo puede ver sus propias facturas y órdenes
- No puede ver datos de otros clientes

**Criterio de cierre:** tests de UI (al menos golden path: ver factura → iniciar pago → confirmar reactivación). Sin regresión visual en módulos existentes.

---

### 4.8.7 — Seguridad y Auditoría

**Objetivo:** garantizar que el motor de pagos sea seguro, trazable e idempotente.

**Requerimientos:**

| Requisito | Mecanismo |
|-----------|-----------|
| Sin secrets en código | Variables de entorno: `MERCADOPAGO_SECRET_KEY`, `OPENPAY_API_KEY`, `PAYMENT_WEBHOOK_SECRET` |
| Idempotencia en órdenes | `payment_orders.idempotency_key UNIQUE` |
| Idempotencia en eventos | `payment_events(order_id, event_type)` índice único donde `processed = true` |
| Firma de webhook | `crypto.timingSafeEqual` para comparación de HMAC |
| Auditoría de todas las transiciones | `payment_events` raw + procesado + timestamp |
| RBAC granular | Operador vs. cliente vs. sistema (webhook sin auth de usuario) |
| Rate limiting en webhooks | 1000 req/min por IP de proveedor (IPs de MercadoPago/OpenPay whitelisted) |
| No exponer datos de pago en logs | `sanitizePaymentLog()` antes de `logger.*` |

**Criterio de cierre:** checklist de seguridad completo antes de habilitar `USE_DB_PAYMENT_ENGINE = true` en staging.

---

## Orden de ejecución recomendado

```
4.8.1 (schema)
  ├─ 4.8.7 (seguridad — diseñar junto al schema)
  └─ 4.8.2 (providers)
       └─ 4.8.3 (webhooks)
            └─ 4.8.4 (billing integration)
                 └─ 4.8.5 (reactivación MikroTik)
                      └─ 4.8.6 (portal cliente)
```

La subfase 4.8.7 no es un bloque final de "agregar seguridad" — sus requisitos deben influir el schema (4.8.1) y la abstracción de proveedores (4.8.2) desde el inicio.

---

## Riesgos e incertidumbres

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|:------------:|:-------:|------------|
| API de MercadoPago cambia firma de webhook | Baja | Alto | Abstraer verificación; tests con fixtures reales |
| Duplicación de webhooks (reenvío del proveedor) | Alta | Medio | Idempotencia por `idempotency_key` + `payment_events` deduplicado |
| Fallo de reactivación MikroTik tras pago confirmado | Media | Alto | Reintentos + alertas al operador; pago y red son independientes |
| Cliente paga pero factura no existe (timing) | Baja | Alto | Validar `invoice_id` antes de crear `payment_order` |
| Rol "cliente" introduce superficie de ataque nueva | Alta | Alto | RBAC estricto; cliente solo lee sus propios recursos; tests de RBAC |
| Proveedor rechaza pago por duplicado (mismo monto/ref) | Media | Bajo | Redirigir al cliente a la misma `external_url` si orden ya existe |

---

## Criterio de validación para Hermes

Para someter Fase 4.8 a revisión:

1. `npx tsc --noEmit` → 0 errores
2. `npm test` → 0 failed (tests nuevos de Fase 4.8 incluidos)
3. `npx vite build` → build limpio
4. Checklist de seguridad 4.8.7 completado
5. Webhooks probados con payloads reales de sandbox (MercadoPago + OpenPay)
6. Flujo end-to-end: cliente paga → factura pagada → cliente activo → router reactivado
7. Sin regresión en módulos de Fases 4.1–4.7

---

## Estimación de esfuerzo (orientativa)

| Subfase | Estimación |
|---------|-----------|
| 4.8.1 Payment Database | 1 sesión |
| 4.8.2 Payment Providers | 2 sesiones |
| 4.8.3 Webhooks | 1 sesión |
| 4.8.4 Billing Integration | 1 sesión |
| 4.8.5 Reactivación MikroTik | 1 sesión |
| 4.8.6 Portal Cliente | 2–3 sesiones |
| 4.8.7 Seguridad y Auditoría | Transversal (no bloquea) |
| **Total estimado** | **8–10 sesiones** |

Estimación sujeta a complejidad real de integración con proveedores de pago y tiempo de acceso a cuentas sandbox.
