# Validación Staging — Fase 4.9.2 + 4.9.2.1

Fecha UTC: 2026-06-17T01:09:20Z
Entorno: staging Coolify
Commit funcional validado/desplegado: `2ac6a1fec93d0cf09284bf03b6eca1efa258d6a9`
Resultado final: **NO APROBADA**

## Resumen ejecutivo

El commit `2ac6a1f` fue fast-forward en `/opt/nugacore-staging` y se desplegó en Coolify. El contenedor quedó `healthy` y los healthchecks respondieron 200.

La revalidación de persistencia real Supabase sigue bloqueada porque `public.router_enrollment` no existe o no está expuesta en el schema cache de PostgREST. Por lo tanto no se pudo demostrar `template_parameters`, DB mode, persistencia tras restart ni download regenerado desde DB.

No se creó `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md` ni commit de aprobación porque los criterios de aprobación no pasaron.

## Restricciones respetadas

- No se tocaron routers reales.
- No se importaron scripts `.rsc`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó commit mode.
- No se ejecutaron comandos RouterOS.
- No se imprimieron secretos ni scripts completos.
- No se borró el servidor WireGuard default.

## A. Esquema Supabase esperado en repo

Migraciones revisadas:

- `supabase/migrations/20260612000000_router_enrollment.sql`
- `supabase/migrations/20260613000000_router_enrollment_template_id.sql`
- `supabase/migrations/20260613120000_router_enrollment_template_parameters.sql`

Resultado de inspección:

- Tabla canónica en repo: `router_enrollment`
- Columna `template_id`: definida en `20260613000000_router_enrollment_template_id.sql`
- Columna `template_parameters JSONB`: definida en `20260613120000_router_enrollment_template_parameters.sql`
- La migración base persiste `script_hash`.
- La migración base no define columna `script`; el `.rsc` completo no debe persistirse.

## B. Schema cache / Supabase REST

Validación ejecutada con credenciales de servicio disponibles en el contenedor, sin imprimir secretos:

`RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs`

Resultado:

- `router_enrollment`: FAIL
- Error: `Could not find the table 'public.router_enrollment' in the schema cache`

REST directo:

| Endpoint | Resultado |
| --- | --- |
| `/rest/v1/router_enrollment?select=*&limit=1` | HTTP 404 `PGRST205` |
| `/rest/v1/router_enrollments?select=*&limit=1` | HTTP 404 `PGRST205` |
| `/rest/v1/router_enrollment?select=template_parameters&limit=1` | HTTP 404 `PGRST205` |
| `/rest/v1/mikrotik_routers?select=id&limit=1` | HTTP 200 |

Conclusión:

- Supabase REST y service role funcionan.
- `router_enrollment` no está disponible en PostgREST.
- `router_enrollments` tampoco está disponible.
- `template_parameters` no puede validarse porque la tabla no está expuesta.

## C. DB mode / deploy

Staging fue desplegado con la imagen:

- `zmjc5lnl0wj3kh0uj14s2p4i:2ac6a1fec93d0cf09284bf03b6eca1efa258d6a9`

Healthchecks post-deploy:

| Endpoint | Resultado |
| --- | --- |
| `/api/health` | 200 |
| `/api/health/live` | 200 |
| `/api/health/ready` | 200 |

Flags observados en el contenedor:

- `USE_DB_ROUTER_ENROLLMENT`: unset
- `MIKROTIK_WORKER_LIVE`: false
- `MIKROTIK_COMMIT_MODE`: unset
- `NODE_ENV`: staging

No se dejó activado `USE_DB_ROUTER_ENROLLMENT=true` en staging porque el prerrequisito de schema DB falló. Activarlo con la tabla ausente haría que Router Enrollment falle contra Supabase.

## D. DB contract tests

Comando ejecutado con opt-in DB y modo Router Enrollment DB:

`RUN_DB_TESTS=true USE_DB_ROUTER_ENROLLMENT=true AUTH_TRUST_HEADERS=true npm run test:db`

Resultado:

- Suites DB existentes de billing/customers/plans: PASS.
- Suite `tests/contract/router-enrollment.db.contract.test.ts`: FAIL.
- Falla raíz: el primer `POST /api/router-enrollment/start` en modo DB devuelve 500 porque Supabase responde que `public.router_enrollment` no está en el schema cache.

Error relevante, sanitizado:

- `router_enrollment.create: Could not find the table 'public.router_enrollment' in the schema cache`

## E/F/G. Persistencia real, restart y download desde DB

No ejecutados como aprobación porque el prerrequisito Supabase falló:

- No existe/expone `public.router_enrollment` vía REST.
- No se puede crear enrollment en modo DB.
- No se puede comprobar fila con `template_parameters` en Supabase.
- No se puede demostrar supervivencia real después de restart.
- No se puede demostrar download regenerado desde DB.

La funcionalidad API/UI previamente validada en modo store no reemplaza este criterio, porque el objetivo de esta revalidación era persistencia real Supabase.

## H. Seguridad

Verificación realizada hasta donde permite el bloqueo:

- El código/migración usa `script_hash` y no define columna `script`.
- No se imprimieron tokens, JWT, service role, private keys, preshared keys, PPPoE passwords ni scripts completos.
- `MIKROTIK_WORKER_LIVE=false`.
- No se ejecutaron acciones RouterOS.

## I. Limpieza

No se crearon enrollments DB porque la tabla no existe/expone; por tanto no hubo filas DB de Router Enrollment que limpiar.

Se ejecutaron healthchecks finales:

- `/api/health` -> 200
- `/api/health/live` -> 200
- `/api/health/ready` -> 200

## Bloqueador exacto

- Tabla esperada: `public.router_enrollment`
- Tabla encontrada: ninguna (`router_enrollment` y `router_enrollments` devuelven `PGRST205`)
- Columna esperada: `template_parameters JSONB`
- Columna encontrada/no encontrada: no verificable porque la tabla no está en PostgREST
- Acceso SQL desde Hermes: no disponible (`psql`, Supabase CLI, `DATABASE_URL`, `POSTGRES_*`/`PG*` no disponibles)
- Schema cache refresh: no ejecutable desde Hermes porque requiere SQL/admin
- Repository DB real en código: sí existe en `2ac6a1f`, detrás de `USE_DB_ROUTER_ENROLLMENT`
- Runtime staging DB mode: no activado de forma permanente por schema ausente

## Acción requerida

1. Aplicar en Supabase staging las migraciones:
   - `20260612000000_router_enrollment.sql`
   - `20260613000000_router_enrollment_template_id.sql`
   - `20260613120000_router_enrollment_template_parameters.sql`
2. Refrescar PostgREST schema cache:
   - `NOTIFY pgrst, 'reload schema';`
   - o mecanismo equivalente desde Supabase Dashboard/admin.
3. Revalidar:
   - `RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs`
   - `GET /rest/v1/router_enrollment?select=template_parameters&limit=1` -> 200/206
   - `RUN_DB_TESTS=true npm run test:db`
4. Solo después activar `USE_DB_ROUTER_ENROLLMENT=true` en staging y repetir persistencia real + restart + download.

## Resultado final

**FASE 4.9.2 + 4.9.2.1 NO APROBADA**.
