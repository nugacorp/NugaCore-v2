# MikroTik Secret Hardening — Staging Validation Result

Fecha UTC: 2026-06-04T21:16:52Z
Ambiente: NugaCore Staging
URL: https://nugacore-staging.5.180.151.109.sslip.io
Commit validado: `9acfadb security(mikrotik): harden provisioning secret handling`

## Alcance

Validación de Fase 4.4.1 enfocada exclusivamente en hardening de secretos del módulo MikroTik Provisioning.

Restricciones respetadas:

- No se validó Worker MikroTik.
- No se validaron Suspensiones.
- No se conectaron routers reales.
- No se pegaron scripts en routers.
- No se modificó código funcional.
- No se incluyeron passwords, tokens, JWTs, service-role keys ni scripts completos en este documento.

## Actualización y despliegue

Repositorio staging:

- `git fetch origin`: OK
- `git checkout main`: OK
- `git pull --ff-only origin main`: OK
- `git log --oneline -5`: contiene `9acfadb` como HEAD local.

Coolify:

- Redeploy forzado por API de Coolify.
- Imagen/commit desplegado: `9acfadb28a33d2bdecd9c3f133d65a0e86b95ac2`.
- Contenedor staging: healthy.

Resultado: PASS.

## Healthchecks

Endpoints validados contra staging:

- `GET /api/health` -> HTTP 200
- `GET /api/health/live` -> HTTP 200
- `GET /api/health/ready` -> HTTP 200

Resultado: PASS.

## Validación de scripts de provisioning

Se autenticó como Administrador de staging y se creó un router temporal para la validación. El router fue eliminado al cierre.

Acciones realizadas:

- Crear router temporal: HTTP 201.
- Generar script SSTP: HTTP 201.
- Generar script WireGuard: HTTP 201.
- Generar rotación de credenciales con confirmación explícita: HTTP 201.
- Ejecutar dry-run de conexión: HTTP 200.

Checks SSTP:

- Contiene marca NugaCore: PASS.
- No contiene WispHub: PASS.
- Contiene usuario generado `nugacore_*`: PASS.
- Contiene scheduler/watchdog: PASS.
- Contiene API restringida a red VPN/management: PASS.
- No contiene permisos prohibidos `sniff`, `sensitive`, `romon`, `reboot`: PASS.
- `scriptHash` presente y coincide con SHA-256 local del script recibido: PASS.
- `provisioningToken` presente solo en la respuesta inicial permitida: PASS.
- No hay campos sueltos de password en la respuesta: PASS.

Checks WireGuard:

- Contiene marca NugaCore: PASS.
- No contiene WispHub: PASS.
- Contiene usuario generado `nugacore_*`: PASS.
- Contiene scheduler/watchdog WireGuard: PASS.
- Contiene API restringida a red VPN/management: PASS.
- No contiene permisos prohibidos `sniff`, `sensitive`, `romon`, `reboot`: PASS.
- `scriptHash` presente y coincide con SHA-256 local del script recibido: PASS.
- `provisioningToken` presente solo en la respuesta inicial permitida: PASS.
- No hay campos sueltos de password en la respuesta: PASS.

Resultado: PASS.

## Validación de redacción de secretos

Se validaron las funciones centrales:

- `redactSecret()`
- `redactObject()`
- `redactScript()`

Casos confirmados:

- `password=...` -> `password=****REDACTED****`
- `token=...` -> `token=****REDACTED****`
- JWT embebido -> `****REDACTED****`
- `bearer=...` -> `bearer=****REDACTED****`
- Claves de objeto tipo password/token/jwt/authorization -> `****REDACTED****`
- Strings anidados dentro de objetos se sanean.

Resultado: PASS.

## Validación de logs

Después de generar script, rotar credenciales y ejecutar dry-run, se revisaron logs recientes del contenedor staging desplegado con `9acfadb`.

No se detectaron:

- Passwords reales generados durante la prueba.
- JWT completos.
- Tokens de autorización completos.
- Provisioning tokens reales generados durante la prueba.
- Script RouterOS completo.
- `MIKROTIK_CREDENTIALS_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY`.

Resultado: PASS.

## Validación de auditoría

Auditorías revisadas:

- MikroTik command audit por API (`GET /api/mikrotik/command-audit?routerId=...`).
- MikroTik logs por API (`GET /api/mikrotik/logs`).
- Provisioning audit por pruebas contractuales automatizadas (`tests/contract/mikrotik.secret-hygiene.test.ts`).

Confirmado:

- `requestPayload` saneado: PASS.
- `resultSummary` saneado: PASS.
- `errorMessage` saneado por la red de seguridad de `recordAudit`: PASS.
- Passwords no persisten en auditoría: PASS.
- Tokens en claro no persisten en auditoría: PASS.
- Scripts completos no persisten en auditoría: PASS.

Nota: la auditoría de provisioning no está expuesta como endpoint público; la validación se hizo mediante la prueba contractual que inspecciona el store de provisioning y mediante las respuestas/API/logs expuestos en staging.

Resultado: PASS.

## Validación de respuestas API

Respuesta inicial de generación de script:

Permitido y confirmado:

- `script`: presente solo en respuesta inicial.
- `scriptHash`: presente.
- `provisioningToken`: presente solo en respuesta inicial.

Luego se consultó `GET /api/mikrotik/routers/:id`.

Ausencia confirmada:

- `plainPassword`: ausente.
- `encryptedPassword`: ausente.
- `provisioningToken`: ausente.
- `vpnPassword`: ausente.
- `apiPassword`: ausente.

Campos seguros presentes:

- `hasCredentials`: presente.
- `username`: presente.

Resultado: PASS.

## Validación de snapshot seguro

Archivo validado: `tests/helpers/safe-script-snapshot.ts`.

Confirmado:

- Produce salida determinista para el mismo input: PASS.
- Normaliza usernames volátiles `nugacore_*` a `nugacore_<ID>`: PASS.
- Oculta password API: PASS.
- Oculta password VPN: PASS.
- Conserva estructura del script: PASS.
- Mantiene marca NugaCore y comandos estructurales sin exponer secretos: PASS.

Resultado: PASS.

## Tests locales

Ejecutado en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 20 archivos de test pasaron.
  - 219 tests pasaron.
  - 5 archivos / 32 tests omitidos por configuración existente.
- `npm run build`: PASS.
  - Vite build OK.
  - Server bundle OK.

Resultado: PASS.

## Limpieza

Router temporal usado para validación:

- Eliminación: HTTP 204.
- Consulta posterior: HTTP 404.

Confirmado:

- No se dejó router ficticio de la validación.
- No se dejaron secretos visibles en respuestas API revisadas.
- No se pegaron scripts en routers.
- No se activó Worker MikroTik.

Resultado: PASS.

## Riesgos restantes

- La respuesta inicial de generación de script sigue incluyendo el script y el provisioning token por diseño; debe mantenerse como visualización única y no debe persistirse en logs, auditorías ni documentos.
- La auditoría de provisioning no tiene endpoint público de inspección; la cobertura actual depende de pruebas contractuales y del saneamiento centralizado en `recordAudit`.
- Worker MikroTik sigue fuera de alcance. Antes de activarlo, se debe repetir validación específica de ejecución real, telemetría y logs del worker.
- El helper de snapshot seguro debe seguir usándose para cualquier comparación documental o automatizada de scripts generados.

## Resultado final

PASS.

Fase 4.4.1 MikroTik Secret Hardening validada en staging.
No avanzar a Fase 4.5 ni a Worker MikroTik desde esta validación.
