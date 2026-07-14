# Router Enrollment DB — Runbook (Hermes / Fase 4.9.2.1)

Pasos para activar y validar la persistencia real de Router Enrollment en
staging. Modo seguro: sin tocar routers reales, sin Worker live, sin commit mode.

## 1. Aplicar migraciones (en orden)

```sql
-- En el editor SQL de Supabase (staging), ejecutar en orden:
\i supabase/migrations/20260612000000_router_enrollment.sql
\i supabase/migrations/20260613000000_router_enrollment_template_id.sql
\i supabase/migrations/20260613120000_router_enrollment_template_parameters.sql
\i supabase/migrations/20260617000000_router_enrollment_router_snapshot.sql
\i supabase/migrations/20260617120000_router_enrollment_wireguard_snapshot.sql
```

Las migraciones son idempotentes: pueden re-ejecutarse sin error. Crean la
tabla `public.router_enrollment`, `template_id`, `template_parameters JSONB`,
`router_snapshot JSONB` (Fase 4.9.2 hotfix: permite que `/download` regenere el
script tras un restart sin depender del store en memoria — ver
`docs/ROUTER_ENROLLMENT_ROUTER_SNAPSHOT.md`), `wireguard_snapshot JSONB` (Fase
4.9.2 hotfix: regenera plantillas WireGuard tras restart sin el WG store; secretos
cifrados — ver `docs/ROUTER_ENROLLMENT_WIREGUARD_SNAPSHOT.md`), índices, RLS
deny-by-default y el trigger `updated_at`.

## 2. Refrescar el schema cache de PostgREST

El error `PGRST205` es schema cache desactualizado. Tras aplicar migraciones:

```sql
NOTIFY pgrst, 'reload schema';
```

(O reiniciar el servicio PostgREST / "Reload schema" en el dashboard de Supabase.)

## 3. Activar el flag y redeploy

En las variables de entorno de staging:

```
USE_DB_ROUTER_ENROLLMENT=true
```

Requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya configuradas. Redeploy
del backend. En los logs debe aparecer:

```
Router Enrollment: persistencia = Supabase (USE_DB_ROUTER_ENROLLMENT=true)
```

## 4. Validar el esquema (sin secretos)

```
RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs
```

Debe reportar la tabla y todas las columnas (incl. `template_parameters` JSONB)
en OK. Si falla, revisar pasos 1–2.

## 5. Ejecutar los DB contract tests

```
RUN_DB_TESTS=true npm run test:db
```

Incluye `tests/contract/router-enrollment.db.contract.test.ts`: crea enrollments
con `templateParameters`, valida persistencia, reinicio lógico, download,
checkOnline, revoke y redacción de secretos. La suite limpia sus propias filas.

## 6. Revalidar Fase 4.9.2 (API/UI sobre DB)

Repetir la validación funcional de 4.9.2 con el flag activo:
- `POST /api/router-enrollment/start` con `templateParameters` → 201.
- Confirmar fila en `public.router_enrollment` (REST):
  `GET /rest/v1/router_enrollment?select=template_parameters&limit=1` → 200.
- `GET /api/router-enrollment/:id` → `templateParameters` con secretos redactados.
- `GET /api/router-enrollment/:id/download` → regenera desde DB.

## Rollback

Volver a `USE_DB_ROUTER_ENROLLMENT=false` + redeploy regresa al store en memoria.
No se borran datos: las filas persistidas en DB permanecen (quedan inertes hasta
reactivar el flag).

## Notas de seguridad

- El `.rsc` nunca se persiste (solo `script_hash`).
- Passwords PPPoE en `template_parameters`: protegidos por RLS (solo
  service_role) y redactados en la API. No aparecen en logs ni en `scriptPreview`.
- No ejecutar scripts RouterOS. No activar `MIKROTIK_WORKER_LIVE`. No commit mode.
