# DB-1 — Resultado de implementación (MikroTik Schema Reconciliation)

> Trabajo local seguro: migración evolutiva + tipos + validador + tests + docs.
> NO toca staging/producción, NO aplica migraciones reales, NO activa flags,
> NO toca routers reales. Fecha: 2026-06-18.
> Diseño base: `docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`.

## Resultado

✅ **DB-1 implementado a nivel de repositorio** (migración, modelo canónico, tipos,
validador y tests). Pendiente: aplicación/validación en staging por Hermes (no desde Claude).

## Cambios realizados

### 1. Migración (DB-1.1)

`supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql`

Sella el modelo canónico de `public.mikrotik_routers` (unión monitoreo + provisioning) de
forma **idempotente, auto-suficiente y no destructiva**:

- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para las 10 columnas de provisioning
  (`connection_type`, `management_ip`, `vpn_ip`, `api_ssl_port`, `status`,
  `provisioning_status`, `has_credentials`, `last_seen_at`, `notes`, `updated_at`).
  Idénticas a `20260605000000` → no-op si ya existen; auto-suficiente si esa migración no
  está registrada en el historial.
- `CREATE INDEX IF NOT EXISTS` para los índices canónicos (incluido el nuevo
  `idx_mikrotik_routers_connection_type`).
- Trigger `updated_at` con guard idempotente; RLS deny-by-default.
- `COMMENT ON COLUMN` documentando canónico vs deprecated (metadata, no datos).

**Reglas cumplidas:** sin `DROP TABLE/COLUMN`, sin `DELETE/TRUNCATE/UPDATE` de datos, sin
`INSERT`, sin recrear tablas. No hay backfill de datos en la migración (decisión: el
sellado de espejos `management_ip`/`provisioning_status` queda como paso de datos posterior,
ver Pendientes).

### 2. Tipos (DB-1.2)

- `backend/domains/mikrotik/provisioning/types.ts`:
  - Nuevas constantes fuente de verdad: `CANONICAL_MIKROTIK_ROUTER_COLUMNS`,
    `RECONCILIATION_PROVISIONING_COLUMNS`, `DEPRECATED_MIKROTIK_ROUTER_COLUMNS` +
    el tipo `CanonicalMikrotikRouterColumn`.
  - Doc de `ProvisionedRouterView`: `status` deriva de `provisioning_status` canónico.
- `backend/state/store.ts` → `MikrotikRouterRegistryItem`: alineado con el canónico con
  campos opcionales `status?` (espejo deprecated), `hasCredentials?`, `createdAt?`,
  `updatedAt?`. Opcionales → no rompen el store ni los seeds.
- `src/types.ts` → `MikrotikRouterView` ya incluía los espejos legacy (`ipAddress?`,
  `isOnline?`); sin cambios necesarios.

### 3. Validador (DB-1.3)

`scripts/validate-mikrotik-schema.mjs` (inspirado en
`validate-router-enrollment-schema.mjs`):

- Opt-in `RUN_DB_TESTS=true` + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; sin ellos
  imprime instrucciones y sale 0.
- Verifica tabla `mikrotik_routers`, las columnas canónicas y las tablas auxiliares de
  provisioning, vía Supabase REST. **Nunca imprime secretos.**

### 4. Tests (DB-1.4)

`tests/unit/mikrotik.schema-reconciliation.test.ts` (12 tests):

- La migración añade cada columna de provisioning con `ADD COLUMN IF NOT EXISTS`.
- Índices canónicos con `IF NOT EXISTS` (incl. `connection_type`) y creados tras las columnas.
- No destructiva (sin DROP/DELETE/TRUNCATE/INSERT/UPDATE de datos).
- COMMENT canónico/deprecated presente; RLS habilitado.
- Consistencia: las constantes TS cubren ambos modelos, sin duplicados, y el validador
  `.mjs` verifica exactamente el mismo conjunto canónico.

## Validación

- `npm run typecheck` → PASS.
- `npm test` → PASS (incluye los 12 tests nuevos).
- `npm run build` → PASS.
- `RUN_DB_TESTS=true npm run test:db` → **no ejecutado localmente** (requiere credenciales
  Supabase; no se toca staging desde Claude). Lo corre Hermes en staging.

## Runbook para Hermes (aplicación en staging, fuera de esta sesión)

1. Aplicar en orden (idempotente):
   - `supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql` (si no estaba registrada).
   - `supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql`.
2. `NOTIFY pgrst, 'reload schema';`.
3. Validar: `RUN_DB_TESTS=true node scripts/validate-mikrotik-schema.mjs`.
4. Registrar ambas versiones en `supabase_migrations.schema_migrations` (ver
   `docs/SUPABASE_MIGRATIONS_SYNC.md`).
5. Mantener `USE_DB_MIKROTIK=false`.

## Riesgos

- **R1 (Media):** redundancia `status`/`provisioning_status`. Mitigado: `provisioning_status`
  canónico; `status` espejo deprecated documentado por `COMMENT`.
- **R2 (Baja):** `ip_address` NOT NULL coexiste con `management_ip`. Mitigado: espejo, no se elimina.
- **R3 (Media):** drift historial (`20260605000000` sin registrar). Mitigado: la nueva
  migración es auto-suficiente (re-garantiza columnas); el runbook reconcilia el historial.
- **R4 (Alta):** activar `USE_DB_MIKROTIK` sin repository DB rompería el dominio. Mitigado:
  DB-1 NO lo activa; no existe aún el repository DB (trabajo posterior).

## Pendientes (no en esta sesión)

- Aplicación + validación staging por Hermes (runbook arriba).
- (Opcional) Migración futura de **backfill de espejos** (`management_ip := ip_address`,
  `provisioning_status := status`) con `UPDATE` guardado — fuera de DB-1 por la regla de no
  modificar datos en esta migración.
- Repository DB de MikroTik para cuando se decida `USE_DB_MIKROTIK=true` (fase posterior).
- **Siguiente fase:** Inventory Read-Only (no iniciar aún) — ver
  `docs/NOC_READ_ONLY_ARCHITECTURE.md`.
