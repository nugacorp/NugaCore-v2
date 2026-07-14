# Fixes de migraciones staging — guía de aplicación (Hermes)

Corrige los 2 bloqueadores de staging haciendo las migraciones **idempotentes,
evolutivas y no destructivas**. No se aplicó nada manualmente desde el repo: este
documento indica cómo aplicarlas y revalidarlas en staging.

Detalle de causa raíz y decisiones: `docs/STAGING_MIGRATION_BLOCKERS_AUDIT.md`.

## Archivos cambiados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql` | **Sección 1** (`mikrotik_routers`) y **Sección 5** (`mikrotik_command_audit`) reescritas como evolutivas: `ALTER TABLE ADD COLUMN IF NOT EXISTS` sobre tablas que ya existen con esquema legacy. Routers: status, connection_type, vpn_ip, api_port, api_ssl_port, management_ip, has_credentials, provisioning_status, last_seen_at, notes, updated_at, linked_tower_id. Command audit: action, dry_run, actor_id, request_payload, result_summary, error_message, updated_at (+ backfill seguro desde command/executed_by/message). Índices y trigger después de garantizar columnas; columnas legacy conservadas; RLS sin cambios. |
| `supabase/migrations/20260604000001_billing_data_migration.sql` | Guard del seed mock ahora exige `c-1..c-5` (antes solo `c-1`). Si faltan, omite con `RAISE NOTICE` + `RETURN`. Backfill y migración legacy intactos. |
| `scripts/validate-staging-migrations.mjs` | Nuevo. Valida columnas/tablas de provisioning y ausencia de facturas mock huérfanas (REST, sin secretos). |
| `tests/unit/staging.migrations.test.ts` | Nuevo. Scan de fuente: ADD COLUMN IF NOT EXISTS, índices, guard de 5 clientes, no-creación de clientes. |

## Cómo aplicar (staging)

Las dos migraciones son idempotentes: re-aplicarlas es seguro.

```sql
-- En el SQL editor de Supabase (staging), en orden:
\i supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql
\i supabase/migrations/20260604000001_billing_data_migration.sql
```

Refrescar el schema cache de PostgREST (por las columnas/tablas nuevas):

```sql
NOTIFY pgrst, 'reload schema';
```

> Si se usa `supabase db push`: como `mikrotik_provisioning_schema` no estaba
> registrada en el historial, el push la aplicará ahora sin el error previo.

## Qué espera Hermes (resultado)

- `mikrotik_provisioning_schema` aplica **sin** `ERROR: column "status" does not exist`
  **ni** `ERROR: column "action" does not exist`.
- `mikrotik_routers` gana las columnas de provisioning sin perder las de monitoreo.
- `mikrotik_command_audit` gana las columnas nuevas (`action`, `dry_run`, `actor_id`,
  `request_payload`, `result_summary`, `error_message`, `updated_at`) **conservando**
  las legacy (`command`, `mode`, `executed_by`, `message`, `router_name`); el backfill
  rellena `action`/`actor_id`/`result_summary` desde las legacy sin sobreescribir.
- Se crean `mikrotik_router_credentials`, `mikrotik_provisioning_tokens`,
  `mikrotik_provisioning_scripts`.
- `billing_data_migration` aplica **sin** FK violation. Con `c-2..c-5` ausentes,
  emite el NOTICE de seed omitido y termina OK. Backfill aplicado.

### Cómo reintentar (Hermes)

La migración es idempotente: re-ejecutarla es seguro aunque ya se hayan aplicado
otras partes. En el SQL editor de staging:

```sql
\i supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql
NOTIFY pgrst, 'reload schema';
```

No requiere revertir nada del intento anterior (no dejó cambios: falló en el índice
y la transacción revirtió).

## Cómo revalidar

```bash
# 1. Tests herméticos (sin DB): scan de fuente de las migraciones
npm test            # incluye tests/unit/staging.migrations.test.ts

# 2. Validación contra Supabase staging (REST)
RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs
```

La validación debe reportar todas las columnas/tablas en OK y
`clientes mock: <n>/5` con 0 facturas huérfanas.

## Qué queda pendiente

- **Reconciliación del modelo `mikrotik_routers`**: hoy conviven columnas de
  monitoreo (init_schema) y de provisioning (esta migración), más `status` y
  `provisioning_status`. Unificar el modelo del backend cuando se active
  `USE_DB_MIKROTIK` (sigue en `false`; el dominio corre en store).
- **Seed mock de billing**: no se siembra hasta que existan `c-1..c-5`
  (`USE_DB_CUSTOMERS=true`). No se crean clientes automáticamente.
- **No avanzar a Fase 4.9.3.** No tocar routers reales. No activar Worker live.
