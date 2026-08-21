# T071 — Paridad de migraciones en staging (v2.0.0-rc.1) — Resultado

Fecha UTC: 2026-08-21 20:25

## Resultado

✅ **T071 CERRADA: `STAGING_MIGRATIONS_APPLIED_AND_VALIDATED`.**

Verificación estrictamente de lectura contra la base de staging (`nugacore-staging`, ref `elshnzkceutvjzxvzqad`), usando como referencia el release candidate `v2.0.0-rc.1`. No se aplicó, reparó ni revirtió ninguna migración. No se ejecutó `supabase db push`. No hubo DDL/DML de escritura contra datos de aplicación. No se desplegó nada, no se accedió a producción, no se tocó Coolify, no se conectó MikroTik/CHR, no se llamó a ningún proveedor de pagos.

## Referencia de versión

| Campo | Valor |
| --- | --- |
| SHA | `802544ca3aae9c3b1e266825cbd4fb1fe2bed663` |
| Tag | `v2.0.0-rc.1` |
| Digest de imagen | `sha256:8707a98cde486bc13697e138856c453fb7a30f2a025d3a24a49df4af6df392ff` |

## Mecanismo utilizado

Comando ejecutado:

```bash
npm run report-migration-drift
```

**Exit code: `0`.**

El script (`scripts/report-migration-drift.mjs`) es read-only por diseño: la única operación remota es un único `SELECT` compuesto por CTEs (`with … select`) sobre `supabase_migrations.schema_migrations` e `information_schema.columns`; no existe en el archivo ninguna otra invocación de escritura, ni `supabase db push`, ni `supabase migration repair`. Esto está cubierto por una prueba automatizada (`tests/unit/migration-drift-report.test.ts`, caso `does not contain mutating Supabase CLI operations`), ejecutada como parte de esta verificación con resultado verde (6/6 pasadas).

## Credencial utilizada

Se configuró `MIGRATION_DRIFT_DATABASE_URL` apuntando a un **rol de Postgres de solo lectura**, creado específicamente para esta verificación (`report_migration_drift_ro`), con únicamente:

- `LOGIN`, sin `SUPERUSER`, sin `CREATEDB`, sin `CREATEROLE`, sin `REPLICATION`, `CONNECTION LIMIT 3`.
- `GRANT SELECT` sobre todas las tablas de `public` (con `ALTER DEFAULT PRIVILEGES` para que alcance a tablas futuras).
- `GRANT SELECT` sobre `supabase_migrations.schema_migrations`.

Se verificó explícitamente, conectado como ese rol y no como administrador, que:

- una lectura (`select count(*) from supabase_migrations.schema_migrations`) funciona (devolvió 76, coincidiendo con el resultado del reporte);
- un intento de escritura (`create table public.__probe_should_fail(...)`) fue **rechazado** con `permission denied`, confirmando que el rol es real y verdaderamente de solo lectura, no sólo nominalmente.

Ninguna URL completa, hostname sensible, usuario, contraseña, token ni variable de entorno completa fue impresa en ningún momento de esta sesión.

## Resultado del reporte

```
status: PASS
local_migration_files: 76
local_unique_versions: 76
local_duplicate_versions: 0

remote_status: PASS
remote_applied_migrations: 76

critical_tenant_tables:
  - PASS: tenants
  - PASS: memberships/users/profiles
  - PASS: customers (clients)
  - PASS: plans
  - PASS: invoices
  - PASS: payments
  - PASS: inventory_items
  - PASS: warehouses
  - PASS: inventory_transfers
  - PASS: routers (mikrotik_routers)
  - PASS: router_enrollments (router_enrollment)
  - PASS: MikroTik integration tables

No migrations were applied. No Supabase CLI mutation commands were used.
```

## Conteos y comparación

| | Local | Remoto |
| --- | --- | --- |
| Migraciones | 76 archivos, 76 versiones únicas | 76 aplicadas |
| Duplicados | 0 | — |
| Faltantes en remoto | **0** | — |
| Extra en remoto (no documentado) | — | **0** |
| Extra en remoto (conocido/documentado) | — | 0 en esta comparación* |

\* `KNOWN_REMOTE_EXTRA_VERSIONS` en `scripts/report-migration-drift.mjs` documenta un huérfano histórico (`20260619033952`); no apareció como bloqueante en este resultado porque el conjunto remoto coincide exactamente con el local.

**Verificación columna por columna**, no sólo por `schema_migrations` (que fue precisamente lo que ocultó el drift anterior de `20260717050000_multi_tenant_complete_ssot`, documentado en `docs/deployment/SUPABASE_MIGRATIONS_SYNC.md`): las 12 verificaciones de tablas críticas de tenant —`tenants`, `tenant_memberships`/`users_profile`, `clients`, `plans`, `invoices`, `payments`, `inventory_items`, `warehouses`, `inventory_transfers`, `mikrotik_routers`, `router_enrollment`, y las tablas de integración MikroTik— confirmaron que las columnas requeridas (`tenant_id`, `id`, etc.) existen realmente en staging.

## Clasificación final

**`STAGING_MIGRATIONS_APPLIED_AND_VALIDATED`**

Justificación: el script produjo `status: PASS` y `remote_status: PASS`, con conteos idénticos (76/76), cero faltantes, cero extras no documentados, cero duplicados bloqueantes, y las 12 verificaciones críticas de columnas en `PASS`. Esto constituye la equivalencia demostrada que exige el criterio de cierre de T071 (`docs/reports/PROJECT_STATUS_CURRENT.md`, sección "Paridad del esquema en staging").

## Alcance NO cubierto por este resultado

Este resultado **no** afirma ni implica:

- que staging esté desplegado con la imagen `v2.0.0-rc.1` (el despliegue es una acción separada, no realizada aquí);
- que producción esté lista (T072, T073 siguen abiertas, sin relación con esta verificación);
- que los gates live estén activados (siguen apagados);
- ninguna validación de escritura RouterOS, de proveedores de pago, ni de restore/backup.

## Confirmación de alcance

Ninguna migración fue aplicada, reparada ni revertida. No se ejecutó `supabase db push`. No hubo DDL/DML de escritura contra datos de aplicación (el único intento de escritura fue una prueba negativa deliberada, que fue rechazada). No hubo despliegue. No hubo acceso a producción. No se crearon, movieron ni eliminaron tags. No se creó ningún Release ni imagen GHCR adicional. No se modificó ningún ruleset. No se activó ningún gate live.
