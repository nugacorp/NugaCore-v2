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

## Fases NO aprobadas formalmente (pendiente de evidencia)

- **4.9.2 / 4.9.2.1 (validación staging):** el último documento formal,
  `docs/DYNAMIC_TEMPLATE_PARAMETERS_STAGING_RESULT.md` (commit `2ac6a1f`,
  2026-06-17), quedó **NO APROBADA**. El bloqueador era que
  `public.router_enrollment` no estaba expuesta en PostgREST.
- Ese bloqueador fue reconciliado a nivel DB el 2026-06-18 (migraciones de
  `router_enrollment` + snapshots aplicadas/registradas en staging y `NOTIFY pgrst`;
  ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
- **Falta** la revalidación funcional de Hermes (restart + download) y la emisión de
  `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`. Hasta entonces, no marcar como
  APROBADA.

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

1. DB-1 — Reconciliación de `mikrotik_routers`.
2. NOC Read-Only.
3. MikroTik Inventory Read-Only.
4. PROD-1 Manual Safe Mode.
5. Safe Command Queue dry-run.

No avanzar a un punto sin cerrar el anterior.

## Prohibido activar (sin autorización explícita de Ramiro / fase aprobada)

- `USE_DB_MIKROTIK`.
- `USE_DB_WIREGUARD`.
- `MIKROTIK_WORKER_LIVE`.
- Commit mode.
- Ejecución de RouterOS real desde staging.
- Aplicar `20260605000000_mikrotik_provisioning_schema.sql` tal cual.
- Aplicar migraciones en Supabase o tocar routers/datos reales desde la tarea automática.
