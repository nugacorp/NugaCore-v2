# PROD-7 Provisioning Engine Foundation — Staging Validation

Fecha: 2026-06-25
Commit validado: `0f1457c84f26ad68fc9d32db90e17a0dc4d42a9b`
Rama: `main`
Aplicación Coolify: `nugacore-staging`
Resultado final: ✅ APROBADA

## Alcance validado

PROD-7 Provisioning Engine Foundation fue validado como foundation 100% dry-run/auditoría. No se activaron flags live, no se tocó RouterOS, no se tocó infraestructura real y no se ejecutaron suspensiones/reactivaciones reales.

## Deploy staging

- `git fetch origin`: OK
- `git checkout main`: OK
- `git pull --ff-only origin main`: OK
- Commit en `git log --oneline -20`: `0f1457c feat(prod7): add provisioning engine dry-run foundation`
- Redeploy Coolify con HEAD actual: OK
- Contenedor desplegado con imagen del commit validado: OK
- Contenedor healthy: OK
- `/api/health`: 200
- `/api/health/live`: 200
- `/api/health/ready`: 200

## Checks locales

- `npm run typecheck`: PASS (`tsc --noEmit`)
- `npm test`: PASS (`127 passed | 8 skipped` test files; `1663 passed | 49 skipped` tests)
- `npm run build`: PASS (`vite build` + `esbuild server.ts`)

## Endpoints Provisioning

Validados con JWT real (`source=supabase-jwt`) para roles staging temporales.

GET:

- `/api/provisioning/actions`
- `/api/provisioning/actions/:id`
- `/api/provisioning/summary`

POST:

- `/api/provisioning/actions`
- `/api/provisioning/actions/:id/validate`
- `/api/provisioning/actions/:id/simulate`
- `/api/provisioning/actions/:id/approve`
- `/api/provisioning/actions/:id/reject`
- `/api/provisioning/actions/:id/cancel`

Resultado:

- Lectura permitida para 6 roles: Super Admin, Administrador, Cobranza, Técnico, Soporte, Solo lectura → 200.
- Escritura/control permitida para 3 roles: Super Admin, Administrador, Cobranza → 201/200.
- Escritura/control bloqueada para Técnico, Soporte, Solo lectura → 403.

## Estados

Estados implementados/validados:

- `PENDING`
- `VALIDATED`
- `SIMULATED`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

Transiciones validadas:

- `PENDING → VALIDATED → SIMULATED → APPROVED`
- `PENDING → REJECTED`
- `PENDING → CANCELLED`

Estados prohibidos no observados:

- `EXECUTED`
- `RUNNING`
- `COMPLETED`

## Acciones y executionPlan dry-run

Acciones creadas y validadas:

- `SUSPEND_CUSTOMER`
- `REACTIVATE_CUSTOMER`
- `CHANGE_PLAN`
- `CREATE_CUSTOMER`
- `CANCEL_CUSTOMER`

Cada acción generó `executionPlan[]` descriptivo y audit trail con `dryRun=true`.

Confirmado:

- `dryRun=true`
- sin `executedAt`
- sin `routerosCommand` real
- sin script completo
- sin queue real
- sin address-list aplicada
- sin comandos ejecutables en el plan

## UI Provisioning Center

Validado en navegador con usuario real Supabase/JWT de rol Super Admin.

Confirmado:

- `Provisioning Center` visible bajo MikroTik.
- Badge `DRY RUN` visible.
- Banner visible: “Las acciones mostradas aquí NO ejecutan cambios reales.”
- Tabla de acciones visible.
- Plan de ejecución visible.
- Botones visibles: Validar, Simular, Aprobar, Rechazar, Cancelar.
- No existe botón `Execute`.
- No existe botón `Ejecutar`.
- No aparece texto de ejecución real en el módulo.

## Client 360

Validado en navegador.

Confirmado:

- Sección `Provisioning` visible en Client 360.
- Muestra última acción.
- Muestra estado.
- Muestra fecha.
- Muestra resultado simulación.
- Botón `Ver historial` visible.
- No ejecuta cambios reales.

## Dashboard KPI

Validado API + UI.

Confirmado:

- Dashboard muestra KPI `Provisioning Pendiente`.
- Cuenta `PENDING + VALIDATED + SIMULATED`.
- No cuenta `APPROVED`, `REJECTED`, `CANCELLED` como pendientes.
- En la corrida de validación: esperado `4`, actual `4`.

## Static safety

Escaneo refinado sobre `backend/domains/provisioning/**`:

- `exec\b`: ausente
- `spawn\b`: ausente
- `shell\b`: ausente
- `ssh\b`: ausente
- `RouterOS write`: ausente
- `MikroTik write`: ausente
- `worker live`: ausente
- `.add(`: ausente
- `.set(`: ausente
- `.remove(`: ausente
- `execute\b`: ausente

Import safety:

- No importa clientes RouterOS write.
- No importa clientes MikroTik write.
- No importa workers live.
- No importa `child_process`.

Nota: términos como `executionPlan` son parte del contrato descriptivo y no representan ejecución.

## Seguridad / logs

Logs recientes revisados sin imprimir secretos.

Ausente:

- JWTs
- service role
- passwords
- private keys
- preshared keys
- credentials
- scripts RouterOS completos
- comandos RouterOS write

## No impacto RouterOS / infraestructura

Confirmado en runtime:

- `USE_DB_MIKROTIK`: SAFE_OFF
- `USE_DB_WIREGUARD`: SAFE_OFF
- `MIKROTIK_WORKER_LIVE`: SAFE_OFF
- `MIKROTIK_COMMIT_MODE`: SAFE_OFF
- `MIKROTIK_WRITE_ENABLED`: SAFE_OFF

Confirmado por validación:

- No Worker Live.
- No RouterOS Write.
- No suspensiones reales.
- No reactivaciones reales.
- No cambios en routers.
- No CHR real requerido.
- No RB5009 real tocado.

## Resultado final

✅ PROD-7 PROVISIONING ENGINE FOUNDATION APROBADA.

No avanzar a Worker Live.
No avanzar a RouterOS Write.
No tocar routers reales.
