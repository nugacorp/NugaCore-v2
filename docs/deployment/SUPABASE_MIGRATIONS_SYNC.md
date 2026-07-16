# Estado de sincronización de migraciones · GitHub ↔ Supabase

Proyecto Supabase: `elshnzkceutvjzxvzqad` (nugacore-staging).
Última reconciliación: **2026-07-16** (tarde; vía `psql` por el pooler).

## Estado actual (2026-07-16)

**Totalmente reconciliado.** Las **33 migraciones** de `supabase/migrations/` están
aplicadas y registradas en `supabase_migrations.schema_migrations`. El historial
remoto tiene **34 registros**: las 33 + 1 huérfano (ver abajo).

Verificación: `LOCAL sin aplicar = vacío` (comparando los prefijos de versión de
los archivos locales contra la tabla de historial).

**Ninguna tabla de `public` queda sin RLS** (verificado contra `pg_class.relrowsecurity`).

> **Nota de ramas (drift temporal de repo):** cinco de las 33 aún no coexisten en la
> misma rama de Git, pero **las cinco ya están aplicadas y registradas** en la DB de
> staging (compartida):
>
> - `20260716081000_tower_onboarding_profiles` → `main` (commit `838f541`)
> - `20260715000000_client_documents_reconciliation` → rama `fix/db-schema-reconciliation`
> - `20260716120000_ftth_fiber_infrastructure` → rama `cursor/ftth-import-nap-view-cb99` (commit `bd0183e`)
> - `20260716140000_wisp_external_integrations` → rama `cursor/external-integrations-codi-cb99` (commit `676c495`)
> - `20260716153000_tower_onboarding_profiles_rls` → rama `cursor/external-integrations-codi-cb99` (commit `57af6bf`)
>
> El conteo de 33 es el del repo integrado; se normaliza cuando esas ramas se
> mergeen a `main`.

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
- **Registro huérfano `20260619033952`**: está en el historial remoto pero **no
  tiene archivo local**. Casi seguro es el vestigio de la migración de
  config_snapshots antes de renombrarla a `20260708070000` en el repo. Se deja
  intacto (borrar historial de migraciones es riesgoso); reconciliar cuando se
  confirme su origen (añadir archivo espejo o depurar el registro con autorización).
- **`inventory_items` NO tiene drift**: por diseño usa `warehouse` (TEXT, el nombre
  del almacén), no `warehouse_id` FK (ver `20260622000000_inventory_schema.sql`
  y `backend/domains/inventory/`). El remoto ya coincide con el modelo del código.
  (La sospecha de "falta warehouse_id" en auditorías previas fue un falso positivo.)
- **Conflicto histórico `mikrotik_routers` (RESUELTO)**: existían dos definiciones
  contradictorias (monitoreo en init vs provisioning en `20260605000000`). Se
  resolvió con la migración evolutiva `20260618000000_mikrotik_routers_reconciliation`
  (`ADD COLUMN IF NOT EXISTS`). Hoy `20260605000000` está aplicada y
  `USE_DB_MIKROTIK=true` opera en staging.

## Reproducir / verificar (solo `psql`, no REST)

```bash
set -a; . ./.env; set +a
export PGHOST=aws-1-us-west-1.pooler.supabase.com PGPORT=5432 \
  PGUSER="postgres.${SUPABASE_PROJECT_REF}" PGDATABASE=postgres \
  PGPASSWORD="$SUPABASE_DB_PASSWORD" PGSSLMODE=require
psql -tA -c "select version, name from supabase_migrations.schema_migrations order by version;"
```

> El CLI `supabase` instalado (2.67.1) está roto localmente por la clave
> `db.health_timeout` (inválida para esa versión) en `supabase/config.toml`; por eso
> se usa `psql` directo por el pooler en lugar de `supabase db push`. Para volver a
> usar el CLI: actualizarlo (≥2.109) o quitar esa clave del config. El REST HTTPS
> (443) sigue bloqueado desde el entorno local; ver memoria del proyecto.
