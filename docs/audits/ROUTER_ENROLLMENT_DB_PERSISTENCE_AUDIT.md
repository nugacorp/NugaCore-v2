# Router Enrollment — DB Persistence Audit (Fase 4.9.2.1)

## Estado actual (antes de esta fase)

`backend/domains/router-enrollment/repository.ts` exponía únicamente
`enrollmentRepository`, un store **en memoria** (array `RECORDS`). El service
lo usaba directamente. No existía flag ni repositorio Supabase. Por eso Hermes
validó 4.9.2 solo contra memoria y, al apuntar a Supabase REST, obtuvo:

```
HTTP 404 · code = PGRST205   (tabla no encontrada en el schema cache)
```

Causa: la tabla `public.router_enrollment` no estaba aplicada en staging (las
migraciones existen en el repo pero Hermes no tiene acceso SQL/CLI para
aplicarlas), y no había backend que escribiera en DB aunque existiera.

## Migraciones existentes

| Archivo | Aporta |
|---|---|
| `20260612000000_router_enrollment.sql` | Tabla `router_enrollment`, índices, RLS deny-by-default |
| `20260613000000_router_enrollment_template_id.sql` | `template_id TEXT` + CHECK + índice |
| `20260613120000_router_enrollment_template_parameters.sql` | `template_parameters JSONB` |

Corrección de esta fase: se añadió a la migración base el trigger
`trg_router_enrollment_modtime` (updated_at), siguiendo el patrón
`update_modified_column()` del resto del esquema. Las migraciones son
idempotentes (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

## Tabla esperada: `public.router_enrollment`

### Columnas (esquema canónico — fuente de verdad de los mappers)

| Columna | Tipo | Record (camelCase) |
|---|---|---|
| `id` | TEXT PK | id |
| `router_id` | TEXT | routerId |
| `wg_server_id` | TEXT | wgServerId |
| `wg_peer_id` | TEXT | wgPeerId |
| `enrolled_by` | TEXT | enrolledBy |
| `status` | TEXT (CHECK) | status |
| `routeros_version` | TEXT (6/7) | routerosVersion |
| `template_id` | TEXT (CHECK) | templateId |
| `template_parameters` | JSONB | templateParameters |
| `script_hash` | TEXT | scriptHash |
| `script_downloaded_at` | TIMESTAMPTZ | scriptDownloadedAt |
| `check_online_attempts` | INTEGER | checkOnlineAttempts |
| `last_check_at` | TIMESTAMPTZ | lastCheckAt |
| `online_confirmed_at` | TIMESTAMPTZ | onlineConfirmedAt |
| `failure_reason` | TEXT | failureReason |
| `revoked_at` / `revoked_by` | TIMESTAMPTZ / TEXT | revokedAt / revokedBy |
| `created_at` / `updated_at` | TIMESTAMPTZ | createdAt / updatedAt |

> Nota: el prompt de la fase sugería nombres alternativos
> (`wireguard_server_id`, `enrollment_status`, `enrollment_mode`,
> `generated_at`, `notes`…). Se mantuvo el esquema canónico ya existente para
> NO romper datos ni migraciones aplicadas. `notes` vive en `mikrotik_routers`,
> no en enrollment. No hay columna `enrollment_mode` (no existe ese concepto).

### Campos nuevos relevantes

- `template_id` (Fase 4.9.1): plantilla real usada.
- `template_parameters` (Fase 4.9.2): JSONB con los parámetros dinámicos.

## Dependencias

- `router_id` referencia lógicamente un router en `mikrotik_routers` (store o
  DB), pero la tabla **no** declara FK (acoplamiento débil intencional: el
  enrollment puede registrarse antes de que el router exista en DB).
- `wg_peer_id` / `wg_server_id` referencian lógicamente WireGuard Manager. Sin
  FK por el mismo motivo. WireGuard tiene su propio flag `USE_DB_WIREGUARD`
  independiente: enrollment puede persistir en DB mientras WG sigue en store.

## Qué debe persistir

Todo el `RouterEnrollmentRecord` EXCEPTO el script `.rsc` (nunca se persiste;
solo `script_hash`). `template_parameters` se guarda completo (con defaults
aplicados) para regenerar el `.rsc` en `/download` sin defaults ad-hoc.

## Riesgos

### Rollback
- El flag default es `false` (store). Activar/desactivar `USE_DB_ROUTER_ENROLLMENT`
  cambia de backend sin migrar datos entre ambos: los enrollments creados en
  memoria NO aparecen en DB y viceversa. Es un corte limpio, no una sincronización.
- En modo DB, un reinicio del proceso conserva los enrollments (la memoria no).

### Secrets
- `template_parameters` puede contener passwords PPPoE (marcados `secret`). Se
  almacenan en JSONB para permitir regeneración, protegidos por **RLS
  deny-by-default** (solo service_role) y **redacción en la vista/API**
  (`<REDACTED>`). El `scriptPreview` también los omite. Nunca se loguean.
- Las claves WireGuard NO viven aquí (las gestiona WireGuard Manager cifradas).
  Enrollment solo guarda `script_hash`.

## Arquitectura implementada

```
service.ts → getEnrollmentRepository()   (factory por USE_DB_ROUTER_ENROLLMENT)
                ├─ false → StoreRouterEnrollmentRepository  (adapter async sobre enrollmentRepository)
                └─ true  → SupabaseRouterEnrollmentRepository (mappers snake_case ↔ camelCase)
```

`enrollmentRepository` (store síncrono) se conserva intacto para los tests
herméticos y como backing del adaptador store. Contratos HTTP sin cambios.
