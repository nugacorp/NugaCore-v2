# NOC Read-Only Foundation — Staging Revalidation Result

Fecha UTC: 2026-06-20T17:21:19Z

## Alcance

Revalidación de Fase 4.11.2: base NOC read-only para dashboard operativo basado en datos internos disponibles.

Restricciones respetadas:

- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó commit mode ni escritura real MikroTik.
- No se activó `MIKROTIK_WRITE_ENABLED`.
- No se ejecutó RouterOS.
- No se tocaron routers reales.
- No se aplicaron migraciones en esta fase.
- No se hizo provisioning real.
- No se avanzó a Inventory Sync.

## Commits validados

HEAD solicitado para validación:

- `7928f0a fix(frontend): add polling backoff and rate-limit hygiene`

Commit NOC incluido en el historial:

- `40ca179 feat(noc): add read-only operations dashboard foundation`

Confirmación Git:

- `git fetch origin main`, `git checkout main`, `git pull --ff-only origin main` ejecutados en `/opt/nugacore-staging`.
- `git log --oneline -8` mostró `7928f0a` y `40ca179`.
- `git merge-base --is-ancestor 40ca179 HEAD` confirmó que el commit NOC está incluido.
- El remoto contenía además un commit documental posterior (`8f39b1c`) cuyo diff contra `7928f0a` solo agrega este documento; no cambia código de aplicación.

Deploy staging:

- Coolify app configurada con `git_commit_sha=7928f0af7cfe969f1928e3f00d3f7bf9a81b4556`.
- Contenedor activo tras redeploy: `8f39b1cbb0aac175a93fce3c4b4720eac4a9e3d3`, healthy.
- Nota de trazabilidad: `8f39b1c` es documental-only sobre `7928f0a`; el código runtime de aplicación validado corresponde a `7928f0a`.

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
- `npm test`: PASS; 63 archivos passed, 7 skipped; 1086 tests passed, 46 skipped.
- `npm run build`: PASS.

## Endpoints NOC read-only

Endpoints validados con login real/JWT real de staging por rol:

- `GET /api/noc/summary`
- `GET /api/noc/routers`
- `GET /api/noc/alerts`

RBAC validado:

| Rol | summary | routers | alerts |
| --- | --- | --- | --- |
| Super Admin | 200 | 200 | 200 |
| Administrador | 200 | 200 | 200 |
| Técnico | 200 | 200 | 200 |
| Soporte | 200 | 200 | 200 |
| Solo lectura | 200 | 200 | 200 |
| Cobranza | 403 | 403 | 403 |

Validaciones de payload:

- `summary` responde como objeto estable.
- `routers` responde array.
- `alerts` responde array.
- En esta revalidación staging hubo 3 routers y 3 alertas derivadas.
- El contrato unitario confirma que `summary` también responde correctamente con 0 routers.
- Alertas derivadas localmente desde `backend/domains/noc/service.ts`; no hay envío a servicios externos en estos endpoints.
- Payload no expone `encrypted_password`, `encryptedPassword`, objetos/valores de credenciales, tokens, private keys, preshared keys ni scripts RouterOS completos.
- `summary.routersWithCredentials` es un contador agregado, no material sensible ni objeto de credenciales.

## Sin escritura

Métodos probados con usuario permitido:

| Método | Endpoint | Resultado |
| --- | --- | --- |
| POST | `/api/noc/summary` | 404 |
| POST | `/api/noc/routers` | 404 |
| POST | `/api/noc/alerts` | 404 |
| PUT | `/api/noc/routers/:id` | 404 |
| PATCH | `/api/noc/routers/:id` | 404 |
| DELETE | `/api/noc/routers/:id` | 404 |

Resultado: PASS. No hay endpoints de escritura NOC.

## UI NOC

Validación de UI y contrato frontend:

- El bundle desplegado y los tests de UI contienen módulo `NOC Read-Only`.
- Sidebar/App routing incluyen el módulo NOC para Super Admin, Administrador, Técnico, Soporte y Solo lectura.
- Cobranza no tiene tab `noc` en RBAC frontend; el acceso API directo devuelve 403.
- La vista contiene título `NOC Read-Only` y badge `READ-ONLY`.
- La vista muestra resumen operativo, tabla de routers o empty state, y lista de alertas derivadas o empty state.
- La vista no declara acciones `POST`, `PUT`, `PATCH` ni `DELETE` dentro del módulo NOC.
- Texto visible/contractual: `Esta vista no ejecuta comandos ni modifica routers.`

Prueba complementaria ejecutada en navegador staging:

- Consola del navegador sin errores JS ni mensajes repetitivos durante la carga de staging.

## Polling / rate-limit hygiene

Validación:

- `npm test` incluyó `tests/unit/api.backoff.test.ts`: PASS.
- `src/lib/apiBackoff.ts` mantiene cooldown por endpoint, respeta `Retry-After`, aplica backoff mínimo/progresivo y evita reintentos inmediatos en loops de polling.
- `src/App.tsx` mantiene polling cada 120000 ms, no cada pocos segundos.
- El polling omite ejecución cuando `document.visibilityState !== 'visible'`.
- El polling se detiene durante `rateLimitNotice` o mientras `Date.now() < rateLimitUntilMs`.
- La consola del navegador no mostró spam de 429 durante la carga observada.

Endpoints vigilados para no saturación:

- `/api/workorders`
- `/api/tickets`
- `/api/inventory`
- `/api/naps`
- `/api/billing/account-summary`
- `/api/billing/revenue-report`
- `/api/notifications/settings`

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

✅ FASE 4.11.2 APROBADA

NOC Read-Only Foundation quedó revalidado en staging sobre el código de `7928f0a`, con `40ca179` incluido, sin activar MikroTik DB runtime, WireGuard DB runtime, Worker live, commit mode ni tocar routers reales.
