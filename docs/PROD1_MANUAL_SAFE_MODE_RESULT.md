# PROD-1 Manual Safe Mode — Resultado de implementación

> Estado: **implementada localmente** (pendiente validación staging por Hermes).
> SAFE / READ-ONLY estricto. NO ejecuta comandos, NO toca routers, NO escribe en
> MikroTik, NO existe ejecución real ni estado EXECUTED. Sin DB nueva, sin
> migraciones, sin flags peligrosos. Fecha: 2026-06-20.

## 1. Alcance

PROD-1 construye la **infraestructura segura** para acciones manuales futuras
(modo manual con confirmación humana). Esta fase NO ejecuta nada: solo modela,
registra y audita transiciones de estado sobre un store en memoria.

Construida sobre la base aprobada: DB-1, 4.11.1 Inventory RO, 4.11.2 NOC RO,
4.11.3 NOC Real Telemetry (commit funcional `7a139ed`).

## 2. Arquitectura

Dominio nuevo `backend/domains/manual-safe-mode/`:

- `types.ts` — `SafeAction`, `SafeActionAudit`, `SafeActionDetail`, uniones de
  estado/modo/evento, input de creación.
- `repository.ts` — store en memoria síncrono (`ACTIONS`, `AUDITS`) con `_reset()`
  para tests. NO usa Supabase, NO crea tablas, NO crea migraciones.
- `mappers.ts` — validación/normalización de input, factoría de auditoría y
  **máquina de estados** (transiciones válidas). Funciones puras.
- `service.ts` — orquesta el ciclo de vida; cada operación registra auditoría.
- `routes.ts` — endpoints REST con RBAC.

### Modelo `SafeAction`

`id, createdAt, createdBy, actionType, targetType, targetId, description, payload,
status, approvedBy?, approvedAt?, executedAt?, executionMode, dryRun, notes?`.

- `executedAt` queda **reservado** para fases futuras y **nunca** se setea en PROD-1.
- `dryRun` por defecto `true` (postura segura).

### Estados y modos

- **Status:** `PENDING`, `APPROVED`, `REJECTED`, `SIMULATED`, `CANCELLED`.
  **No existe `EXECUTED`.**
- **Execution modes:** `MANUAL`, `DRY_RUN`, `FUTURE_AUTOMATION`.

### Máquina de estados (segura)

| Evento | Desde | Hacia |
|---|---|---|
| approve | PENDING | APPROVED |
| reject | PENDING | REJECTED |
| simulate | PENDING | SIMULATED |
| cancel | PENDING, APPROVED | CANCELLED |

Cualquier otra transición → `409 INVALID_TRANSITION`. No hay ninguna ruta a
`EXECUTED` (no existe). `simulateAction()` **solo** cambia `PENDING → SIMULATED` y
audita; no ejecuta absolutamente nada.

### Auditoría `SafeActionAudit`

`id, actionId, timestamp, actor, event, details`. Eventos: `CREATED`, `APPROVED`,
`REJECTED`, `SIMULATED`, `CANCELLED`. Persistida en memoria; expuesta en el detalle.

## 3. Endpoints

Todos con RBAC `SAFE_MODE_ROLES` (Cobranza 403). Mock seguro: ningún endpoint
ejecuta RouterOS, WireGuard, billing, suspensión, shell ni workers.

| Método | Endpoint | Acción |
|---|---|---|
| GET | `/api/manual-actions` | listar acciones |
| GET | `/api/manual-actions/:id` | detalle + historial de auditoría |
| POST | `/api/manual-actions` | crear (status PENDING) |
| POST | `/api/manual-actions/:id/approve` | PENDING → APPROVED |
| POST | `/api/manual-actions/:id/reject` | PENDING → REJECTED |
| POST | `/api/manual-actions/:id/simulate` | PENDING → SIMULATED (no ejecuta) |
| POST | `/api/manual-actions/:id/cancel` | PENDING/APPROVED → CANCELLED |

### Payloads

`POST /api/manual-actions` (body):

```json
{
  "actionType": "mikrotik.read.resource",
  "targetType": "router",
  "targetId": "mkt-1",
  "description": "Lectura segura de recursos (mock)",
  "payload": { "command": "/system/resource/print" },
  "executionMode": "DRY_RUN",
  "dryRun": true
}
```

Respuesta `201` → objeto `SafeAction` (`status: "PENDING"`, sin `executedAt`).

`GET /api/manual-actions/:id` → `{ action: SafeAction, audit: SafeActionAudit[] }`.

## 4. RBAC

| Rol | acceso |
|---|---|
| Super Admin | ✅ |
| Administrador | ✅ |
| Técnico | ✅ |
| Soporte | ✅ |
| Solo lectura | ✅ |
| Cobranza | ❌ 403 |

## 5. UI

`src/modules/manual-safe-mode/ManualSafeModeModule.tsx`:

- Badge **SAFE MODE**.
- Banner: *"Esta funcionalidad NO ejecuta cambios reales. Todas las acciones son simuladas."*
- Tabla de acciones (acción, objetivo, modo, estado, transiciones).
- Panel de detalle + historial de auditoría.
- Solo consume los endpoints `/api/manual-actions/*`; las transiciones son POST que
  cambian estado, sin ejecución real.

> **Nota de ubicación:** el spec indicaba `frontend/src/modules/manual-safe-mode`,
> pero el root real del frontend en este repo es `src/` (Vite + tsconfig). Para no
> crear código fuera del árbol del build se ubicó en
> `src/modules/manual-safe-mode/`.
>
> **Nota de navegación:** en la entrega inicial el módulo quedó standalone. Ya fue
> cableado en navegación — ver §13 *Hotfix UI Navigation*.

## 6. Tests

- `tests/contract/manual-safe-mode.contract.test.ts` (18): crear (201), validación
  (400), detalle+auditoría, 404, approve/reject/simulate/cancel, transición inválida
  (409), ausencia de estado EXECUTED, RBAC por rol, Cobranza 403 en todos los
  endpoints, inexistencia de endpoint `/execute`.
- `tests/unit/manual-safe-mode.service.test.ts` (11): defaults seguros, validación,
  ciclo de vida, simulate sin ejecución, cancel desde PENDING/APPROVED, estados
  terminales (ConflictError), imposibilidad de EXECUTED.
- `tests/unit/manual-safe-mode.ui.test.ts` (5): badge SAFE MODE, texto de no-ejecución,
  endpoints/transiciones, tabla/detalle/auditoría, sin `/execute` ni estado EXECUTED.

## 7. Validación local

```bash
npm run typecheck   # PASS
npm test            # PASS
npm run build       # PASS
```

## 8. Seguridad

- Ningún endpoint ejecuta RouterOS/WireGuard/billing/suspensión/shell/workers.
- No se activan ni referencian `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`,
  `MIKROTIK_WORKER_LIVE`, commit mode.
- No hay secretos en payloads ni logs. No hay migraciones ni cambios en Supabase.
- `executedAt` nunca se setea; no existe estado `EXECUTED`.

## 9. Limitaciones

- Datos en **memoria** (se reinician con el proceso); sin persistencia DB (por diseño).
- `payload` es JSON arbitrario almacenado tal cual; no se interpreta ni ejecuta.
- Sin integración en el menú de navegación (ver nota en §5).

## 10. Riesgos

- **Muy bajo.** Sin escritura real, sin flags, sin migraciones, sin ejecución.
  La superficie es un CRUD de estados con auditoría sobre memoria.

## 11. Qué debe validar Hermes (staging)

1. `git log` incluye el commit PROD-1 sobre `7a139ed`.
2. Healthchecks `/api/health[/live|/ready]` → 200.
3. Flags apagados/unset (por nombre): `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`,
   `MIKROTIK_WORKER_LIVE`, `MIKROTIK_COMMIT_MODE`.
4. Ciclo con JWT real: crear (201) → simulate (SIMULATED) / approve (APPROVED) /
   reject / cancel; transición inválida → 409.
5. RBAC: 5 roles permitidos OK; **Cobranza 403** en los 7 endpoints.
6. Confirmar que NO existe estado `EXECUTED`, que `executedAt` nunca se setea y que
   no hay endpoint `/execute`.
7. Logs sin secretos.

## 12. Siguiente fase recomendada

Mantener el orden gated. Tras validar PROD-1 en staging, la continuación natural es
**Safe Command Queue (dry-run)** — modelar la cola de comandos sin ejecución real,
sobre esta base. **NO** avanzar a `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, Worker Live,
RouterOS real ni commit mode.

## 13. Hotfix UI Navigation

El módulo Manual Safe Mode ya está **visible en la navegación** de NugaCore (en la
entrega inicial quedó standalone; este hotfix lo cableó).

- **Sidebar** (`src/components/Sidebar.tsx`): nuevo item `id: 'manual-safe-mode'`
  → "Modo Seguro Manual (SAFE MODE)" (icono `ShieldCheck`).
- **App** (`src/App.tsx`): import de `ManualSafeModeModule` y render bajo
  `activeTab === 'manual-safe-mode'`.
- **RBAC frontend** (`src/lib/rbac.ts`): nuevo `AppTab` `'manual-safe-mode'` agregado a
  Super Admin, Administrador, Técnico, Soporte y Solo lectura; **Cobranza no lo ve**
  (alineado con el RBAC del backend, que responde 403 a Cobranza). Etiqueta en
  `MODULE_LABELS`: "Modo Seguro Manual".
- **No se agregó ejecución real:** sin estado `EXECUTED`, sin endpoint `/execute`, sin
  botón "Ejecutar". La vista mantiene badge SAFE MODE, banner de no-cambios-reales,
  tabla, detalle e historial de auditoría. Backend sin cambios.

Tests: `tests/unit/rbac.frontend.test.ts` actualizado (Super Admin pasa de 18 a 19
módulos; arrays exactos de Soporte/Solo lectura; visibilidad manual-safe-mode) y
`tests/unit/manual-safe-mode.ui.test.ts` ampliado con integración Sidebar/App/RBAC y
ausencia de acción real.
