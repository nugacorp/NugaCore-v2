# Estado de sincronización de migraciones · GitHub ↔ Supabase

Proyecto Supabase: `elshnzkceutvjzxvzqad` (nugacore-staging).
Última reconciliación: **2026-07-16** (vía `psql` por el pooler).

## Estado actual (2026-07-16, tras barrido de las 48 ramas)

**Totalmente reconciliado. Cero migraciones pendientes.** Las **34 migraciones**
que existen en **cualquier rama del repo** (no solo en `main`) están aplicadas y
registradas en `supabase_migrations.schema_migrations`. El historial remoto tiene
**35 registros**: las 34 + 1 huérfano, cuyo origen ya está **confirmado** y es
inocuo (ver abajo).

**Ninguna tabla de `public` queda sin RLS** (verificado contra `pg_class.relrowsecurity`).

### Cómo se verificó (barrido completo, no solo la rama actual)

Las migraciones aparecen en ramas de agentes antes de llegar a `main`, así que
comparar solo el working tree da falsos "sin pendientes". El barrido correcto
recorre **todas** las ramas remotas:

```bash
# Todas las migraciones que existen en cualquier rama
for b in $(git branch -r --format='%(refname:short)' | grep -v 'origin$'); do
  git ls-tree -r --name-only "$b" -- supabase/migrations/ | grep '\.sql$'
done | sort -u > /tmp/all_migs.txt

# Historial aplicado
psql -tA -c "select version from supabase_migrations.schema_migrations order by version;" > /tmp/applied.txt

# A) en el repo pero sin aplicar   B) aplicado sin archivo (huérfano)
```

Resultado 2026-07-16: **A) vacío**, **B) solo `20260619033952`**.

> **Nota de ramas (drift temporal de repo):** cuatro de las 34 aún no están en
> `main`, pero **las cuatro ya están aplicadas y registradas** en la DB de staging
> (compartida). `main` tiene 29 archivos; el conteo de 34 es el del repo integrado:
>
> - `20260715000000_client_documents_reconciliation` → rama `fix/db-schema-reconciliation`
> - `20260716160000_rls_fiber_tables` → rama `fix/db-schema-reconciliation`
> - `20260716120000_ftth_fiber_infrastructure` → rama `cursor/ftth-import-nap-view-cb99` (commit `bd0183e`)
> - `20260716140000_wisp_external_integrations` → rama `cursor/external-integrations-codi-cb99` (commit `676c495`)
> - `20260716153000_tower_onboarding_profiles_rls` → rama `cursor/external-integrations-codi-cb99` (commit `57af6bf`)
>
> Ya normalizadas en `main`: `20260716081000_tower_onboarding_profiles` (`838f541`)
> y `20260716200000_multi_tenant_foundation` (merge `47fdb3c`).

### Reconciliación 2026-07-16 · noche (multi-tenant)

| Versión | Migración | Acción |
|---|---|---|
| 20260716200000 | multi_tenant_foundation | **Nueva.** Crea `public.tenant_memberships` (user↔tenant, UNIQUE `(tenant_id, user_id)`, FK a `tenants` CASCADE) y el helper `public.is_tenant_member(TEXT)`; añade `tenant_id` (FK a `tenants` RESTRICT) a `clients`, `towers`, `tower_onboarding_profiles`, `plans`, `invoices` y `network_sectors`, con backfill a `tenant-default`, `SET DEFAULT`, `SET NOT NULL` e índices por `tenant_id` (+ `radius_accounting`). RLS `service_role` only en las 9 tablas. **Se corrigió antes de aplicar** (ver abajo): la versión original tenía una escalada de privilegios. Backfill real: **5 filas de `plans`** → `tenant-default` (el resto de tablas piloto estaban vacías). Aplicada y registrada. |

### Drift resuelto: escalada de privilegios en `is_tenant_member`

La versión original de `20260716200000` autorizaba por claim JWT con este
`COALESCE`:

```sql
COALESCE(
  auth.jwt() -> 'app_metadata'  ->> 'tenant_id',
  auth.jwt() -> 'user_metadata' ->> 'tenant_id'   -- ← editable por el usuario
) = p_tenant_id
```

`user_metadata` lo escribe **el propio usuario** desde el navegador con la anon key
(`supabase.auth.updateUser({ data: { tenant_id: 'tenant-default' } })`). Combinado
con las políticas `authenticated ... FOR ALL` que creaba la misma migración,
cualquiera de los usuarios de `auth.users` podía auto-asignarse el tenant y
leer/insertar/actualizar/**borrar** `clients`, `invoices`, `plans`, `towers` y
`network_sectors`, saltándose por completo el RBAC del backend (p. ej. un rol
"Solo lectura" borrando facturación).

Verificado contra staging con un JWT simulado: la fórmula original devolvía
`true`; la corregida devuelve `false` y el atacante lee 0 filas.

Correcciones (commits `e2528d4` / `39b6d66` en `cursor/multi-tenant-foundation-cb99`):

- `is_tenant_member()` autoriza **solo por membresía real** (`tenant_memberships`).
  Ningún claim JWT sustituye a la tabla de membresías.
- **No se crean políticas `authenticated`**: ningún consumidor las necesita (el
  frontend usa Supabase solo para login, no consulta datos vía PostgREST; ver
  `src/lib/supabase.ts`) y abrían acceso directo saltando el RBAC. El scoping por
  tenant lo hace `backend/domains/tenancy/resolve-tenant.ts` con `service_role`.

> **`MULTI_TENANT_ENABLED=false` no mitigaba nada**: es un flag de aplicación que
> solo apaga el scoping en Express. Las políticas RLS viven en la DB y aplican
> desde el momento en que se aplica la migración.

### Reconciliación 2026-07-16 · tarde (integraciones externas + RLS)

| Versión | Migración | Acción |
|---|---|---|
| 20260716140000 | wisp_external_integrations | **Nueva.** Crea `public.wisp_integration_settings` (fila única `id='default'`) con la configuración Stripe/WhatsApp/Telegram/CoDi, y añade a `clients` las columnas `notification_channel` (NOT NULL DEFAULT `'whatsapp'` + CHECK), `telegram_chat_id` y `billing_zone_id`, + índice `idx_clients_notification_channel`. Aditiva e idempotente; tabla nueva (0 filas) y `clients` con 0 filas al aplicar. **Se corrigió antes de aplicar** (ver abajo): el archivo original creaba la tabla de credenciales sin RLS. Aplicada y registrada. |
| 20260716153000 | tower_onboarding_profiles_rls | **Nueva.** Activa RLS + política `tower_onboarding_profiles_service_role` en `tower_onboarding_profiles`, que había nacido sin RLS en `20260716081000`. Aplicada y registrada. |
| 20260716160000 | rls_fiber_tables | **Nueva.** Activa RLS + políticas `_service_role` en `fiber_segments` y `fiber_threads`, que habían nacido sin RLS en `20260716120000`. Aplicada y registrada. |

### Drift resuelto: credenciales expuestas en `wisp_integration_settings`

`20260716140000_wisp_external_integrations.sql` creaba `public.wisp_integration_settings`
—que guarda `stripe_secret_key`, `stripe_webhook_secret`, `whatsapp_access_token`,
`telegram_bot_token`, `codi_webhook_secret` y `codi_clabe` **en texto plano**— sin
`ENABLE ROW LEVEL SECURITY`.

Los *default privileges* de `public` otorgan a `anon` **todos** los privilegios
(`arwdDxtm`) sobre las tablas nuevas creadas por `postgres`. Sin RLS, PostgREST
habría expuesto la tabla a lectura **y escritura** con la anon key (que es pública
por diseño). Es el mismo fallo que corrigió `20260713180000` (lint 0013
`rls_disabled_in_public` / 0023 `sensitive_columns_exposed`).

Se corrigió el archivo **en origen** (commit `676c495` en la rama
`cursor/external-integrations-codi-cb99`) añadiendo RLS + política `service_role`
antes de aplicarlo, de modo que la tabla nunca llegó a existir sin RLS y un
entorno nuevo creado desde cero (p. ej. producción) tampoco la reintroduce.
El backend accede vía `service_role`, que bypassa RLS: sin impacto funcional.

**Por qué reaparece este drift:** la "red de seguridad" de `20260713180000` recorre
las tablas sin RLS *en el momento de aplicarse*; no protege a las tablas creadas
después. Toda migración que cree una tabla en `public` debe activar RLS ella misma.

### Reconciliación 2026-07-16 (mañana)

### Reconciliación 2026-07-16 (lo que se aplicó hoy)

| Versión | Migración | Acción |
|---|---|---|
| 20260716081000 | tower_onboarding_profiles | **Nueva.** Crea `public.tower_onboarding_profiles`: PK `tower_id` con FK a `towers(id)` `ON DELETE CASCADE`, más `zone_name`, `billing_cycle_day` (CHECK 1–31), `billing_cycle_time`, `router_id`, `router_name` y timestamps; + índice `idx_tower_onboarding_zone (zone_name)`. Aditiva e idempotente (`CREATE TABLE/INDEX IF NOT EXISTS`); tabla nueva (0 filas). Aplicada y registrada. Cierra el drift que cubría el fallback de `4edca93` ("onboarding torre si tabla DB aún no existe"): el onboarding de torre ya persiste en la tabla real. |
| 20260716120000 | ftth_fiber_infrastructure | **Nueva.** Crea `public.fiber_segments` (tramos de fibra; FK `nap_id`→`nap_boxes` SET NULL, `coordinates` JSONB, `thread_count` CHECK ≥1) y `public.fiber_threads` (hilos; FK `segment_id`→`fiber_segments` CASCADE, `nap_id`/`continues_to_nap_id`→`nap_boxes`, UNIQUE `(segment_id, thread_num)`), + índices por `nap_id`/`segment_id`/`segment_type`. Añade a `nap_ports` las columnas `thread_id`→`fiber_threads`, `continues_to_nap_id`→`nap_boxes` y `continues_to_thread` (continuidad de hilo). Aditiva e idempotente (`CREATE TABLE`/`ADD COLUMN IF NOT EXISTS`); tablas nuevas (0 filas). Requiere `nap_boxes`/`nap_ports` preexistentes (verificado). Aplicada y registrada. Da soporte al importador CSV/GeoJSON y a la vista NAP de la rama FTTH. |

### Reconciliación 2026-07-15

| Versión | Migración | Acción |
|---|---|---|
| 20260708070000 | inventory_config_snapshots | La tabla ya existía en el remoto pero la migración **no estaba registrada** (drift de tracking). Se corrió (idempotente, no-op sobre la tabla; aseguró índices/RLS/policy) y se **registró** en el historial. |
| 20260715000000 | client_documents_reconciliation | **Nueva.** Cierra el drift de esquema de `client_documents` (ver abajo). Aplicada y registrada. |

### Drift resuelto: `client_documents`

`client_documents` se creó en `init_schema` (20260531000000) con el modelo viejo
(`name`, `file_url` **NOT NULL**, `file_type`, `doc_date`). El módulo CRM 360
(`20260707100000_wisp_os_schema`) intentó recrearla con el modelo nuevo vía
`CREATE TABLE IF NOT EXISTS`, pero fue **no-op** porque la tabla ya existía → drift.

El backend (`backend/domains/client-360/service.ts`) inserta/lee `doc_type,
file_name, storage_path, mime_type, uploaded_by` y **no** llena `name`/`file_url`,
por lo que sus inserts fallaban contra el NOT NULL legacy.

La migración `20260715000000_client_documents_reconciliation.sql` (aditiva e
idempotente) añade las columnas del modelo CRM 360 (`doc_type` con default `'other'`
+ CHECK, `file_name` NOT NULL, `storage_path`, `mime_type`, `uploaded_by`), hace
backfill desde las legacy y libera el NOT NULL de `name`/`file_url`. No elimina
columnas ni datos. (Tabla vacía al aplicar: 0 filas.)

## Pendientes / notas

- **Regla para migraciones nuevas**: toda migración que cree una tabla en `public`
  debe incluir `ENABLE ROW LEVEL SECURITY` + política `<tabla>_service_role` en la
  **misma** migración. Las barridas de `20260713180000` / `20260713190000` solo
  cubrieron las tablas existentes al aplicarse; ya reaparecieron cuatro tablas sin
  RLS por confiar en ellas (`tower_onboarding_profiles`, `fiber_segments`,
  `fiber_threads`, `wisp_integration_settings`).
- **Secretos en claro en `wisp_integration_settings`** (deuda, no bloqueante): RLS
  ya impide el acceso de `anon`/`authenticated`, pero `stripe_secret_key`,
  `whatsapp_access_token`, `telegram_bot_token` y `codi_webhook_secret` se guardan
  sin cifrar; quedan legibles para cualquiera con la service_role key o acceso a la
  DB, y en los backups. Evaluar Supabase Vault (`vault.create_secret`) o mover las
  credenciales a variables de entorno del backend. Ver `docs/runbooks/SECRET_ROTATION_RUNBOOK.md`.
- **Registro huérfano `20260619033952` — ORIGEN CONFIRMADO (2026-07-16), inocuo.**
  Está en el historial remoto y no tiene archivo en ninguna rama. **La hipótesis
  previa era errónea**: no era el vestigio de config_snapshots. Su nombre real es
  `mikrotik_routers_reconciliation_strict_db1` y el registro **conserva sus
  `statements`**, lo que permitió identificarlo con certeza:

  ```sql
  select name, statements from supabase_migrations.schema_migrations
   where version = '20260619033952';
  ```

  Su SQL es **byte a byte idéntico** (normalizando comentarios y espacios) al de
  `20260618000000_mikrotik_routers_reconciliation.sql`: las mismas 10 columnas
  `ADD COLUMN IF NOT EXISTS` sobre `mikrotik_routers` y los mismos 4 índices. Es
  una aplicación ad-hoc del mismo contrato "strict DB-1" hecha el 2026-06-19 vía
  Studio/API (por eso guardó `statements`, cosa que `psql` no hace), en paralelo
  al archivo del repo, que se registró con su propia versión `20260618000000`.

  **Impacto: ninguno.** El SQL es aditivo e idempotente y ya está aplicado
  (verificado: las 10/10 columnas existen). El duplicado solo ocupa una fila del
  historial. **Se deja intacto a propósito**: borrar historial de migraciones es
  riesgoso y aquí no aporta nada. Si algún día molesta el descuadre de conteo
  (35 registros vs 34 archivos), la opción segura es añadir un archivo espejo
  vacío/idempotente, no borrar la fila.
- **`inventory_items` NO tiene drift**: por diseño usa `warehouse` (TEXT, el nombre
  del almacén), no `warehouse_id` FK (ver `20260622000000_inventory_schema.sql`
  y `backend/domains/inventory/`). El remoto ya coincide con el modelo del código.
  (La sospecha de "falta warehouse_id" en auditorías previas fue un falso positivo.)
- **Conflicto histórico `mikrotik_routers` (RESUELTO)**: existían dos definiciones
  contradictorias (monitoreo en init vs provisioning en `20260605000000`). Se
  resolvió con la migración evolutiva `20260618000000_mikrotik_routers_reconciliation`
  (`ADD COLUMN IF NOT EXISTS`). Hoy `20260605000000` está aplicada y
  `USE_DB_MIKROTIK=true` opera en staging. (El huérfano `20260619033952` es una
  aplicación duplicada de esta misma reconciliación; ver arriba.)

## Reproducir / verificar (solo `psql`, no REST)

```bash
set -a; . ./.env; set +a
export PGHOST=aws-1-us-west-1.pooler.supabase.com PGPORT=5432 \
  PGUSER="postgres.${SUPABASE_PROJECT_REF}" PGDATABASE=postgres \
  PGPASSWORD="$SUPABASE_DB_PASSWORD" PGSSLMODE=require

# Historial aplicado
psql -tA -c "select version, name from supabase_migrations.schema_migrations order by version;"

# Ninguna tabla de public sin RLS (debe salir vacío)
psql -tA -c "select relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;"

# Ninguna política que abra acceso a anon/authenticated
# (solo debe aparecer inventory_config_snapshots_deny_all, que es USING (false))
psql -c "select tablename, policyname, qual from pg_policies
 where schemaname='public' and ('anon' = any(roles) or 'authenticated' = any(roles));"
```

Para el barrido de pendientes sobre **todas** las ramas, ver "Cómo se verificó"
arriba: comparar solo el working tree da falsos negativos.

> El CLI `supabase` instalado (2.67.1) está roto localmente por la clave
> `db.health_timeout` (inválida para esa versión) en `supabase/config.toml`; por eso
> se usa `psql` directo por el pooler en lugar de `supabase db push`. Para volver a
> usar el CLI: actualizarlo (≥2.109) o quitar esa clave del config. El REST HTTPS
> (443) sigue bloqueado desde el entorno local; ver memoria del proyecto.
