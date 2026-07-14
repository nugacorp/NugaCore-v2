# Safe Command Queue Dry-Run (FAST-1) — Resultado de implementación

> Estado: **implementada localmente** (pendiente validación staging por Hermes).
> DRY-RUN estricto. NUNCA ejecuta RouterOS, NUNCA toca routers reales, NO hay
> worker/shell, NO existe estado EXECUTED/RUNNING/COMPLETED ni endpoint `/execute`.
> Sin DB nueva, sin migraciones, sin flags peligrosos. Fecha: 2026-06-21.

## 1. Alcance

FAST-1 agrega una **cola segura de comandos en dry-run** sobre la base PROD-1.
Modela, valida, simula (dry-run), aprueba/rechaza/cancela y audita comandos —
**sin ejecutar nada**. Incluye también dos documentos de preparación de la fase
siguiente (CHR lab + plan RouterOS read-only).

Construida sobre PROD-1 Manual Safe Mode (commit `d92e204`).

## 2. Backend — dominio `safe-command-queue`

`backend/domains/safe-command-queue/`: `types.ts`, `repository.ts` (store en memoria,
`_reset` para tests), `mappers.ts` (validación + dry-run preview + máquina de estados),
`service.ts`, `routes.ts`. Sin Supabase, sin migraciones.

### Modelo `SafeCommand`

`id, createdAt, createdBy, commandType, targetId, description, payload, status,
dryRun (true), wouldExecute (false), riskLevel, simulatedCommands[], safetyWarnings[],
validatedBy?, validatedAt?, approvedBy?, approvedAt?, notes?`.

- `dryRun` siempre `true`, `wouldExecute` siempre `false`.
- `simulatedCommands` es una previsualización **descriptiva, no ejecutable** (no es
  sintaxis RouterOS real); se genera del `commandType` + `targetId` saneado.

### Estados y tipos

- **Status:** `PENDING`, `VALIDATED`, `SIMULATED`, `APPROVED`, `REJECTED`, `CANCELLED`.
  **Prohibidos:** `EXECUTED`, `RUNNING`, `COMPLETED` (no existen).
- **Command types:** `SUSPEND_CUSTOMER`, `RESTORE_CUSTOMER`, `UPDATE_QUEUE`,
  `UPDATE_PLAN`, `ADD_ADDRESS_LIST`, `REMOVE_ADDRESS_LIST`, `REBOOT_CPE`.
- **Risk level:** `low`/`medium`/`high` (SUSPEND_CUSTOMER y REBOOT_CPE = high).

### Máquina de estados (dry-run safe)

| Evento | Desde | Hacia |
|---|---|---|
| validate | PENDING | VALIDATED |
| simulate | VALIDATED | SIMULATED |
| approve | SIMULATED | APPROVED |
| reject | PENDING/VALIDATED/SIMULATED | REJECTED |
| cancel | PENDING/VALIDATED/SIMULATED/APPROVED | CANCELLED |

Cualquier otra transición → `409 INVALID_TRANSITION`. **Aprobar exige simular antes**
(revisión dry-run obligatoria). No hay ruta a EXECUTED.

### Saneo

Todo campo libre pasa por `backend/common/security/sanitize-sensitive-data.ts`:
`payload` (deep key-based + RouterOS + sentinel), `description`, `targetId`, `notes`,
`reject reason` y `audit.details`.

## 3. Endpoints

Todos RBAC (Cobranza 403). **No existe `/execute`.**

| Método | Endpoint | Acción |
|---|---|---|
| GET | `/api/safe-command-queue` | listar |
| GET | `/api/safe-command-queue/:id` | detalle + auditoría |
| POST | `/api/safe-command-queue` | crear (PENDING) |
| POST | `/api/safe-command-queue/:id/validate` | PENDING → VALIDATED |
| POST | `/api/safe-command-queue/:id/simulate` | VALIDATED → SIMULATED (dry-run) |
| POST | `/api/safe-command-queue/:id/approve` | SIMULATED → APPROVED |
| POST | `/api/safe-command-queue/:id/reject` | → REJECTED |
| POST | `/api/safe-command-queue/:id/cancel` | → CANCELLED |

## 4. UI

`src/modules/safe-command-queue/SafeCommandQueueModule.tsx`, integrado en el tab
`safe-command-queue` (Sidebar + App + RBAC):

- Badge **DRY RUN** y banner *"Esta cola NO ejecuta comandos reales."*
- Tabla de comandos (tipo, target, riesgo, estado, transiciones).
- Detalle con comandos simulados (no ejecutados), advertencias de seguridad y auditoría.
- Botones: validate, simulate, approve, reject, cancel. **Sin botón execute.**

RBAC frontend: visible para Super Admin, Administrador, Técnico, Soporte, Solo lectura;
**Cobranza no lo ve** (alineado con el 403 del backend).

## 5. Tests

- `tests/contract/safe-command-queue.contract.test.ts` (16): creación dry-run, 400,
  saneo de payload, flujo validate→simulate→approve, reject/cancel, transición inválida
  409 (approve sin simular), ausencia de EXECUTED/RUNNING/COMPLETED, sin `/execute`,
  RBAC por rol, Cobranza 403.
- `tests/unit/safe-command-queue.service.test.ts` (10): defaults dry-run, riesgo por
  tipo, validación, saneo, ciclo de vida, approve exige simular, estados terminales,
  nunca EXECUTED.
- `tests/unit/safe-command-queue.ui.test.ts` (8): badge DRY RUN, mensaje, endpoints y
  transiciones, lista/detalle/simulados/auditoría, sin `/execute`/`Ejecutar`/EXECUTED,
  integración Sidebar/App/RBAC.
- `tests/unit/rbac.frontend.test.ts`: actualizado (Super Admin 19→20; arrays exactos de
  Soporte/Solo lectura; visibilidad safe-command-queue).

## 6. Validación local

```bash
npm run typecheck   # PASS
npm test            # PASS
npm run build       # PASS
```

## 7. Seguridad

- Ningún endpoint ejecuta RouterOS, MikroTik API, WireGuard, billing, suspensión,
  shell ni workers. Todo es mock seguro en memoria.
- No se activan ni referencian `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`,
  `MIKROTIK_WORKER_LIVE`, `MIKROTIK_COMMIT_MODE`, `MIKROTIK_WRITE_ENABLED`.
- Sin secretos en payloads/logs; sin migraciones ni cambios en Supabase.

## 8. Documentos de preparación (siguiente fase)

- `docs/CHR_LAB_PREP_RUNBOOK.md` (Parte C): preparación de un CHR de laboratorio
  (provisión, hardening, backup/export, conexión management/WireGuard, rollback, orden
  read-only primero). **Documental; sin conexión real.**
- `docs/ROUTEROS_READ_ONLY_API_PLAN.md` (Parte D): plan de lectura read-only de RouterOS
  (`/system identity`, `/system resource`, `/interface print`, `/ip address print`,
  `/ip route print`) contra el CHR de lab, con allowlist y sanitización. **Sin writes,
  sin worker live, sin routers reales.**

## 9. Limitaciones

- Datos en memoria (se reinician con el proceso); sin persistencia DB (por diseño).
- `simulatedCommands` es descriptivo, no sintaxis RouterOS ejecutable.
- Sin integración con routers ni MikroTik API (esa es la fase gated siguiente).

## 10. Qué debe validar Hermes (staging)

1. `git log` incluye el commit FAST-1 sobre `d92e204`.
2. Healthchecks `/api/health[/live|/ready]` → 200.
3. Flags apagados/unset: `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE`,
   `MIKROTIK_COMMIT_MODE`, `MIKROTIK_WRITE_ENABLED`.
4. Ciclo con JWT real: crear (201) → validate → simulate → approve; reject/cancel;
   approve sin simular → 409.
5. RBAC: 5 roles permitidos; **Cobranza 403** en los 8 endpoints.
6. Confirmar ausencia de `EXECUTED`/`RUNNING`/`COMPLETED`, de `/execute` y de ejecución
   real; `dryRun=true`, `wouldExecute=false`; payload saneado.
7. UI: tab "Cola de Comandos (DRY RUN)" visible para roles permitidos, no para Cobranza.

## 11. Siguiente fase recomendada

RouterOS read-only en CHR de lab (`docs/ROUTEROS_READ_ONLY_API_PLAN.md`), gated. **NO**
avanzar a Worker Live, `USE_DB_MIKROTIK`, RouterOS real ni commit mode.
