# NugaCore — Estado actual del proyecto

> Resumen de arranque en frío para cualquier técnico o agente.
> **Última actualización: 2026-07-15.**  
> Handoff detallado del sprint reciente:
> [`SPRINT_HANDOFF_2026-07-15.md`](./SPRINT_HANDOFF_2026-07-15.md).  
> Checklist operativo: [`../planning/DEVELOPMENT_HANDOFF_CHECKLIST.md`](../planning/DEVELOPMENT_HANDOFF_CHECKLIST.md).  
> Sin secretos en este documento.

## Rama y commits

- Rama: `main`. HEAD de referencia del handoff: **`c914439`** (sincronizar con `origin/main`).
- Últimos commits relevantes (más reciente primero):
  - `c914439` — feat(wireguard): apply automático de peers al host wg0 (#19)
  - `521c5fc` — feat(ui): mover alta de router dentro de Routers (#18)
  - `b49ad75` — fix(enrollment): sync inventario al revocar y persistir API creds
  - `25839e2` — fix(ui): assets `.js` faltantes → 404 (MIME)
  - `468ed0b` … `d39dfb2` — endurecimiento import RouterOS / WireGuard / bridge
  - `71c990c` — feat(pwa): fundación multi-app instalable
  - `69f5db0` — sidebar WISP LATAM (7 secciones)

## Capacidad operativa WISP (julio 2026)

| Capacidad | Estado |
| --- | --- |
| Alta router (wizard) desde **Routers → Dar de alta** | ✅ staging |
| Script `.rsc` importable CHR (`nc-wg.rsc`) | ✅ |
| Peer WG aplicado a `wg0` al crear/rotar/revocar | ✅ automático |
| Inventario routers alineado con enrollment | ✅ |
| Check-online **live** / Worker Live | ❌ gate apagado (`MIKROTIK_WORKER_LIVE=false`) |
| Multi-tenant / multi-VPS WG | ❌ no |

Flags staging típicos: `USE_DB_WIREGUARD`, `USE_DB_ROUTER_ENROLLMENT`, `USE_DB_MIKROTIK` = true.

## Documentación canónica por tema

| Tema | Documento |
| --- | --- |
| Sprint handoff | `docs/reports/SPRINT_HANDOFF_2026-07-15.md` |
| Host-apply WG | `docs/wireguard/WIREGUARD_HOST_APPLY.md` |
| Import `.rsc` | `docs/mikrotik/ROUTEROS_RSC_IMPORT_HARDENING.md` |
| UX Routers | `docs/frontend/ROUTERS_MODULE_UX.md` |
| Enrollment uso | `docs/wireguard/WIREGUARD_AUTO_ENROLLMENT.md` |
| WG Manager | `docs/wireguard/WIREGUARD_MANAGER.md` |
| Deploy Coolify | `docs/runbooks/HERMES_COOLIFY_STAGING_RUNBOOK.md` |
| Producción | `docs/deployment/PRODUCTION_READINESS_CHECKLIST.md` |

## Plataforma (resumen histórico)

Sigue vigente lo consolidado en fases previas (Auth/RBAC, Customers, Plans, Billing,
Payment Engine, Suspension lógico, Inventario ERP 5.1, Client 360, Dashboard V3,
Provisioning/Automation/Notification foundations dry-run, NOC read-only / lab, etc.).
Detalle y gates Hermes: ver historial en
`docs/planning/DEVELOPMENT_HANDOFF_CHECKLIST.md` §0.A y carpetas `docs/results/`.

## Próximo trabajo (gated)

1. No reabrir host-apply/RSC/UX Routers salvo regresión.
2. PROD-8 Automation: completar evidencia Hermes si aún falta `STAGING_RESULT`.
3. PROD-4 / live read-only CHR y `MIKROTIK_WORKER_LIVE`: **solo con autorización explícita**.
4. Gates de producción del checklist (persistencia, backups, secret hygiene, etc.).

## Guardrails

- No secretos en git ni en docs públicas.
- No cambiar passwords compartidos de staging sin pedido.
- Validar commits en `origin/main` antes de aprobar staging.
