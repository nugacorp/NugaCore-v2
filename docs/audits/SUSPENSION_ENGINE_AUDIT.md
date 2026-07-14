# SUSPENSION ENGINE AUDIT — Fase 4.5 (Tarea 1)

Fecha: 2026-06-05
Alcance: auditar lo existente antes de construir el **Motor de Suspensiones**
(el "cerebro" que decide y emite ÓRDENES). NO toca MikroTik, NO ejecuta acciones,
NO conecta routers.

Commit base validado por Hermes: `9acfadb`.

## 1. Superficie revisada

| Archivo | Rol actual |
|---|---|
| `backend/domains/suspension/routes.ts` | Suspensión "legacy": **ejecuta** directamente (muta `client.status`, empuja a `MIKROTIK_LOGS`, alertas, timeline). |
| `backend/domains/billing/*` | Genera facturas/pagos; computa `status` de factura (`paid/unpaid/overdue/canceled`). |
| `backend/domains/customers/*` | Clientes con `status: active | suspended | lead | baja`. |
| `backend/domains/plans/*` | Catálogo de planes (precio → MRR). |
| `backend/state/store.ts` | `SUSPENSION_POLICY` (enabled, graceDays, allowAutoReactivateOnPayment), `SUSPENSION_ACTION_LOGS`, `CLIENTS`, `INVOICES`. |
| `backend/domains/automations/routes.ts` | Reglas de automatización (vencimiento/pago) — declarativas, no ejecutan suspensión. |
| `backend/domains/dashboard/routes.ts` | KPIs ejecutivos (incluye `suspendedClients`). |
| `src/components/FinanceOwnerModule.tsx` | Simulador de portal; no es motor. |

## 2. Lógica existente (reglas)

- **Política actual** (`store.SUSPENSION_POLICY`): `enabled`, `graceDays=3`, `allowAutoReactivateOnPayment=true`.
- **`hasOverdueBalanceBeyondGrace(clientId)`**: factura `overdue` cuyo `dueDate` + graceDays ya pasó.
- **`POST /api/suspension/run`**: recorre clientes; si moroso fuera de gracia → **suspende ya** (muta estado); si suspendido y sin overdue abierto y `allowAutoReactivate` → **reactiva ya**.
- **`POST /clients/:id/suspend` / `/reactivate`**: acciones manuales que **mutan estado** y registran log/alerta/timeline.

## 3. Lógica duplicada / deuda técnica

- **Billing reactiva al pagar** (efecto cruzado en `billing/routes.ts`, solo modo mock): al registrar pago, si el cliente estaba `suspended` y `allowAutoReactivateOnPayment`, lo **reactiva** y empuja a `MIKROTIK_LOGS`. → Es ejecución de reactivación viviendo en Billing. La filosofía 4.5 dice: **Billing no suspende/reactiva; solo genera eventos financieros**. Esta lógica deberá migrar al motor + worker en una fase futura (NO se elimina ahora para no romper contrato; se documenta como deuda).
- **El "motor" actual ejecuta** (muta `client.status`) en lugar de **emitir órdenes**. Mezcla decisión + ejecución.
- **Reglas de automatización** (`AUTOMATION_RULES`) describen intención pero no se enlazan a un motor real.
- **No hay** estado de servicio por cliente (`customer_service_state`), ni órdenes (`suspension_orders` / `reactivation_orders`), ni eventos tipados (`suspension_events`).

## 4. Estados actuales

- `Client.status`: `active | suspended | lead | baja` (verdad de red, mutada por el legacy).
- `Invoice.status`: `paid | unpaid | overdue | canceled` + `paidAmount`/`pendingAmount` (de Fase 4.3).
- No existe `ServiceStatus` ni `BillingStatus` separados del estado de red.

## 5. Jobs / schedulers / historial existentes

- **Jobs/schedulers**: no hay cron real; `POST /suspension/run` es disparado manualmente. (En MikroTik el scheduler vive en el router, no aquí.)
- **Historial**: `SUSPENSION_ACTION_LOGS` (suspend/reactivate/rule-scan) + `CLIENT_TIMELINE` (status_change). Útiles pero no responden "qué factura lo provocó" de forma estructurada.

## 6. Puntos de integración

- **Entrada**: `store.INVOICES` (vencimiento/saldo) + `store.CLIENTS` (estado de red) + política.
- **Salida del motor (nuevo)**: `suspension_orders` / `reactivation_orders` en estado `PENDING` → las consumirá el **Worker MikroTik** (fase futura). El motor **no** ejecuta.
- **Dashboard**: `dashboard-stats` puede recibir KPIs nuevos (el contrato solo exige presencia de ciertas claves; añadir es seguro).
- **Frontend**: nuevo tab `suspension` (RBAC en `src/lib/rbac.ts`, Sidebar, App).

## 7. Decisiones de diseño (Tareas 2–12)

1. **No romper** los endpoints legacy de suspensión (sin tests de contrato, pero usados): se **añaden** los nuevos (`/policies`, `/customers`, `/orders`, `/events`, `/evaluate/:id`, `/evaluate-all`) junto a los existentes.
2. **El motor decide y emite órdenes**; NO muta `client.status` ni toca MikroTik. El cambio físico de estado lo hará el Worker (fase 4.6).
3. **Persistencia**: migración `supabase/migrations/20260605120000_suspension_engine.sql` (5 tablas + RLS deny-by-default), idempotente. **No se activa** (`USE_DB_SUSPENSION=false`); el motor corre sobre store en memoria.
4. **Idempotencia**: no duplicar órdenes abiertas (PENDING/QUEUED) por cliente; eventos solo en cambio de estado.
5. **Estados nuevos**: `ServiceStatus` (ACTIVE/WARNING/PENDING_SUSPENSION/SUSPENDED/PENDING_REACTIVATION) y `BillingStatus` (CURRENT/DUE_SOON/OVERDUE/DELINQUENT) separados del estado de red.
6. **Política default**: grace_days=3, suspend_after_due=true, reactivate_on_payment=true, reactivate_on_partial_payment=false, auto_reactivate=true.
7. **RBAC**: SA/Admin → todo; Cobranza → ver + evaluar; Técnico → ver; Solo lectura → ver.
8. **Auditoría**: cada orden/transición registra evento con `customer_id`, `invoice_id`, `reason`, `actor_id`, `automatic`, timestamp → responde quién/por qué/qué factura/cuándo.
