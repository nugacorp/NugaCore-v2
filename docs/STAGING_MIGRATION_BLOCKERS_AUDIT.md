# Auditoría de bloqueadores de migración en staging

Fecha: 2026-06-17 · Proyecto: NugaCore-v2 · Entorno: Supabase staging.

Hermes aplicó 10/12 migraciones. Dos quedaron bloqueadas por el **estado real
de datos/esquema**, no por una intención incorrecta. Esta auditoría documenta la
causa raíz, la decisión y los riesgos. La corrección se hace **en el repo**
(migraciones idempotentes y evolutivas), sin aplicar nada manualmente desde aquí.

---

## Bloqueador 1 — `20260605000000_mikrotik_provisioning_schema.sql`

### Síntoma
```
ERROR: column "status" does not exist
```
al ejecutar `CREATE INDEX ... ON mikrotik_routers(status)`.

### Causa raíz
Hay **dos definiciones contradictorias** de `public.mikrotik_routers` en el repo:

- `20260531000000_init_schema.sql` ya la crea con esquema de **monitoreo**
  (`ip_address, is_online, cpu_usage_pct, memory_usage_pct, linked_tower_id,
  last_health_check_at, …`). **Es la tabla viva en la DB.**
- `20260605000000_mikrotik_provisioning_schema.sql` la **redefinía** con esquema
  de **provisioning** mediante `CREATE TABLE IF NOT EXISTS` con todas las columnas
  nuevas (`status, connection_type, vpn_ip, …`).

Como la tabla ya existe, `CREATE TABLE IF NOT EXISTS` se **salta por completo** y
las columnas de provisioning nunca se crean. El `CREATE INDEX` posterior sobre
`status` falla. Con una transacción atómica, toda la migración revierte y sus
tablas auxiliares (`mikrotik_router_credentials`, `_provisioning_tokens`,
`_provisioning_scripts`) tampoco se crean.

### Decisión
**No redefinir la tabla. Convertir la migración en evolutiva:** mantener un
`CREATE TABLE IF NOT EXISTS` mínimo (fallback) y añadir cada columna de
provisioning con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, con defaults
constantes y `CHECK` sobre el default. Los índices se crean **después** de
garantizar las columnas. No se duplican columnas equivalentes ya presentes
(`api_port`, `routeros_version`, `linked_tower_id`). RLS deny-by-default intacto.

### Riesgos
- **Datos**: nulo. `ADD COLUMN IF NOT EXISTS` con default constante no reescribe
  filas existentes ni las altera; el `CHECK` se evalúa sobre el default (lo
  cumple). No se borra ni renombra nada.
- **Doble columna de estado**: se añaden tanto `status` como `provisioning_status`
  (el backend usa `provisioning_status`). Es aditivo; reconciliar el modelo del
  backend queda para cuando se active `USE_DB_MIKROTIK`.
- **Backend**: `USE_DB_MIKROTIK=false` → el dominio corre en store; estas columnas
  no se leen aún. Cero impacto en el comportamiento actual.

### Rollback
Las columnas añadidas son inertes mientras `USE_DB_MIKROTIK=false`. Si se quisiera
revertir: `ALTER TABLE mikrotik_routers DROP COLUMN IF EXISTS <col>` (no
recomendado; son aditivas y sin uso). No hay pérdida de datos por dejarlas.

---

## Bloqueador 1b — `mikrotik_command_audit` legacy schema

### Síntoma
```
ERROR: 42703: column "action" does not exist
```
al ejecutar `CREATE INDEX ... ON mikrotik_command_audit(action)` (segundo intento
de Hermes, ya con `mikrotik_routers` resuelto).

### Causa raíz
Idéntica a `mikrotik_routers`: en staging **ya existe** `mikrotik_command_audit`
con un esquema **legacy** distinto al de la migración.

| Columnas legacy (en staging) | Columnas nuevas esperadas (migración) |
|---|---|
| `id`, `router_id`, `router_name`, `command`, `mode`, `status`, `executed_by`, `message`, `created_at` | `id`, `router_id`, `status`, `action`, `dry_run`, `actor_id`, `request_payload`, `result_summary`, `error_message`, `updated_at`, `created_at` |

Como la tabla ya existe, el `CREATE TABLE IF NOT EXISTS` con el esquema nuevo se
**salta por completo**: `action`, `dry_run`, `actor_id`, `request_payload`,
`result_summary`, `error_message`, `updated_at` nunca se crean. El `CREATE INDEX`
sobre `action` falla porque la columna no existe.

### Decisión
Misma estrategia evolutiva: `CREATE TABLE IF NOT EXISTS` mínimo (fallback) +
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para las columnas nuevas, **conservando
las legacy** (`command`, `mode`, `executed_by`, `message`, `router_name`). Backfill
**seguro y opcional** desde las legacy (`action ← command`, `actor_id ←
executed_by`, `result_summary ← jsonb_build_object('message', message)`), cada uno
protegido por un guard `information_schema` para no fallar en una DB fresca.
Índices (`action`, `router_id`, `status`, `created_at`, `dry_run`) al final.

### Riesgos
- **Datos legacy**: nulo. No se borran ni renombran columnas; no se dropea la
  tabla. El backfill solo rellena columnas nuevas que estén `NULL`/vacías y nunca
  sobreescribe datos existentes. `result_summary` se crea como `JSONB DEFAULT '{}'`.
- **Tipos**: `action`/`actor_id` son TEXT (compatibles con `command`/`executed_by`
  TEXT). `result_summary` JSONB se llena con `jsonb_build_object`, sin castear
  texto crudo. El backfill está guardado por existencia de la columna legacy.
- **status**: legacy lo tiene; al existir, `ADD COLUMN` lo omite y NO se le impone
  el CHECK nuevo (evita romper valores legacy fuera del enum).

### Rollback
Columnas nuevas inertes mientras `USE_DB_MIKROTIK=false`. `DROP COLUMN IF EXISTS`
si se quisiera revertir (no recomendado). Sin pérdida de datos legacy.

---

## Bloqueador 2 — `20260604000001_billing_data_migration.sql`

### Síntoma
```
ERROR: insert or update on table "invoices" violates foreign key constraint
       "invoices_client_id_fkey"  ·  Key (client_id)=(c-2) is not present in "clients"
```

### Causa raíz
La migración mezcla:
- **Backfill seguro** (Parte 1: poblar `*_cents`; Parte 2: migrar
  `invoice_payments` legacy → `payments`/`payment_applications`) — idempotente.
- **Seed mock** (Parte 3: facturas `fac-101..105`) cuyo guard solo verificaba la
  existencia de **`c-1`**. En staging existe `c-1` pero **no** `c-2..c-5`, así que
  el guard pasaba y luego fallaba al insertar `fac-102` (cliente `c-2`).

### Decisión
**Endurecer el guard del seed mock**: contar `c-1..c-5` y, si hay **menos de 5**,
omitir el bloque completo con `RAISE NOTICE` y `RETURN` (sin fallar). **No** crear
clientes mock automáticamente. El backfill y la migración legacy se conservan
intactos y siguen aplicándose siempre.

### Riesgos
- **Datos**: nulo. El seed sigue usando `ON CONFLICT (id) DO NOTHING`; el backfill
  tiene guards (`WHERE *_cents = 0 AND amount > 0`) y `WHERE NOT EXISTS`. No se
  borra ni duplica nada. Si los 5 clientes existen, el seed corre como antes.
- **Demo incompleto**: en entornos sin los 5 clientes, no habrá facturas mock.
  Es el comportamiento deseado (no sembrar datos huérfanos en datos reales).

### Rollback
Volver al guard anterior reintroduce el FK violation; no aplica. La corrección es
estrictamente más segura. No hay datos que revertir.

---

## Resumen

| Migración | Antes | Después |
|---|---|---|
| mikrotik_provisioning_schema | `CREATE TABLE` redefiniendo la tabla → falla en índice | `ALTER ADD COLUMN IF NOT EXISTS` evolutivo, idempotente |
| billing_data_migration | guard solo `c-1` → FK violation en `c-2` | guard exige `c-1..c-5`, omite con NOTICE si faltan |

Ambas quedan **idempotentes, no destructivas y aplicables** con o sin datos.
Conflicto de fondo (drift de `mikrotik_routers`) documentado en
`docs/SUPABASE_MIGRATIONS_SYNC.md`.
