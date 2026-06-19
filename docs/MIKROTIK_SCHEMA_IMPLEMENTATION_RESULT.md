# DB-1 — Resultado de implementación (MikroTik Schema Reconciliation)

> Trabajo local seguro: migración evolutiva + tipos + validador + tests + docs.
> NO toca staging/producción, NO aplica migraciones reales, NO activa flags,
> NO toca routers reales. Fecha: 2026-06-18.
> Diseño base: `docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`.

## Resultado

✅ **DB-1 implementado a nivel de repositorio** (migración, modelo canónico, tipos,
validador y tests). Pendiente: aplicación/validación en staging por Hermes (no desde Claude).

## Hotfix strict migration contract (2026-06-18)

Hermes revalidó DB-1 sobre el commit `895ff85` y se detuvo **antes** de tocar la base de
datos: la migración era razonablemente segura, pero contenía SQL fuera del contrato estricto
acordado (`DO $$` + `CREATE TRIGGER`, `BEFORE UPDATE ON`, `ALTER TABLE ... ENABLE ROW LEVEL
SECURITY`, `COMMENT ON COLUMN`).

Acción de este hotfix:

- Se **retiraron** trigger/RLS/comments de `20260618000000_mikrotik_routers_reconciliation.sql`.
- DB-1.1 queda como **migración schema-only mínima**: solo
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`.
- El auto-touch de `updated_at` (trigger), el RLS deny-by-default y las descripciones de
  columna quedan para una fase posterior explícita **DB-1.2 Metadata/RLS/Triggers**, solo si
  se requieren.
- Motivo: cumplir el contrato de validación de Hermes y reducir el riesgo de la migración.

Los tests de `tests/unit/mikrotik.schema-reconciliation.test.ts` ahora **fuerzan** el contrato:
verifican que la migración NO contiene `DO $$`, `CREATE TRIGGER`, `BEFORE UPDATE`, `ENABLE ROW
LEVEL SECURITY`, `COMMENT ON`, ni `DROP/DELETE/TRUNCATE/UPDATE/INSERT`.

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

**Contrato estricto (schema-only):** la migración contiene **únicamente**
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`. Sin
`DROP/DELETE/TRUNCATE/UPDATE/INSERT`, sin `DO $$`, sin `CREATE TRIGGER`/`BEFORE UPDATE`, sin
`ENABLE ROW LEVEL SECURITY`, sin `COMMENT ON`. La metadata (auto-touch de `updated_at`,
RLS y descripciones de columna) se difiere a la fase DB-1.2 (ver «Hotfix strict migration
contract»). No hay backfill de datos (el sellado de espejos `management_ip`/
`provisioning_status` queda como paso posterior, ver Pendientes).

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
- Contrato estricto: NO contiene `DO $$`, `CREATE TRIGGER`, `BEFORE UPDATE`, `ENABLE ROW
  LEVEL SECURITY`, `COMMENT ON`, ni `DROP/DELETE/TRUNCATE/UPDATE/INSERT`.
- Solo aparecen los dos tipos de statement del contrato (ALTER ADD COLUMN / CREATE INDEX).
- Consistencia: las constantes TS cubren ambos modelos, sin duplicados, y el validador
  `.mjs` verifica exactamente el mismo conjunto canónico.

## Validación

- `npm run typecheck` → PASS.
- `npm test` → PASS (incluye los 12 tests nuevos).
- `npm run build` → PASS.
- `RUN_DB_TESTS=true npm run test:db` → **no ejecutado localmente** (requiere credenciales
  Supabase; no se toca staging desde Claude). Lo corre Hermes en staging.

## Runbook Hermes DB-1

Pasos para Hermes (aplicación + validación en staging; fuera de esta sesión de Claude):

1. **Pull del commit nuevo** del hotfix (rama `main`); confirmar el hash esperado en `git log`.
2. **Revisar la migración** `supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql`:
   debe contener **solo** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` y `CREATE INDEX IF NOT
   EXISTS`. No debe contener `DO $$`, `CREATE TRIGGER`, `BEFORE UPDATE`, `ENABLE ROW LEVEL
   SECURITY`, `COMMENT ON`, ni `DROP/DELETE/TRUNCATE/UPDATE/INSERT`.
   > Nota: la única aparición de la subcadena "update" es la **columna** `updated_at`
   > (añadida con `ADD COLUMN IF NOT EXISTS`, statement permitido), no un statement DML.
3. **Aplicar la migración en staging** (idempotente). Si `20260605000000_mikrotik_provisioning_schema.sql`
   no estaba registrada, aplicarla antes (también idempotente).
4. **`NOTIFY pgrst, 'reload schema';`** para refrescar el schema cache de PostgREST.
5. **Validar el esquema:** `RUN_DB_TESTS=true node scripts/validate-mikrotik-schema.mjs`.
6. **Correr checks:**
   - `RUN_DB_TESTS=true npm run test:db`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
7. **Confirmar flags seguros:** `USE_DB_MIKROTIK` apagado, `MIKROTIK_WORKER_LIVE=false`,
   commit mode apagado.
8. **Crear documento staging result SOLO si todo pasa**; registrar las versiones aplicadas en
   `supabase_migrations.schema_migrations` (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).

Si algún paso falla, detenerse, NO continuar y reportar el bloqueador exacto (tabla/columna/error).

## Riesgos

- **R1 (Media):** redundancia `status`/`provisioning_status`. Mitigado: `provisioning_status`
  canónico; `status` espejo deprecated (documentado en este doc y en el diseño; el `COMMENT ON`
  se difiere a DB-1.2).
- **R2 (Baja):** `ip_address` NOT NULL coexiste con `management_ip`. Mitigado: espejo, no se elimina.
- **R3 (Media):** drift historial (`20260605000000` sin registrar). Mitigado: la nueva
  migración es auto-suficiente (re-garantiza columnas); el runbook reconcilia el historial.
- **R4 (Alta):** activar `USE_DB_MIKROTIK` sin repository DB rompería el dominio. Mitigado:
  DB-1 NO lo activa; no existe aún el repository DB (trabajo posterior).

## Pendientes (no en esta sesión)

- Aplicación + validación staging por Hermes (runbook arriba).
- **DB-1.2 Metadata/RLS/Triggers** (fase posterior explícita, solo si se requiere):
  auto-touch de `updated_at` (trigger), RLS deny-by-default y descripciones de columna —
  retirados de DB-1.1 por el contrato estricto de Hermes.
- (Opcional) Migración futura de **backfill de espejos** (`management_ip := ip_address`,
  `provisioning_status := status`) con `UPDATE` guardado — fuera de DB-1 por la regla de no
  modificar datos en esta migración.
- Repository DB de MikroTik para cuando se decida `USE_DB_MIKROTIK=true` (fase posterior).
- **Siguiente fase:** Inventory Read-Only (no iniciar aún) — ver
  `docs/NOC_READ_ONLY_ARCHITECTURE.md`.
