# NugaCore — Estado actual del proyecto

> Resumen de arranque en frío para cualquier técnico, Hermes, Jarvis o Claude Code.
> Última actualización: 2026-06-25 (reconciliación post-PROD-9). Fuente canónica de
> tareas: `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md` (§0). Sin secretos en este documento.

## Rama y commits

- Rama de trabajo: `main`. HEAD = `8880c7b`, sincronizado con `origin/main`.
- Últimos commits relevantes (más reciente primero):
  - `8880c7b` — docs(prod9): validate notification engine dry-run staging (Hermes ✅).
  - `6911c25` — feat(prod9): add notification engine dry-run foundation.
  - `fb84edf` — docs(arch1): validate architecture hardening staging (Hermes ✅).
  - `24fb067` — chore(repo): document build artifact policy.
  - `2cb3427` — refactor(arch1): harden architecture and eliminate technical debt.
  - `eb4ea0a` — feat(prod8): add automation engine foundation.
  - `bb3a4b9` — docs(prod7): validate provisioning dry-run staging (Hermes ✅).
  - `0f1457c` — feat(prod7): add provisioning engine dry-run foundation.

## Fases implementadas y mergeadas en `main`

No retomar salvo regresión documentada (ver handoff §0.A):

- Data Consistency Audit + Service Status SSOT (Pre-PROD-7): fuente única de KPIs
  (`systemMetrics`), auditor `/api/system/data-consistency`, y dominio
  `service-status` como fuente oficial de `serviceStatus` (KPI "Suspendidos").
  Read-only + `dryRun`; sin RouterOS/Worker. Ver `docs/SERVICE_STATUS_SSOT_RESULT.md`.
- WireGuard Auto Enrollment.
- Router Onboarding Wizard.
- Advanced Template Engine.
- Dynamic Template Parameters (código).
- Router Enrollment DB Persistence (código), incluyendo `router_snapshot` y `wireguard_snapshot`.
- Payment Engine.
- Suspension Engine (lógico).
- HTTP Security (helmet + CORS allowlist + rate-limit).
- Observability básica (correlation ID, métricas in-memory, access log).
- CUSTOMER-IPAM-1: asignación de IP local/mock en alta de cliente WISP.
- WISP-CORE-1: capacidad, GPS, cobertura, reserva de equipo e IPAM providers
  con fallback mock para el alta completa de cliente.
- Inventario ERP 5.1: persistencia (warehouses/items/movimientos/transferencias)
  detrás de `USE_DB_INVENTORY` + UI aditiva (code-complete, pendiente Hermes).
- Client 360 + Acciones rápidas en CRM: columna Acciones, menú `⋮`, panel
  Cliente 360 e historial local; acciones seguras (navegación/modal/simulación),
  sin tocar RouterOS/Worker (code-complete, pendiente Hermes). Ver
  `docs/CLIENT_360_QUICK_ACTIONS_RESULT.md`.
- Billing & Collections Foundation (2026-06-23): extensión aditiva del dominio
  `billing` — `GET /invoices/:id`, `POST /invoices/:id/cancel`,
  `GET /customers/:id/balance`, `GET/POST /payments`, `POST /run-cycle`
  (simulación) y `GET /api/dashboard/billing-kpis`; Client 360 cobranza +
  Cobranza Ejecutiva en Dashboard; RBAC read(6)/write(3) y secret scan. Mock
  local (sin SAT/CFDI/Stripe/MercadoPago); motor MikroTik intacto. Code-complete,
  pendiente Hermes. Gate de validación enfocado: `npm run test:db:billing`
  (el `test:db` global puede fallar por dominios ajenos y no bloquea Billing).
  Ver `docs/BILLING_COLLECTIONS_FOUNDATION_RESULT.md`.
- Dashboard Ejecutivo V3 (2026-06-24): dashboard desaturado a pantalla de decisión
  rápida — 8 KPIs clickeables, Alertas Importantes (máx. 5) y 5 Acciones Rápidas en
  el primer viewport. El tooling NOC (alertas RT, ping, simulador, umbrales/push,
  bot) se movió a `NocOperationsPanel` bajo el tab NOC (no se eliminó del sistema).
  Solo UX/UI; sin cambios de tema/branding. Code-complete, pendiente Hermes.
  Ver `docs/DASHBOARD_EXECUTIVE_V3_RESULT.md`.
- PROD-7 Provisioning Engine Foundation (2026-06-24): dominio dry-run
  `backend/domains/provisioning`, endpoints `/api/provisioning/*`, RBAC
  read(6)/write(3), auditoria de transiciones, `Provisioning Center` bajo MikroTik,
  seccion Provisioning en Client 360 y KPI `Provisioning Pendiente`. No RouterOS,
  no Worker Live, no cambios reales. ✅ **Validada por Hermes en staging** (commit
  `0f1457c`). Ver `docs/PROVISIONING_ENGINE_FOUNDATION_RESULT.md` y
  `docs/PROVISIONING_ENGINE_FOUNDATION_STAGING_RESULT.md`.
- PROD-8 Automation Engine Foundation (2026-06-24): dominio decisión/dry-run
  `backend/domains/automation`, endpoints `/api/automation/*` (read-only +
  `simulate`), 16 eventos, 9 decisiones, motor de reglas con executionPreview,
  auditoría sin secretos, `Automation Center` bajo Configuración (badge DRY
  RUN), KPI `Automation Queue`, sección Automation en Client 360 y referencia
  `Decision Source` en Provisioning. RBAC: lectura+simulación para todos los
  roles; nadie modifica reglas todavía. No ejecuta nada, no RouterOS, no Worker
  Live, no cambios reales. 🟡 **Code-complete, pendiente Hermes** (aún sin
  `docs/AUTOMATION_ENGINE_FOUNDATION_STAGING_RESULT.md`). Ver
  `docs/AUTOMATION_ENGINE_FOUNDATION_RESULT.md`.
- ARCH-1 Architecture Hardening (2026-06-24): fase de fortalecimiento sin
  cambio de comportamiento. Auditoría completa (`docs/ARCHITECTURE_AUDIT.md`,
  `docs/ARCHITECTURE_OVERVIEW.md`), dedup de `nowIso` ×12 →
  `backend/common/time.ts`, centralización de feature flags
  (`useDbWireguard()` + `docs/FEATURE_FLAGS.md`), y backlog priorizado
  (Critical/High/Medium/Low + esfuerzo) en `docs/TECHNICAL_DEBT.md`. Sin tocar
  endpoints, payloads, RBAC, UX ni RouterOS/Worker Live. typecheck/test(1712)/
  build en verde. ✅ **Validada por Hermes en staging** (ARCH-1 + ARCH-1.1). Ver
  `docs/ARCH1_ARCHITECTURE_HARDENING_RESULT.md` y `docs/ARCH1_STAGING_RESULT.md`.
- PROD-9 Notification Engine Foundation (2026-06-24): dominio DRY RUN
  `backend/domains/notifications`, endpoints `/api/notifications/*` (templates,
  messages, summary, preview, simulate, cancel — sin /send ni /dispatch),
  9 tipos, 5 canales, 6 estados (nunca SENT real), 8 plantillas, 5 providers
  mock (`wouldSend=true, sent=false`), auditoría sin secretos. `Notification
  Center` bajo Automation Center (badge DRY RUN), KPI `Notificaciones
  Pendientes`, sección Notificaciones en Client 360 y paso "Notification would
  be created" en el preview de Automation. RBAC: lectura todos; crear/simular/
  cancelar Super Admin/Administrador/Cobranza/Soporte (Técnico y Solo lectura
  bloqueados). No envía nada real, no APIs externas, no tokens. ✅ **Validada por
  Hermes en staging** (commit `6911c25`). Ver
  `docs/NOTIFICATION_ENGINE_FOUNDATION_RESULT.md` y
  `docs/NOTIFICATION_ENGINE_FOUNDATION_STAGING_RESULT.md`.

## Aprobaciones formales de Hermes

- **PROD-9 Notification Engine Foundation:** ✅ **APROBADA** en staging sobre el
  commit `6911c25` (validación `8880c7b`). DRY RUN/mock confirmado: `sent=false`,
  sin `/send` ni `/dispatch`, RBAC y static-safety OK. Ver
  `docs/NOTIFICATION_ENGINE_FOUNDATION_STAGING_RESULT.md`.
- **ARCH-1 + ARCH-1.1 Architecture Hardening:** ✅ **APROBADAS** en staging
  (validación `fb84edf`). Sin cambio de comportamiento; `dist/` no versionado. Ver
  `docs/ARCH1_STAGING_RESULT.md`.
- **PROD-7 Provisioning Engine Foundation:** ✅ **APROBADA** en staging sobre el
  commit `0f1457c` (validación `bb3a4b9`). Dry-run/auditoría confirmados; sin
  estados de ejecución, sin RouterOS/Worker. Ver
  `docs/PROVISIONING_ENGINE_FOUNDATION_STAGING_RESULT.md`.
- **PROD-8 Automation Engine Foundation:** 🟡 **PENDIENTE de validación Hermes**
  (commit `eb4ea0a`, sin `STAGING_RESULT` todavía).
- **4.9.2 / 4.9.2.1:** ✅ **APROBADA** sobre el commit `a0c9b55`. Persistencia real
  Supabase con restart demostrada para `pcc_5wan` y `router_base_wireguard`
  (download post-restart = 200; `wireguardSnapshot` saneado). Evidencia formal:
  `docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`.
- El veredicto **NO APROBADA** previo en
  `docs/DYNAMIC_TEMPLATE_PARAMETERS_STAGING_RESULT.md` (commit `2ac6a1f`) quedó
  **superado**: el bloqueador era que `public.router_enrollment` no estaba expuesta en
  PostgREST, y ya fue resuelto/reconciliado (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
- No retomar 4.9.2 salvo regresión nueva documentada.

## Siguiente fase recomendada (post-PROD-9)

Con PROD-9 ✅ validada por Hermes, la **propuesta** de siguiente fase es
**PROD-10 — Worker Engine Dry-Run**: motor de ejecución en modo simulación
(plan → preview de comandos → resultado mock), **sin** activar `MIKROTIK_WORKER_LIVE`,
sin RouterOS Write y sin tocar routers reales. **NO implementar todavía**: es una
propuesta gated que requiere autorización explícita de Ramiro. Pendiente lateral:
cerrar la validación Hermes de **PROD-8 Automation** (sin `STAGING_RESULT`).

## Bloqueador histórico (resuelto) — DB-1

**DB-1 — Reconciliar el schema de `mikrotik_routers`** ya fue reconciliado (ver
"Orden de trabajo" más abajo, DB-1 ✅). Contexto para no reabrirlo sin regresión:
había dos definiciones contradictorias de `public.mikrotik_routers` en el repo:

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
7. PROD-4 CHR Real Read-Only (cliente REST real, gated/solo lab). 🟡 implementada localmente — CONECTABLE al CHR de lab por env; sin credenciales cae a mock (pendiente validación Hermes con CHR de lab). Ver `docs/PROD5_CHR_REAL_READ_ONLY_RESULT.md`.
8. PROD-5 Dry-Run/CHR → PROD-6 comando real CHR → PROD-7 piloto router no crítico. 🔄 TODO, gated (no implementar todavía). Nota: el "PROD-5" de este sprint fue conectar el CHR real read-only (= completar PROD-4), NO el Safe Command Queue Dry-Run del roadmap.

- UX-1 — Simplificación de navegación WISP + Dashboard operativo. ✅ Solo UI/UX
  (sin cambios de tema/colores): 6 secciones en español (Inicio, Clientes, Red,
  MikroTik, Reportes, Sistema). NOC en Red; Routers en MikroTik; `RouterOS Lab` →
  `Laboratorio MikroTik`. WireGuard / Modo Seguro Manual / Cola Dry-Run ocultos del
  sidebar (siguen accesibles por tab/URL; código/rutas/tests intactos) vía
  `isVisibleInSidebar`/`SIDEBAR_HIDDEN_TABS`. Módulo `user-manual` (frontend) visible
  para todos los roles, con FAQ. Dashboard con "Resumen operativo" priorizado (estado
  de red + alertas + KPIs enlazables) sobre datos existentes. RBAC funcional/backend/
  RouterOS sin cambios. Ver `docs/UI_NAVIGATION_SIMPLIFICATION_RESULT.md`. Avanzar a
  PROD-5 solo tras validar esta UX con Hermes.

- CUSTOMER-IPAM-1 — Asignación de red en alta de Cliente Activo. ✅ Implementada
  localmente con router/torre, pool, cálculo CIDR, selector/manual de IP,
  validación de ocupadas y revalidación backend. Lead Comercial puede continuar
  sin IP. Fuente mock/local; no RouterOS, no CHR, no Worker Live y sin flags
  MikroTik. `assignedIp` reutiliza `clients.ip_assigned`; los metadatos
  `routerId`/`poolId`/`ipAssignmentStatus` requieren persistencia DB futura. Ver
  `docs/IP_ASSIGNMENT_CUSTOMER_ONBOARDING_RESULT.md`.

- WISP-CORE-1 — Sprint WISP-1 a WISP-5. ✅ Implementado y validado localmente:
  capacidad informativa, GPS automático/manual, cobertura por distancia/azimut,
  reserva `RESERVED` sin descuento de stock, providers IPAM async y fallback
  automático a mock. Técnico puede realizar el alta sin ganar permisos de
  ciclo de vida. Dashboard y Manual actualizados. `IPAM_PROVIDER=mock`
  permanece como default; el provider RouterOS no está conectado ni configurado.
  Ver `docs/WISP_CORE_PRODUCTION_SPRINT_RESULT.md`. Pendiente validación staging;
  no avanzar a PROD-5 ni Worker Live.

- HOTFIX-PAYMENTS-AUTH — Pagos usa ahora Bearer JWT vía `getAuthHeaders` para
  listar órdenes/acciones, crear órdenes y solicitar reactivación. Se eliminaron
  trusted headers del módulo frontend; backend y RBAC no cambiaron. Pendiente
  redeploy/smoke test de Hermes y verificación operativa de la host key SSH. Ver
  `docs/PAYMENTS_AUTH_HEADERS_HOTFIX_RESULT.md`.

No avanzar a un punto sin cerrar el anterior.

> Última funcionalidad implementada localmente: **WISP-CORE-1**, sin alterar
> el gate de infraestructura. La última fase RouterOS sigue siendo
> **PROD-4 CHR Real Read-Only Integration**
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
