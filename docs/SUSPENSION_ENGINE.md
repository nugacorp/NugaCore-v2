# SUSPENSION ENGINE — Fase 4.5

Fecha: 2026-06-05
Estado: motor de decisión que **emite ÓRDENES**. NO ejecuta cortes, NO toca
MikroTik, NO conecta routers. El Worker MikroTik (fase 4.6) ejecutará.

Auditoría: [SUSPENSION_ENGINE_AUDIT.md](SUSPENSION_ENGINE_AUDIT.md).

## 1. Arquitectura

```
Factura vencida ─┐                         Pago aplicado ─┐
                 ▼                                        ▼
        Motor de Suspensiones  ──── decide ────  Motor de Suspensiones
                 │                                        │
                 ▼                                        ▼
          SuspensionOrder                         ReactivationOrder   (status: PENDING)
                 │                                        │
                 └──────────────► Worker MikroTik ◄───────┘   (Fase 4.6)
                                        │
                                        ▼
                                     Router
```

- **Billing** genera eventos financieros (facturas/pagos). **No** suspende.
- **El Motor** lee facturas + estado de red + política y **decide**: emite órdenes y eventos, actualiza el estado de servicio por cliente.
- **El Worker** (futuro) consumirá las órdenes `PENDING` y ejecutará el corte/reactivación en el router; recién entonces cambia el estado físico.

Componentes (`backend/domains/suspension/`):
- `types.ts` — enums + interfaces + política por defecto.
- `engine-store.ts` — estado en memoria (política, estado por cliente, eventos, órdenes).
- `engine.ts` — decisiones puras + evaluación con efectos.
- `routes.ts` — endpoints (legacy + motor).

Persistencia: `supabase/migrations/20260605120000_suspension_engine.sql` (5 tablas + RLS). **No activa** (`USE_DB_SUSPENSION=false`); el motor corre en memoria.

## 2. Estados

**ServiceStatus** (decisión del motor): `ACTIVE`, `WARNING`, `PENDING_SUSPENSION`, `SUSPENDED`, `PENDING_REACTIVATION`.

**BillingStatus** (derivado de facturas): `CURRENT`, `DUE_SOON`, `OVERDUE`, `DELINQUENT`.

**OrderStatus**: `PENDING`, `QUEUED`, `EXECUTED`, `FAILED`, `CANCELLED`.

### Reglas de transición (cliente serviceable)
| Red | Cobranza | Decisión | Acción |
|---|---|---|---|
| active | CURRENT / DUE_SOON | ACTIVE | — |
| active | OVERDUE (dentro de gracia) | WARNING | — |
| active | DELINQUENT (fuera de gracia) + `suspendAfterDue` | PENDING_SUSPENSION | crea SuspensionOrder |
| suspended | regularizado (CURRENT/DUE_SOON) + `autoReactivate`+`reactivateOnPayment` | PENDING_REACTIVATION | crea ReactivationOrder |
| suspended | pago parcial + `reactivateOnPartialPayment` | PENDING_REACTIVATION | crea ReactivationOrder |
| suspended | saldo pendiente | SUSPENDED | — |
| (cualquiera) | política `enabled=false` | refleja red | — |

`BillingStatus` agrega la **peor** factura abierta: `delinquent` si `hoy - vencimiento ≥ grace_days`; `overdue` si ya venció (dentro de gracia); `due_soon` si vence dentro de `dueSoonDays`; si no, `current`.

## 3. Órdenes

- Se crean en estado `PENDING` con `source='engine'`, `reason`, `invoiceId` (la factura que lo provocó).
- **Idempotencia**: no se crea una orden si ya existe una abierta (`PENDING`/`QUEUED`) del mismo tipo para el cliente.
- Al crear una orden de suspensión se **cancelan** las de reactivación abiertas del cliente (intención opuesta) y viceversa.
- El motor **nunca** marca `EXECUTED`: eso lo hará el Worker.

## 4. Eventos / auditoría

Cada acción registra un `SuspensionEvent` con `customerId`, `invoiceId`, `eventType`, `reason`, `automatic`, `actorId`, `metadata`, `createdAt`. Tipos: `suspension_order_created`, `reactivation_order_created`, `state_changed`, `order_cancelled`.

Responde de forma estructurada:
- **¿Por qué suspendimos?** → `reason` del evento/orden + `billingStatus`.
- **¿Quién?** → `actorId` (o `automatic=true` si fue el motor).
- **¿Qué factura?** → `invoiceId`.
- **¿Cuándo?** → `createdAt`.

## 5. Política (defaults)

| Campo | Default | Significado |
|---|---|---|
| `enabled` | true | Motor activo. |
| `graceDays` | 3 | Días tras vencimiento antes de marcar DELINQUENT. |
| `suspendAfterDue` | true | Emitir corte al volverse moroso. |
| `reactivateOnPayment` | true | Reactivar al regularizar. |
| `reactivateOnPartialPayment` | false | Reactivar con pago parcial. |
| `autoReactivate` | true | Habilita la reactivación automática. |
| `dueSoonDays` | 3 | Ventana para marcar DUE_SOON. |

## 6. Endpoints

| Método | Ruta | RBAC |
|---|---|---|
| GET | `/api/suspension/policies` | SA/Admin/Cobranza/Téc/Solo lectura |
| PUT | `/api/suspension/policies` | SA/Admin |
| GET | `/api/suspension/customers` | ver (5 roles) |
| GET | `/api/suspension/orders` | ver |
| GET | `/api/suspension/events` | ver |
| POST | `/api/suspension/evaluate/:customerId` | SA/Admin/Cobranza |
| POST | `/api/suspension/evaluate-all` | SA/Admin/Cobranza |

Cobranza **no** se incluyó en "ver" por error: sí ve (es uno de los 5). **Soporte queda sin acceso**. KPIs en `GET /api/dashboard-stats` → `suspension`.

Endpoints **legacy** (sin cambios, ejecutan en mock): `/api/suspension/policy`, `/logs`, `/run`, `/clients/:id/suspend|reactivate`. Se conservan por compatibilidad; el motor nuevo es la fuente de verdad para decisiones.

## 7. UI

Módulo **Suspensiones & Cortes** (tab `suspension`):
- Columnas/KPIs: Activos, Advertencia, Por suspender, Suspendidos, Por reactivar.
- Lista de clientes con `billingStatus` + `serviceStatus` + razón + botón **Evaluar** (roles con permiso).
- **Evaluar toda la cartera** (genera órdenes).
- Panel **Órdenes pendientes**.
- Panel **Eventos recientes**.
- Panel **Política** (editable por SA/Admin).

Dashboard: KPIs `suspendedToday`, `reactivatedToday`, `morosos`, `pendingSuspension`, `pendingReactivation` (más active/warning/suspended). "Hoy" = órdenes creadas hoy (el motor emite; el Worker ejecutará).

## 8. Integración futura con el Worker MikroTik (Fase 4.6)

1. El Worker lee `suspension_orders` / `reactivation_orders` en `PENDING`.
2. Marca `QUEUED`, ejecuta el corte/reactivación vía API RouterOS (sobre la VPN, credenciales cifradas de Fase 4.4).
3. Marca `EXECUTED` (o `FAILED` con `errorMessage`) y actualiza el estado de red del cliente.
4. El motor reevalúa y refleja `SUSPENDED`/`ACTIVE` reales.

Hasta entonces, el motor deja todo **decidido y ordenado**; nada se ejecuta.

## 9. Riesgos

- Estado en memoria (se reinicia con el proceso) hasta activar `USE_DB_SUSPENSION`.
- Convivencia con la suspensión **legacy** que sí muta estado (deuda documentada): para producción debe quedar el motor como única fuente y el worker como único ejecutor.
- "Suspendidos/Reactivados hoy" cuentan **órdenes** creadas hoy, no ejecuciones reales (no hay worker).
- La reactivación automática de Billing al pagar (mock) sigue activa; al construir el worker debe centralizarse en el motor.
