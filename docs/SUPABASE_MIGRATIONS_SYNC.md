# Estado de sincronización de migraciones · GitHub ↔ Supabase

Proyecto Supabase: `elshnzkceutvjzxvzqad` (nugacore-staging) · Sincronizado el
2026-06-17 · Reconciliado de nuevo el 2026-06-18 (snapshots 4.9.2.1).

Resumen: el historial `supabase_migrations.schema_migrations` registraba solo las
2 migraciones base, mientras que el schema remoto ya tenía aplicada (vía SQL
editor, sin registrar) la mayoría de las tablas. Se reconcilió aplicando las
migraciones pendientes que eran seguras e idempotentes y registrándolas en el
historial. Conexión vía `psql` por el pooler (el REST HTTPS está bloqueado desde
el entorno local; ver memoria del proyecto).

## Estado por migración (14 archivos en `supabase/migrations/`)

| Versión | Migración | Estado | Nota |
|---|---|---|---|
| 20260531000000 | init_schema | ✅ aplicada | base (ya registrada) |
| 20260531000001 | rls_and_seeds | ✅ aplicada | base (ya registrada) |
| 20260604000000 | billing_schema | ✅ aplicada | idempotente; objetos ya existían (no-op) |
| 20260604000001 | billing_data_migration | ⚠️ aplicada **parcial** | backfill real (Partes 1,2,4,5) aplicado (no-op: ya consistente). **Parte 3 (seed mock fac-101..105) OMITIDA** por decisión: faltan clientes c-2..c-5 y es entorno con datos reales |
| 20260605000000 | mikrotik_provisioning_schema | ❌ **NO aplicada** | conflicto de schema (ver abajo). Pendiente |
| 20260605120000 | suspension_engine | ✅ aplicada | creó suspension_policies, customer_service_state, suspension_events, suspension_orders, reactivation_orders |
| 20260605140000 | mikrotik_worker | ✅ aplicada | |
| 20260605160000 | wireguard_manager | ✅ aplicada | creó wireguard_servers/peers/ip_allocations/key_rotations |
| 20260612000000 | router_enrollment | ✅ aplicada | Fase 4.9.2.1 |
| 20260612120000 | payment_engine | ✅ aplicada | creó payment_orders, payment_events, mikrotik_actions |
| 20260613000000 | router_enrollment_template_id | ✅ aplicada | Fase 4.9.1 |
| 20260613120000 | router_enrollment_template_parameters | ✅ aplicada | Fase 4.9.2 |
| 20260617000000 | router_enrollment_router_snapshot | ✅ aplicada | Fase 4.9.2.1; columna+índice GIN ya en schema, **registrada en historial el 2026-06-18** (SQL idempotente, no-op) |
| 20260617120000 | router_enrollment_wireguard_snapshot | ✅ aplicada | Fase 4.9.2.1; ídem, **registrada el 2026-06-18** |

**13 de 14 aplicadas y registradas.** Pendiente: `mikrotik_provisioning_schema`.

## Conflicto pendiente: `mikrotik_routers` (drift del repo)

Hay **dos definiciones contradictorias** de `public.mikrotik_routers` en el repo:

- `20260531000000_init_schema.sql` la crea con esquema de **monitoreo**:
  `id, name, ip_address, api_port, username, encrypted_password, is_online,
  cpu_usage_pct, memory_usage_pct, routeros_version, linked_tower_id,
  last_health_check_at, created_at`. **Esta es la tabla aplicada en la DB.**
- `20260605000000_mikrotik_provisioning_schema.sql` (Fase 4.4) la redefine con
  esquema de **provisioning**: `status, connection_type, management_ip, vpn_ip,
  api_ssl_port, tower_id, last_seen_at, notes, updated_at…`.

Como la tabla ya existe, el `CREATE TABLE IF NOT EXISTS` se salta y la migración
falla en `CREATE INDEX … ON mikrotik_routers(status)` (la columna `status` no
existe en la versión de monitoreo). Con `psql -1` la migración revierte completa,
por lo que sus tablas auxiliares (`mikrotik_router_credentials`,
`mikrotik_provisioning_tokens`, `mikrotik_provisioning_scripts`) **no se crearon**.

La migración es **preparatoria** (`USE_DB_MIKROTIK=false`: el dominio corre sobre
el store en memoria), así que omitirla **no afecta al backend actual**.

### Resolución futura (cuando se active `USE_DB_MIKROTIK`)
Decidir una única forma canónica de `mikrotik_routers` y, en una migración nueva
con timestamp posterior, `ALTER TABLE … ADD COLUMN IF NOT EXISTS` para añadir las
columnas de provisioning (`status`, `connection_type`, `vpn_ip`, `management_ip`,
`api_ssl_port`, `tower_id`, `last_seen_at`, `notes`, `updated_at`) y crear sus
índices/tablas auxiliares — en vez de un `CREATE TABLE` que choca con init_schema.
Reconciliar también el modelo del backend (hoy el store mezcla ambos modelos).

## Reproducir / verificar (solo `psql`, no REST)

```bash
set -a; . ./.env; set +a
export PGHOST=aws-1-us-west-1.pooler.supabase.com PGPORT=5432 \
  PGUSER="postgres.${SUPABASE_PROJECT_REF}" PGDATABASE=postgres \
  PGPASSWORD="$SUPABASE_DB_PASSWORD" PGSSLMODE=require
psql -tA -c "select version, name from supabase_migrations.schema_migrations order by version;"
```

> El CLI `supabase` está roto localmente por una clave `health_timeout` inválida
> en `supabase/config.toml` para la versión instalada (2.67.1); por eso se usó
> `psql` directo en lugar de `supabase db push`. `db push` además habría intentado
> aplicar las 7 pendientes de golpe (incluida la conflictiva de provisioning).
