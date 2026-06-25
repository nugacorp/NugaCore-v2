# PROD-8 Automation Engine Foundation — Result

Fecha: 2026-06-24
Rama: `main`
Resultado final: ✅ COMPLETADO (foundation 100% dry-run / decisión)

## Objetivo

Crear el **Automation Engine** de NugaCore: el cerebro que decide *qué debería
hacerse*. El motor **NO ejecuta acciones**. No toca RouterOS, no usa Worker
Live, no usa MikroTik Runtime, no usa SSH ni shell, no cambia estados reales,
no modifica clientes, no suspende, no reactiva, no cambia planes, no genera
pagos ni facturas. Su única responsabilidad es **decidir** y devolver
decisiones descriptivas con un *execution preview*. Todo es `dryRun=true`.

## Dominio backend

`backend/domains/automation/`

- `types.ts` — eventos, decisiones, reglas, decisión, audit, summary.
- `store.ts` — almacén in-memory (reglas semilla, decisiones, auditoría).
- `rules.ts` — motor de reglas + `evaluateRules` + `buildExecutionPreview`.
- `service.ts` — orquestación: `simulate`, `summary`, listados.
- `audit.ts` — bitácora descriptiva (FASE M).
- `routes.ts` — endpoints read-only + simulación.

## Eventos (16)

`CLIENT_CREATED`, `CUSTOMER_UPDATED`, `PAYMENT_REGISTERED`, `INVOICE_OVERDUE`,
`PLAN_CHANGED`, `SERVICE_CANCELLED`, `INSTALLATION_COMPLETED`,
`ROUTER_REGISTERED`, `IP_ASSIGNED`, `NOC_ALERT`, `TICKET_CREATED`,
`TICKET_CLOSED`, `INVENTORY_RESERVED`, `INVENTORY_RELEASED`,
`PROVISIONING_APPROVED`, `PROVISIONING_REJECTED`.

## Decisiones (9)

`NOTHING`, `CREATE_PROVISIONING`, `REQUEST_SUSPENSION`,
`REQUEST_REACTIVATION`, `REQUEST_PLAN_CHANGE`, `REQUEST_NOTIFICATION`,
`REQUEST_IP_ASSIGNMENT`, `REQUEST_INSTALLATION`, `REQUEST_REVIEW`.

## Reglas

Set semilla declarativo (una regla por intención), cada una con `id`, `name`,
`enabled`, `priority`, `event`, `condition` (función pura sobre el contexto),
`decision`, `description`, `createdAt`, `updatedAt`. El motor recibe un evento,
evalúa solo las reglas habilitadas de ese evento cuya condición se cumple, y
devuelve las decisiones ordenadas por prioridad. **Nunca ejecuta.**

Ejemplo: `INVOICE_OVERDUE` → `REQUEST_SUSPENSION`. Nada más.

## Endpoints

GET:

- `/api/automation/rules`
- `/api/automation/rules/:id`
- `/api/automation/events`
- `/api/automation/decisions` (`?customerId=` opcional)
- `/api/automation/audit`
- `/api/automation/summary`

POST:

- `/api/automation/simulate` — recibe `{ event, customerId, payload }` y
  devuelve `{ rulesMatched, decisions, executionPreview, dryRun:true }`.
  No ejecuta ni cambia ningún sistema real.

## Execution Preview (FASE H)

Cada decisión produce un `executionPreview[]` descriptivo. Ejemplo para
`REQUEST_SUSPENSION`: actualizar Service Status (propuesta) → crear
Provisioning → notificar cliente → esperar aprobación. Todo descriptivo,
nunca ejecutable.

## UI — Automation Center (FASE I)

Nuevo módulo en **Sistema**, debajo de **Configuración** y encima del
**Manual de Usuario**. Badge `DRY RUN` y banner obligatorio:
*"El motor de automatización únicamente toma decisiones. No ejecuta acciones
reales."* Pantallas: Resumen, Eventos, Reglas, Decisiones simuladas y
Execution Preview. Documentado también en el Manual de Usuario.

## Integraciones (lectura)

El motor consume contexto descriptivo de solo lectura (vía payload de
simulación) referido a Billing, CRM, Client360, IPAM, Inventory, Provisioning,
Service Status y NOC. **No modifica ninguno.**

- Dashboard: KPI **Automation Queue** (cuenta decisiones pendientes) — FASE J.
- Client 360: sección **Automation** (últimos eventos, decisiones, última
  simulación) — FASE K.
- Provisioning: referencia **Decision Source**
  (`Automation | Manual | Billing | CRM | NOC | Inventory`) — FASE L.

## RBAC (FASE N)

Lectura y simulación dry-run para todos los roles (Super Admin, Administrador,
Cobranza, Técnico, Soporte, Solo lectura). **Nadie modifica reglas todavía**:
no existen endpoints de escritura de reglas.

## Auditoría (FASE M)

Cada evaluación registra: evento, reglas evaluadas, reglas coincidentes,
decisiones, executionPreview, actor, `dryRun=true` y timestamp. Nunca registra
secretos del payload.

## Static Safety (FASE O)

`tests/unit/automation.static-safety.test.ts` falla si los archivos del motor
contienen primitivas de ejecución/operación live (`exec(`, `spawn`, `shell`,
`ssh`, `routeros`, `worker live`, `child_process`, `execute`, `add(`, `set(`,
`remove(`). Nota: se usa `exec(` en vez del literal `exec` para no chocar con
el término legítimo `executionPreview` (FASE H).

## Tests (FASE P)

- `tests/contract/automation.contract.test.ts`
- `tests/contract/automation.rbac.test.ts`
- `tests/unit/automation.service.test.ts`
- `tests/unit/automation.rules.test.ts`
- `tests/unit/automation.audit.test.ts`
- `tests/unit/automation.preview.test.ts`
- `tests/unit/automation.ui.test.ts`
- `tests/unit/dashboard.automation.test.ts`
- `tests/unit/client360.automation.test.ts`
- `tests/unit/automation.static-safety.test.ts`

## Validación

- `npm run typecheck`: PASS (`tsc --noEmit`)
- `npm test`: PASS (`137 passed | 8 skipped` test files; `1712 passed | 49 skipped` tests)
- `npm run build`: PASS (`vite build` + `esbuild server.ts`)

## Qué NO se hizo (límites de la fase)

No se avanzó a Worker Live ni RouterOS Write. No se activaron
`USE_DB_MIKROTIK` ni `USE_DB_WIREGUARD`. No se tocaron routers reales. No se
ejecutó RouterOS. No se implementaron automatizaciones reales.
