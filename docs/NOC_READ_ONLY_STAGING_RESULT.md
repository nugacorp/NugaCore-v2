# NOC Read-Only Foundation — Staging Result

Fecha UTC: 2026-06-19T17:02:57Z

## Alcance

Validación de Fase 4.11.2: base NOC read-only para dashboard operativo basado en datos internos disponibles.

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

HEAD validado:

- `7928f0a fix(frontend): add polling backoff and rate-limit hygiene`

Commit NOC incluido en el historial:

- `40ca179 feat(noc): add read-only operations dashboard foundation`

Confirmación Git:

- `40ca179` aparece en `git log --oneline -8`.
- `git merge-base --is-ancestor 40ca179 HEAD` confirmó que el commit NOC está incluido en HEAD.

Deploy staging:

- Imagen/commit activo: `7928f0af7cfe969f1928e3f00d3f7bf9a81b4556`.
- Contenedor Coolify: healthy.

## Healthchecks

Base URL:

- `https://nugacore-staging.5.180.151.109.sslip.io`

Resultados:

- `/api/health`: 200, status `ok`.
- `/api/health/live`: 200, status `ok`.
- `/api/health/ready`: 200, status `ready`.

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
- Alertas derivadas localmente desde datos internos del backend; no se validó ningún envío a servicios externos porque el contrato NOC no expone acciones de envío.
- Payload no expone `encrypted_password`, `encryptedPassword`, objetos de credenciales, tokens, private keys, preshared keys ni scripts RouterOS completos.

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

Validación realizada en navegador staging con login real Super Admin:

- Módulo `NOC Read-Only` visible en sidebar.
- Vista `NOC Read-Only` abre correctamente.
- Badge `READ-ONLY` visible.
- Resumen operativo visible.
- Tabla `Routers operativos` visible cuando hay datos.
- Alertas activas visibles en el resumen; lista/empty state cubiertos por contrato UI.
- No se observaron botones de escritura dentro de la vista NOC read-only.
- Texto visible indica que es `Solo lectura` y que `no ejecuta` comandos.

Validación complementaria incluida en `npm test`:

- `tests/unit/noc.read-only.ui.test.ts` confirma que el módulo está marcado `READ-ONLY`.
- Confirma que consume `/api/noc/summary`, `/api/noc/routers` y `/api/noc/alerts`.
- Confirma que no declara métodos `POST`, `PUT`, `PATCH` ni `DELETE` dentro del módulo NOC.
- Confirma empty state y texto: `Esta vista no ejecuta comandos ni modifica routers.`
- Confirma visibilidad RBAC para Super Admin, Administrador, Técnico, Soporte y Solo lectura.
- Confirma que Cobranza no tiene el tab `noc` en RBAC frontend.

Bundle desplegado validado con no-cache:

- Contiene `NOC Read-Only`.
- Contiene `READ-ONLY`.
- Contiene `/api/noc/summary`.
- Contiene `/api/noc/routers`.
- Contiene `/api/noc/alerts`.
- Contiene empty state `Sin alertas derivadas`.

## Polling / rate-limit hygiene

Validación realizada en navegador staging:

- Se navegó Dashboard -> NOC Read-Only -> Inventory Routers.
- Consola del navegador revisada después de la navegación: 0 errores JS y 0 mensajes de consola.
- Durante una ventana de observación posterior a navegación no se observaron loops agresivos de polling.
- Resource timings tras limpiar el buffer y navegar mostraron solo llamadas aisladas esperadas, no spam continuo.
- No se observaron 429 repetitivos en consola.
- La suite `tests/unit/api.backoff.test.ts` pasó como parte de `npm test`, cubriendo el hotfix de backoff/rate-limit.

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
- `service_role`.
- `MIKROTIK_CREDENTIALS_KEY` como valor/log sensible.
- `encrypted_password` / `encryptedPassword`.
- Private keys.
- Preshared keys.
- Scripts RouterOS completos.

Resultado: PASS.

## Resultado final

✅ FASE 4.11.2 APROBADA

NOC Read-Only Foundation quedó validado en staging sobre HEAD `7928f0a`, con `40ca179` incluido, sin activar MikroTik DB runtime, WireGuard DB runtime, Worker live, commit mode ni tocar routers reales.
