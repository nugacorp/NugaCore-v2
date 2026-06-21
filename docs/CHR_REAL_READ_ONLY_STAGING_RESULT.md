# PROD-4 CHR Real Read-Only Provider — Staging Validation Result

Fecha UTC: 2026-06-21

## Resultado

✅ PROD-4 APROBADA en staging.

Validación ejecutada sin avanzar a PROD-5, sin conectar CHR real, sin credenciales reales RouterOS, sin RB5009, sin RouterOS real, sin Worker Live, sin activar DB MikroTik/WireGuard runtime y sin tocar routers reales.

## Commit validado

- Commit funcional solicitado: `cdcbf79 fix(prod4): drop accidental navigation changes; PROD-4 is backend-only`.
- Commit base de provider abstraction incluido: `45a77b8 feat(prod4): add routeros provider abstraction`.
- `origin/main` contiene `cdcbf79` y el checkout staging fue actualizado por fast-forward.
- Observación de despliegue: Coolify reconstruyó desde `main`; el artefacto observado corresponde al HEAD actual de `main`, que incluye `cdcbf79`. La validación funcional de PROD-4 se hizo sobre ese artefacto incluyendo `cdcbf79`.

## Deploy y healthchecks

Redeploy Coolify ejecutado con force rebuild. Contenedor final observado healthy.

Healthchecks post-deploy:

| Endpoint | Resultado |
| --- | --- |
| `/api/health` | 200 |
| `/api/health/live` | 200 |
| `/api/health/ready` | 200 |

## Flags runtime

Verificados por nombre desde la configuración runtime sin imprimir secretos:

| Flag | Estado final |
| --- | --- |
| `USE_DB_MIKROTIK` | UNSET |
| `USE_DB_WIREGUARD` | UNSET |
| `MIKROTIK_WORKER_LIVE` | false |
| `MIKROTIK_COMMIT_MODE` | UNSET |
| `MIKROTIK_WRITE_ENABLED` | UNSET |
| `ROUTEROS_READONLY_PROVIDER` | mock |

También se validó temporalmente `ROUTEROS_READONLY_PROVIDER=routeros` sin cliente real ni credenciales reales. Después de esa prueba se retiró el valor temporal `routeros`, se dejó `mock` y se redeployó; staging quedó nuevamente en provider mock.

## Checks locales

Ejecutado en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 79 test files passed.
  - 7 test files skipped.
  - 1275 tests passed.
  - 46 tests skipped.
- `npm run build`: PASS.

## Provider mock/default

Con `ROUTEROS_READONLY_PROVIDER=mock`:

| Endpoint | HTTP | Source | Secret scan |
| --- | --- | --- | --- |
| `GET /api/routeros/identity` | 200 | mock | PASS |
| `GET /api/routeros/system` | 200 | mock | PASS |
| `GET /api/routeros/interfaces` | 200 | mock payload estable | PASS |
| `GET /api/routeros/routes` | 200 | mock payload estable | PASS |
| `GET /api/routeros/wireguard` | 200 | mock | PASS |

Resultado:

- `identity.readOnly=true`.
- Payloads estables.
- Sin JWTs, tokens, passwords, private keys, preshared keys, credentials ni scripts RouterOS write completos en payloads.

## Provider routeros fallback

Con `ROUTEROS_READONLY_PROVIDER=routeros` temporal, sin cliente real ni credenciales reales:

| Endpoint | HTTP | Resultado |
| --- | --- | --- |
| `GET /api/routeros/identity` | 200 | fallback a `source=mock`, `readOnly=true` |
| `GET /api/routeros/system` | 200 | fallback a `source=mock` |
| `GET /api/routeros/interfaces` | 200 | payload mock estable |
| `GET /api/routeros/routes` | 200 | payload mock estable |
| `GET /api/routeros/wireguard` | 200 | fallback a `source=mock` |

Resultado:

- La API no se rompió.
- No se configuraron credenciales reales.
- No se conectó a CHR real.
- No se ejecutó RouterOS real.
- No se detectaron secretos en payloads ni logs revisados.

## RBAC con JWT real

Validado con usuarios staging reales y JWT real, sin imprimir tokens:

| Rol | Resultado |
| --- | --- |
| Super Admin | 200 en los 5 endpoints |
| Administrador | 200 en los 5 endpoints |
| Técnico | 200 en los 5 endpoints |
| Soporte | 200 en los 5 endpoints |
| Solo lectura | 200 en los 5 endpoints |
| Cobranza | 403 en los 5 endpoints |

## Métodos write

Probado con JWT real Super Admin contra cada endpoint RouterOS:

- POST.
- PUT.
- PATCH.
- DELETE.

Resultado: todos devolvieron 404. No existe escritura y no se modificó estado.

## Static safety

Escaneo sobre `backend/domains/routeros-readonly/**`:

- `.add(`: cero hallazgos.
- `.set(`: cero hallazgos.
- `.remove(`: cero hallazgos.
- `.execute(`: cero hallazgos.
- `/ip firewall add`: cero hallazgos.
- `/ip route add`: cero hallazgos.
- `/queue simple add`: cero hallazgos.
- `/ppp secret add`: cero hallazgos.
- `/interface add`: cero hallazgos.
- `/tool fetch`: cero hallazgos.

## UI

Validado por fuente local, unit tests y bundle desplegado:

- Badge `READ ONLY LAB` presente.
- Banner `Esta vista no ejecuta cambios ni comandos RouterOS.` presente.
- Muestra identidad, sistema, CPU/RAM, interfaces, rutas y WireGuard.
- No hay botones write en el módulo read-only.
- No hay controles UI de `execute/add/remove/set` en el módulo read-only.
- Bundle desplegado contiene los textos principales del RouterOS Read-Only Lab.

## Logs y seguridad

Logs recientes del contenedor final escaneados sin imprimir contenido sensible:

- JWT-looking strings: cero hallazgos.
- Service role: cero hallazgos.
- Password assignments: cero hallazgos.
- Private keys: cero hallazgos.
- Preshared keys: cero hallazgos.
- Scripts RouterOS write completos: cero hallazgos.
- Credenciales RouterOS: cero hallazgos.

## Guardrails confirmados

- No se avanzó a PROD-5.
- No se conectó CHR real.
- No se usaron credenciales reales RouterOS.
- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó `MIKROTIK_COMMIT_MODE`.
- No se activó `MIKROTIK_WRITE_ENABLED`.
- No se ejecutaron comandos RouterOS reales.
- No se tocaron routers reales.

## Resultado final

✅ PROD-4 APROBADA.

No avanzar a PROD-5 hasta autorización explícita.
