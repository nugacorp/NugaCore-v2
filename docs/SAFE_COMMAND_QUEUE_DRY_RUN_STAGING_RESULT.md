# FAST-1 / PROD-2 Safe Command Queue Dry-Run — Staging Validation Result

Fecha UTC: 2026-06-21T04:35:35Z

## Resultado

✅ FAST-1 / PROD-2 APROBADA

Validación ejecutada en staging para Safe Command Queue Dry-Run + CHR Lab Prep, manteniendo las restricciones operativas: sin activar runtimes MikroTik/WireGuard DB, sin Worker Live, sin commit/write mode, sin RouterOS, sin routers reales, sin migraciones y sin provisioning real.

## Commits validados

- Commit de feature solicitado: `da7fb46 feat(prod2): add safe command queue dry-run foundation`.
- Hotfix requerido para aprobación de sanitización: `f6e3391 fix(prod2): sanitize safe command queue descriptions`.
- HEAD staging validado: `f6e3391cf30191faff251814b340d82a79a9c51f`.

`da7fb46` está incluido en el historial de `f6e3391`.

## Deploy staging

- App Coolify/staging: `zmjc5lnl0wj3kh0uj14s2p4i`.
- Imagen validada: `zmjc5lnl0wj3kh0uj14s2p4i:f6e3391cf30191faff251814b340d82a79a9c51f`.
- Contenedor: running / healthy.

Healthchecks posteriores al deploy y posterior cleanup:

- `/api/health` → 200.
- `/api/health/live` → 200.
- `/api/health/ready` → 200.

## Flags runtime

Verificados por nombre, sin imprimir secretos:

- `USE_DB_MIKROTIK`: unset.
- `USE_DB_WIREGUARD`: unset.
- `MIKROTIK_WORKER_LIVE`: false.
- `MIKROTIK_COMMIT_MODE`: unset.
- `MIKROTIK_WRITE_ENABLED`: unset.

## Checks locales

Ejecutados en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 73 test files passed.
  - 7 test files skipped.
  - 1216 tests passed.
  - 46 tests skipped.
- `npm run build`: PASS.

Se agregó cobertura contract para confirmar que `description` con marcador sintético sensible se redacta en POST, list, detail y auditoría.

## Endpoints validados

Safe Command Queue:

- `GET /api/safe-command-queue`.
- `GET /api/safe-command-queue/:id`.
- `POST /api/safe-command-queue`.
- `POST /api/safe-command-queue/:id/validate`.
- `POST /api/safe-command-queue/:id/simulate`.
- `POST /api/safe-command-queue/:id/approve`.
- `POST /api/safe-command-queue/:id/reject`.
- `POST /api/safe-command-queue/:id/cancel`.

Endpoint de ejecución real:

- `POST /api/safe-command-queue/:id/execute` → 404.

## RBAC

Validado con JWT reales de staging:

| Rol | Resultado |
| --- | --- |
| Super Admin | permitido |
| Administrador | permitido |
| Técnico | permitido |
| Soporte | permitido |
| Solo lectura | permitido |
| Cobranza | 403 |

Cobranza quedó bloqueado para list/create/detail/validate/simulate/approve/reject/cancel.

## Ciclo dry-run

Comando de prueba creado con tipo `SUSPEND_CUSTOMER` y target sintético.

Resultado del ciclo:

1. Create → 201, `PENDING`, `dryRun=true`, `wouldExecute=false`.
2. Validate → 200, `VALIDATED`, `dryRun=true`, `wouldExecute=false`.
3. Simulate → 200, `SIMULATED`, `dryRun=true`, `wouldExecute=false`.
4. Approve después de simulate → 200, `APPROVED`, `dryRun=true`, `wouldExecute=false`.
5. Approve sin simular en otro comando → 409.
6. Reject en otro comando → 200, `REJECTED`.
7. Cancel en otro comando → 200, `CANCELLED`.

Campos requeridos presentes:

- `simulatedCommands[]`.
- `safetyWarnings[]`.
- `riskLevel`.

## Sanitización

Se ejecutó probe sintético con claves y texto sensible falso en payload, description, notes, reason y string con forma de RouterOS.

Resultado:

- POST response sin marcadores sintéticos sensibles.
- GET list sin marcadores sintéticos sensibles.
- GET detail sin marcadores sintéticos sensibles.
- Reject response sin marcadores sintéticos sensibles.
- Audit details sin marcadores sintéticos sensibles.
- Description redactado.
- Notes redactado.
- Reason redactado.
- Payload redactado.
- RouterOS-looking script redactado como `[REDACTED_ROUTEROS_SCRIPT]`.
- `leaks_count=0`.
- `audit_sentinel_hits=0`.

El bloqueador detectado originalmente en `description` quedó corregido por `f6e3391`.

## Ausencia de ejecución real

Confirmado:

- No existe endpoint funcional `/execute`; retorna 404.
- No aparecen estados `EXECUTED`, `RUNNING` ni `COMPLETED` en respuestas live.
- `dryRun=true` siempre en respuestas de comando.
- `wouldExecute=false` siempre en respuestas de comando.
- No se observó `executedAt`.
- Búsqueda en `backend/domains/safe-command-queue` no mostró llamadas reales a MikroTik API, RouterOS, WireGuard, shell, workers, Billing ni Suspension fuera de comentarios/guardrails.
- No se modifica nada fuera del store/mock en memoria.

## UI

Validación de integración UI/código:

- Sidebar contiene `Cola de Comandos (DRY RUN)`.
- App tab `safe-command-queue` renderiza `SafeCommandQueueModule`.
- Vista contiene badge `DRY RUN`.
- Vista contiene banner `Esta cola NO ejecuta comandos reales.`.
- Módulo usa `/api/safe-command-queue` para list/detail/transiciones.
- Botones disponibles: validate, simulate, approve, reject, cancel.
- No existe botón/flujo de execute en el módulo Safe Command Queue.
- Cobranza queda bloqueado por RBAC API; no debe operar el módulo.

## Polling / rate-limit

El módulo Safe Command Queue no mostró loops agresivos ni spam de 429 durante la validación. La UI carga lista/detalle y solo ejecuta mutaciones explícitas de usuario.

## Seguridad / logs

Logs recientes del contenedor staging fueron escaneados sin imprimir secretos.

No se detectaron hallazgos para los patrones sensibles revisados:

- JWT.
- service role.
- `MIKROTIK_CREDENTIALS_KEY`.
- private keys.
- preshared keys.
- scripts RouterOS completos.
- marcadores sintéticos usados en la prueba.

Después del probe sintético se reinició el contenedor para limpiar el store in-memory y se reconfirmaron healthchecks 200/200/200.

## Documentos incluidos por la fase

El commit de feature incluye:

- `docs/CHR_LAB_PREP_RUNBOOK.md`.
- `docs/ROUTEROS_READ_ONLY_API_PLAN.md`.

No se avanzó a RouterOS Read-Only durante esta validación.

## Resultado final

✅ FAST-1 / PROD-2 APROBADA

Aprobación limitada al alcance dry-run de Safe Command Queue. No habilita Worker Live, MikroTik DB runtime, WireGuard DB runtime, commit/write mode, RouterOS read-only ni provisioning real.
