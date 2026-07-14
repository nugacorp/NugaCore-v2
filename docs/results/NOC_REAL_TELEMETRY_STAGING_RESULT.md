# NOC Real Telemetry Read-Only — Staging Result

Fecha UTC: 2026-06-20T18:26:08Z

## Alcance

Validación de Fase 4.11.3: NOC Real Telemetry Read-Only basado en datos internos existentes, sin activar runtime MikroTik DB, sin Worker Live y sin tocar routers reales.

Restricciones respetadas:

- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó `MIKROTIK_COMMIT_MODE`.
- No se activó `MIKROTIK_WRITE_ENABLED`.
- No se ejecutó RouterOS.
- No se tocaron routers reales.
- No se aplicaron migraciones.
- No se hizo provisioning real.
- No se avanzó a Inventory Sync.
- No se avanzó a PROD-1.
- No se avanzó a Safe Command Queue.

## Commit validado

Commit validado:

- `7a139ed feat(noc): add real telemetry read-only dashboard`

Confirmación Git en `/opt/nugacore-staging`:

- `git fetch origin`: OK.
- `git checkout main`: OK.
- `git pull --ff-only origin main`: OK.
- `git log --oneline -12` mostró `7a139ed` en HEAD.
- `git merge-base --is-ancestor 7a139ed HEAD`: INCLUDED.

## Deploy staging

Coolify redeploy ejecutado contra:

- `git_commit_sha=7a139eda5cb702b2beb4e159923b4e21d8e8e52c`

Contenedor activo:

- Imagen: `zmjc5lnl0wj3kh0uj14s2p4i:7a139eda5cb702b2beb4e159923b4e21d8e8e52c`.
- Docker health: `healthy`.
- Estado Docker: `running`.

Nota operativa:

- Docker y los healthchecks externos quedaron sanos. La API local de Coolify reportó `running:unhealthy` de forma no concordante con Docker health y endpoints externos; la validación de contenedor se basó en Docker inspect y healthchecks HTTP reales.

## Healthchecks

Base URL:

- `https://nugacore-staging.5.180.151.109.sslip.io`

Resultados:

- `/api/health`: 200.
- `/api/health/live`: 200.
- `/api/health/ready`: 200.

## Flags runtime

Verificados dentro del contenedor staging, sin imprimir secretos:

- `USE_DB_MIKROTIK`: UNSET / apagado.
- `USE_DB_WIREGUARD`: UNSET / apagado.
- `MIKROTIK_WORKER_LIVE`: `false`.
- `MIKROTIK_COMMIT_MODE`: UNSET / apagado.
- `MIKROTIK_WRITE_ENABLED`: UNSET / apagado.

## Checks locales

Comandos ejecutados:

```bash
npm run typecheck
npm test
npm run build
```

Resultados:

- `npm run typecheck`: PASS.
- `npm test`: PASS; 66 archivos passed, 7 skipped; 1117 tests passed, 46 skipped.
- `npm run build`: PASS.

## Endpoints NOC telemetry read-only

Endpoints validados con login real/JWT real de staging por rol:

- `GET /api/noc/health`
- `GET /api/noc/towers`
- `GET /api/noc/alerts`

RBAC validado:

| Rol | health | towers | alerts |
| --- | --- | --- | --- |
| Super Admin | 200 | 200 | 200 |
| Administrador | 200 | 200 | 200 |
| Técnico | 200 | 200 | 200 |
| Soporte | 200 | 200 | 200 |
| Solo lectura | 200 | 200 | 200 |
| Cobranza | 403 | 403 | 403 |

Validaciones de payload:

- `/api/noc/health` responde objeto estable.
- `/api/noc/towers` responde array.
- `/api/noc/alerts` responde array.
- En staging se observaron 3 torres y 3 alertas derivadas.
- Los tests de contrato cubren el caso de 0 routers: health con contadores en 0 y towers/alerts como arrays vacíos según corresponda.
- Las alertas son derivadas localmente desde datos internos. No se encontró envío a Telegram, email ni webhook externo en los dominios NOC/NOC telemetry.
- Payload no expone `encrypted_password`, `encryptedPassword`, objetos/valores de credenciales, tokens, private keys, preshared keys ni scripts RouterOS completos.

## Sin escritura

Métodos probados con usuario permitido:

| Método | Endpoint | Resultado |
| --- | --- | --- |
| POST | `/api/noc/health` | 404 |
| POST | `/api/noc/towers` | 404 |
| POST | `/api/noc/alerts` | 404 |
| PUT | `/api/noc/health` | 404 |
| PUT | `/api/noc/towers` | 404 |
| PUT | `/api/noc/alerts` | 404 |
| PATCH | `/api/noc/health` | 404 |
| PATCH | `/api/noc/towers` | 404 |
| PATCH | `/api/noc/alerts` | 404 |
| DELETE | `/api/noc/health` | 404 |
| DELETE | `/api/noc/towers` | 404 |
| DELETE | `/api/noc/alerts` | 404 |

Resultado: PASS. No hay endpoints de escritura NOC telemetry.

## UI NOC Telemetry

Validación de UI y contrato frontend:

- El tab/módulo NOC existente permanece integrado como `NOC Read-Only` para los roles permitidos.
- Cobranza no tiene visibilidad del tab NOC por RBAC frontend y recibe 403 si accede directo a los endpoints.
- La vista nueva `NOC Real Telemetry` está integrada dentro del tab `noc`.
- Badge `READ-ONLY` presente.
- Widgets presentes:
  - Routers Online.
  - Routers Offline.
  - Warnings.
  - Critical.
  - Torres monitoreadas.
- Tabla por router presente con columnas:
  - Router.
  - Torre.
  - Estado.
  - CPU.
  - RAM.
  - Último check.
- Tabla por torre presente.
- Panel de alertas derivadas presente.
- Texto claro presente: `Esta vista no ejecuta acciones ni modifica routers.`
- El módulo NOC telemetry no declara acciones `POST`, `PUT`, `PATCH` ni `DELETE`.
- El módulo solo llama `fetch` sobre endpoints GET de NOC telemetry/read-only.

Prueba complementaria en navegador staging:

- Consola del navegador sin errores JS ni mensajes repetitivos durante carga observada.

## Polling / rate-limit hygiene

Validación:

- `npm test` incluyó `tests/unit/api.backoff.test.ts`: PASS.
- `src/App.tsx` conserva polling global cada 120000 ms, no cada pocos segundos.
- El polling global respeta visibilidad de documento y pausa por rate-limit/backoff.
- `NocTelemetryModule` no define `setInterval`; carga la vista con un `useEffect` y llamadas GET puntuales.
- Prueba directa contra `/api/noc/health`, `/api/noc/towers` y `/api/noc/alerts` en ráfaga controlada no produjo 429; todos respondieron 200 con Super Admin.
- No se observó spam 429 en consola durante la carga revisada.

Resultado: PASS.

## Seguridad y logs

Logs recientes del contenedor revisados sin imprimir secretos.

No se detectaron:

- JWTs.
- `service_role` / `SUPABASE_SERVICE_ROLE_KEY`.
- valor de `MIKROTIK_CREDENTIALS_KEY`.
- `encrypted_password` / `encryptedPassword`.
- Private keys.
- Preshared keys.
- Scripts RouterOS completos.

Resultado: PASS.

## Resultado final

✅ FASE 4.11.3 APROBADA

NOC Real Telemetry Read-Only quedó validado en staging sobre `7a139ed`, sin activar MikroTik DB runtime, WireGuard DB runtime, Worker Live, commit mode ni tocar routers reales.
