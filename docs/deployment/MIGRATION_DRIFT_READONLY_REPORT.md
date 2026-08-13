# Migration Drift Read-Only Report

Fase 1 agrega un reporte seguro para comparar el repositorio contra un historial
remoto configurado sin aplicar migraciones ni reparar historial.

## Comando

```bash
npm run report-migration-drift
```

Sin URL SQL explicita el resultado esperado es `EXTERNAL_BLOCKED`. Esto no es un
error local: significa que falta el ambiente externo para leer
`supabase_migrations.schema_migrations`.

Para una auditoria remota, pasar una URL Postgres read-only o de mantenimiento
aprobada para el ambiente correcto:

```bash
MIGRATION_DRIFT_DATABASE_URL="$STAGING_DATABASE_URL" npm run report-migration-drift
```

No usar este comando contra produccion salvo autorizacion explicita. El script no
lee `PRODUCTION_DB_URL` por defecto para evitar un accidente operativo; si se
aprueba una auditoria productiva, inyectar deliberadamente
`MIGRATION_DRIFT_DATABASE_URL`.

## Que Reporta

- Total de archivos locales en `supabase/migrations`.
- Versiones locales unicas.
- Versiones locales duplicadas.
- Versiones aplicadas remotamente, si hay SQL.
- Migraciones locales faltantes en remoto.
- Migraciones extra en remoto.
- Drift historico conocido.
- Drift bloqueante.
- Tablas criticas tenantizadas.

## Drift Historico Conocido

Los duplicados historicos actuales se reportan como `WARNING`, no como `FAIL`:

| Version | Motivo | Mitigacion |
|---|---|---|
| `20260717040000` | Colision entre `mikrotik_router_tenant` y `onboarding_status_fail_closed`. | Cubierto por `20260718175423_mikrotik_router_enrollment_tenant_id_reapply.sql`. |
| `20260717050000` | Colision entre `multi_tenant_complete_ssot` y `olt_devices`. | Cubierto por `20260730120000_multi_tenant_complete_ssot_reapply.sql`. |

El historico remoto extra `20260619033952` tambien es `WARNING`: es una fila
documentada e inocua equivalente a la reconciliacion de `mikrotik_routers`.

Cualquier duplicado nuevo, migracion local faltante en remoto, extra remoto no
documentado o columna critica sin `tenant_id` es `FAIL`.

## Tablas Criticas

El chequeo remoto, cuando SQL esta configurado, valida columnas minimas en:

- `tenants`
- `tenant_memberships`
- `users_profile`
- `clients`
- `plans`
- `invoices`
- `payments`
- `inventory_items`
- `warehouses`
- `inventory_transfers`
- `mikrotik_routers`
- `router_enrollment`
- `mikrotik_command_audit`
- `mikrotik_router_credentials`
- `wisp_integration_settings`

## Garantias De Seguridad

- Solo lectura.
- No ejecuta `supabase db push`.
- No ejecuta `supabase migration repair`.
- No ejecuta DDL ni DML.
- No imprime URLs con password.
- Usa variables `PG*` para `psql`, evitando pasar passwords por argumentos.
- Si falta SQL remoto o `psql`, sale 0 con `EXTERNAL_BLOCKED`.
