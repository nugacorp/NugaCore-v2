# MIKROTIK WORKER AUDIT — Fase 4.6 (Read Only + Dry Run)

Fecha: 2026-06-05
Alcance: auditar lo necesario para construir el **Worker MikroTik** en modo
**solo lectura + dry-run**. El worker consume las ÓRDENES del Motor de
Suspensiones (4.5) y las procesa SIN ejecutar cortes reales, SIN mutar el
estado de red del cliente. Lecturas RouterOS reales de solo lectura cuando el
router tenga credenciales; si no, salida simulada.

Commit base: `32c806a`.

## 1. Qué ya existe

| Pieza | Estado |
|---|---|
| Registro de routers | `store.MIKROTIK_ROUTERS` (id, name, ipAddress/managementIp, apiPort, username, **encryptedPassword**, connectionType, vpnIp, provisioningStatus). |
| Credenciales cifradas | `backend/services/crypto.ts` (`encryptSecret`/`decryptSecret`, AES-256-GCM). |
| Lecturas simuladas | `GET /api/mikrotik/routers/:id/read/{interfaces,queues,ppp}` → `getSimulatedCommandOutput()`. |
| Órdenes | Motor 4.5 emite `suspension_orders`/`reactivation_orders` en `PENDING` (repo Store/Supabase, `SuspensionRepository.listOrders/openOrders/createOrder`). |
| Redacción de secretos | `backend/common/secret-redaction.ts`. |

## 2. Qué falta (a construir en 4.6)

1. **Conector RouterOS** read-only: real (API binaria sobre TCP) cuando hay credenciales + flag `MIKROTIK_WORKER_LIVE=true`; simulado por defecto y como fallback.
2. **Worker** que:
   - Toma las órdenes `PENDING` (suspensión/reactivación).
   - Las procesa en **DRY-RUN**: registra el plan (qué comandos se ejecutarían) + un snapshot read-only del router; marca la orden con `dryRun=true` y avanza su ciclo (PENDING→QUEUED→EXECUTED) **sin** tocar el router ni `client.status`.
   - Deja un **run log** (auditable).
3. **Endpoints**: `POST /api/mikrotik/worker/run`, `GET /api/mikrotik/worker/runs`, `GET /api/mikrotik/routers/:id/worker/read`.
4. **UI**: panel "Worker (dry-run)" en el módulo MikroTik.
5. **Persistencia**: columnas `dry_run`/`worker_run_id` en las tablas de órdenes (migración idempotente).

## 3. Reglas de seguridad de esta fase

- **Solo lectura**: el conector real únicamente emite comandos `*/print` (allowlist). Cualquier comando fuera de la allowlist se rechaza.
- **Dry-run**: el worker NO envía comandos de corte/reactivación. NO cambia `client.status`. NO empuja a `MIKROTIK_LOGS` como si hubiera cortado.
- **Gating**: conexión real solo si `MIKROTIK_WORKER_LIVE=true` Y el router tiene credenciales; si no, simulado. Timeouts cortos + fallback.
- **Secretos**: el password se descifra solo en memoria para autenticar; nunca se loguea (se redacta). El run log no guarda credenciales ni el script.
- **Idempotencia**: el worker solo toma órdenes `PENDING`; una orden ya procesada (EXECUTED) no se reprocesa.

## 4. Integración con órdenes

- Lee `getSuspensionService().repo.listOrders({ status: 'PENDING' })`.
- Necesita `SuspensionRepository.updateOrder(order, patch)` (status/executedAt/dryRun/workerRunId) → se añade a la interfaz (Store + Supabase) + `engineStore.updateOrder`.
- El cambio de estado físico real (cortar/reactivar en el router + mover `client.status`) queda para **Fase 4.7** (worker en modo commit). Aquí TODO es dry-run.

## 5. Conector RouterOS (real, read-only)

- Implementación propia mínima del **protocolo API de RouterOS** sobre `net.Socket` (sin dependencias externas): login (plain v6.43+ con fallback challenge MD5), envío de sentencias con palabras length-prefixed, parseo de respuestas `!re`/`!done`/`!trap`.
- Allowlist de comandos: `/system/resource/print`, `/interface/print`, `/queue/simple/print`, `/ppp/secret/print`, `/ppp/active/print`, `/ip/address/print`.
- Timeout corto (p.ej. 4s); cualquier error → fallback a simulado con nota.
- Gateado por `MIKROTIK_WORKER_LIVE`. En tests (hermético) y sin routers reachable, siempre simulado.

## 6. Riesgos

- El cliente RouterOS real no se puede validar sin un router alcanzable; va gateado OFF + fallback, a validar por Hermes en staging con un router en la VPN.
- Marcar `EXECUTED(dry_run)` consume la orden para el worker; para revalidar se crean nuevas órdenes (test-tools). El worker real de 4.7 operará sobre órdenes nuevas o un reset.
