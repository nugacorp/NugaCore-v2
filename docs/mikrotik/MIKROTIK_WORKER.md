# MIKROTIK WORKER — Fase 4.6 (Read Only + Dry Run)

Fecha: 2026-06-05
Estado: el Worker **consume las órdenes** del Motor de Suspensiones y las
procesa en **dry-run** (simulación), y hace **lecturas read-only** de routers.
**No ejecuta cortes/reactivaciones**, **no muta `client.status`**, **no envía
comandos destructivos**. La ejecución real queda para una fase posterior.

Auditoría: [MIKROTIK_WORKER_AUDIT.md](../audits/MIKROTIK_WORKER_AUDIT.md).

## 1. Arquitectura

```
Motor Suspensiones ── órdenes PENDING ──►  Worker MikroTik (4.6)
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                     ▼
              processPendingOrders     RouterConnector        worker run log
              (DRY-RUN: plan +         (read-only:            (auditable, en
               marca EXECUTED          simulado | API real    memoria)
               dry_run)                 RouterOS si live)
```

Módulo `backend/domains/mikrotik/worker/`:
- `types.ts` — allowlist de comandos read-only + tipos de run/resultado.
- `routeros-client.ts` — cliente mínimo del protocolo API RouterOS (net.Socket), **solo lectura**.
- `connector.ts` — `RouterConnector` (simulado por defecto; real read-only si `MIKROTIK_WORKER_LIVE=true` + credenciales; fallback a simulado).
- `worker.ts` — `processPendingOrders` (dry-run) + `readRouterSnapshot`.
- `store.ts` — bitácora de corridas en memoria.

## 2. Modo de operación (dry-run)

`processPendingOrders()`:
1. Toma `suspension_orders` / `reactivation_orders` en estado **PENDING**.
2. Para cada una calcula el **plan de comandos** RouterOS que se ejecutarían (sin enviarlos):
   - Suspensión: `/ppp secret disable`, `address-list add NUGACORE_SUSPENDED`, `/queue simple disable`.
   - Reactivación: `/ppp secret enable`, `address-list remove`, `/queue simple enable`.
3. Marca la orden `EXECUTED` con `dry_run=true`, `executed_at`, `worker_run_id` y una nota — **sin** tocar el router ni `client.status`.
4. Registra una **corrida** (run) con los resultados.

Idempotencia: solo procesa **PENDING**; una orden ya `EXECUTED` no se reprocesa.

> Nota: marcar `EXECUTED(dry_run)` "consume" la orden. Para revalidar se crean
> órdenes nuevas (test-tools de Suspensiones). El worker en modo *commit* (fase
> posterior) ejecutará el cambio físico real y moverá `client.status`.

## 3. Lecturas read-only

`GET /api/mikrotik/routers/:id/worker/read` devuelve un **snapshot** con la
allowlist: `/system/resource/print`, `/interface/print`, `/queue/simple/print`,
`/ppp/secret/print`, `/ppp/active/print`, `/ip/address/print`.

- **Simulado** por defecto (sin red).
- **Real read-only** si `MIKROTIK_WORKER_LIVE=true` y el router tiene
  credenciales: el conector descifra el password en memoria, abre la API
  RouterOS sobre la VPN, ejecuta solo comandos `print`. Cualquier fallo →
  fallback simulado (con nota). El password **nunca** se loguea.

## 4. Endpoints

| Método | Ruta | RBAC |
|---|---|---|
| POST | `/api/mikrotik/worker/run` | super admin / administrador / técnico |
| GET | `/api/mikrotik/worker/runs` | + soporte / solo lectura (vista) |
| GET | `/api/mikrotik/routers/:id/worker/read` | vista |

Cobranza: sin acceso a MikroTik.

## 5. Flags / variables

- `MIKROTIK_WORKER_LIVE` (default `false`): habilita lecturas API reales. En dev/test/staging-sin-router queda en `false` (simulado).
- `MIKROTIK_CREDENTIALS_KEY`: necesaria para descifrar credenciales si se usa el modo live.

Migración `20260605140000_mikrotik_worker.sql`: añade `dry_run`, `worker_run_id`,
`worker_note` a `suspension_orders`/`reactivation_orders` (idempotente).

## 6. UI

Panel **"Worker MikroTik · Read Only + Dry Run"** en el módulo MikroTik:
- Botón "Procesar órdenes (dry-run)" (SA/Admin/Téc).
- Lista de corridas recientes (modo live/simulado + dry-run + plan por orden).
- "Leer" por router → modal con el snapshot read-only.

## 7. Seguridad

- Allowlist estricta de comandos `print`; cualquier otro → rechazado.
- Dry-run: sin comandos de corte, sin mutar `client.status`, sin logs MikroTik de corte.
- Password descifrado solo en memoria para autenticar; redactado en logs.
- Run log sin credenciales ni scripts.

## 8. Riesgos

- El cliente RouterOS real no se valida sin un router alcanzable (gateado OFF + fallback). Validar en staging con un router en la VPN y `MIKROTIK_WORKER_LIVE=true`.
- `EXECUTED(dry_run)` consume la orden; revalidación requiere órdenes nuevas.
- El protocolo API se implementó a mano (login moderno + challenge legacy); validar contra RouterOS real.

## 9. Cómo validar (Hermes)

**Simulado (default):**
1. Crear orden: test-tools Suspensiones `scenario:A` → `evaluate/:id` (orden PENDING).
2. `POST /api/mikrotik/worker/run` (técnico) → `dryRun:true`, `pendingFound>=1`, `results[].plannedCommands` no vacío.
3. `GET /api/suspension/orders?customerId=<id>` → orden `EXECUTED`, `dryRun:true`.
4. `GET /api/clients/<id>` → `status` **sigue** `active` (no se ejecutó).
5. `GET /api/mikrotik/logs` → **sin** logs nuevos de corte.
6. Re-correr el worker → la orden no se reprocesa (idempotente).
7. `GET /api/mikrotik/routers/:id/worker/read` → snapshot read-only (`source: simulated`).
8. RBAC: cobranza/soporte 403 en `/worker/run`; solo lectura ve runs pero no corre.

**Real read-only (opcional):** con un router en la VPN, `MIKROTIK_WORKER_LIVE=true`
→ el snapshot devuelve `source: live` con datos reales (solo lectura). Si falla
la conexión, cae a simulado.

## 10. Siguiente fase

Worker en modo **commit**: ejecutar el corte/reactivación real vía API RouterOS,
mover `client.status`, marcar la orden `EXECUTED` (no dry-run) y manejar
`FAILED` con reintentos. Esta fase deja todo **leído y planificado**.
