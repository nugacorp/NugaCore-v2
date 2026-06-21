# NugaCore — Estado actual del proyecto

> Resumen de arranque en frío para cualquier técnico, Hermes, Jarvis o Claude Code.
> Última actualización: 2026-06-18. Fuente canónica de tareas:
> `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md` (§0). Sin secretos en este documento.

## Rama y commits

- Rama de trabajo: `main`.
- Últimos commits relevantes:
  - `bf438ed` — persist router snapshot para downloads DB.
  - `a0c9b55` — download sin depender del store de WireGuard.
  - `e61198b` — sync de migraciones Supabase documentado.
  - `e10d5e6` — prerequisito de reconciliación `mikrotik_routers` en roadmap/handoff.

## Fases implementadas y mergeadas en `main`

No retomar salvo regresión documentada (ver handoff §0.A):

- WireGuard Auto Enrollment.
- Router Onboarding Wizard.
- Advanced Template Engine.
- Dynamic Template Parameters (código).
- Router Enrollment DB Persistence (código), incluyendo `router_snapshot` y `wireguard_snapshot`.
- Payment Engine.
- Suspension Engine (lógico).
- HTTP Security (helmet + CORS allowlist + rate-limit).
- Observability básica (correlation ID, métricas in-memory, access log).

## Aprobaciones formales de Hermes

- **4.9.2 / 4.9.2.1:** ✅ **APROBADA** sobre el commit `a0c9b55`. Persistencia real
  Supabase con restart demostrada para `pcc_5wan` y `router_base_wireguard`
  (download post-restart = 200; `wireguardSnapshot` saneado). Evidencia formal:
  `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`.
- El veredicto **NO APROBADA** previo en
  `docs/DYNAMIC_TEMPLATE_PARAMETERS_STAGING_RESULT.md` (commit `2ac6a1f`) quedó
  **superado**: el bloqueador era que `public.router_enrollment` no estaba expuesta en
  PostgREST, y ya fue resuelto/reconciliado (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
- No retomar 4.9.2 salvo regresión nueva documentada.

## Bloqueador / prioridad inmediata

**DB-1 — Reconciliar el schema de `mikrotik_routers` antes de activar `USE_DB_MIKROTIK`.**

Hay dos definiciones contradictorias de `public.mikrotik_routers` en el repo:

- `20260531000000_init_schema.sql` (modelo de monitoreo) — **es la tabla aplicada en la DB**.
- `20260605000000_mikrotik_provisioning_schema.sql` (modelo de provisioning) — **NO aplicada**;
  su `CREATE TABLE IF NOT EXISTS` se salta y falla en `CREATE INDEX ... ON (status)`.

DB-1 es trabajo seguro de preparación: auditar, diseñar modelo canónico, crear una
migración evolutiva nueva (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), actualizar
validadores y tests. No aplica migraciones en Supabase ni activa flags. Checklist
detallado en `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md` §0.D.

## Orden de trabajo (estricto)

1. DB-1 — Reconciliación de `mikrotik_routers`. ✅
2. MikroTik Inventory Read-Only (4.11.1). ✅
3. NOC Read-Only (4.11.2 foundation + 4.11.3 real telemetry). ✅
4. PROD-1 Manual Safe Mode. 🟡 implementada localmente (pendiente Hermes).
5. FAST-1 Safe Command Queue dry-run. 🟡 implementada localmente (pendiente Hermes).
6. PROD-3 RouterOS Read-Only Lab (mock). 🟡 implementada localmente (pendiente Hermes).
7. PROD-4 CHR Real Read-Only (abstracción de providers). 🟡 implementada localmente, PREPARADO/NO CONECTADO (pendiente Hermes).
8. PROD-5 Dry-Run/CHR → PROD-6 comando real CHR → PROD-7 piloto router no crítico. 🔄 TODO, gated (no implementar todavía).

- UX-1 — Reorganización profesional del Sidebar (WISP). ✅ Solo UI/UX de
  navegación: 7 secciones en español (Inicio, Clientes, Red WISP, MikroTik,
  Operaciones Seguras, Reportes, Sistema), IDs/activeTab/RBAC conservados, sin
  tocar backend ni RouterOS. Ver `docs/UI_NAVIGATION_REORGANIZATION_RESULT.md`.
  Avanzar a PROD-5 solo tras validar esta UX con Hermes.

No avanzar a un punto sin cerrar el anterior.

> Última fase implementada localmente: **PROD-4 CHR Real Read-Only Integration**
> (PREPARADO, NO CONECTADO) — abstracción de providers (interface async, mock,
> routeros), feature flag `ROUTEROS_READONLY_PROVIDER` (default `mock`) y fallback
> seguro a mock ante timeout/auth/host inalcanzable (API 200, `source=mock`, sin
> secretos en logs). El provider `routeros` queda sin cliente real: no conecta CHR
> ni RB5009. Endpoints/UI/RBAC sin cambios. Sin escritura. Ver
> `docs/CHR_REAL_READ_ONLY_RESULT.md`. PROD-5 a PROD-7 quedan como TODO gated en
> `ROADMAP.md`. Detalle en `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md` §0.C.

## Prohibido activar (sin autorización explícita de Ramiro / fase aprobada)

- `USE_DB_MIKROTIK`.
- `USE_DB_WIREGUARD`.
- `MIKROTIK_WORKER_LIVE`.
- Commit mode.
- Ejecución de RouterOS real desde staging.
- Aplicar `20260605000000_mikrotik_provisioning_schema.sql` tal cual.
- Aplicar migraciones en Supabase o tocar routers/datos reales desde la tarea automática.
