# NugaCore Roadmap

> Plataforma WISP/ISP para operación, facturación, pagos, MikroTik, monitoreo, soporte y automatización segura.
>
> Este roadmap es el documento principal para GitHub. Debe permitir que cualquier técnico, Hermes o Claude Code entienda qué es NugaCore, qué existe hoy, qué falta y cuál es la ruta segura hacia producción.

## Visión

NugaCore será la plataforma central de operación para WISP, diseñada para administrar clientes, facturación, pagos, routers MikroTik, infraestructura, monitoreo, soporte técnico y automatización mediante inteligencia artificial.

Objetivos estratégicos:

- Igualar capacidades operativas tipo Wisphub.
- Superar y complementar UISP en operación diaria del WISP.
- Operar detrás de NAT/CGNAT mediante WireGuard.
- Permitir administración centralizada de routers MikroTik sin IP pública.
- Mantener una ruta segura desde modo manual/read-only hasta automatización real.
- Convertirse en SaaS multiempresa en fases futuras.
- Incorporar agentes especializados: NUGA-JARVIS, NUGA-NOC, NUGA-BILLING y NUGA-OPS.

## WISP OS — Plan Maestro (Olas 0–6)

NugaCore se posiciona como **sistema operativo WISP/ISP** (no solo CRM). Mapa completo: [`docs/WISP_OS_MODULE_MAP.md`](docs/WISP_OS_MODULE_MAP.md).

| Ola | Enfoque | Gate |
| --- | --- | --- |
| OLA 0 | Persistencia SSOT, staging flags | `storeFallbackActive: false` |
| OLA 1 | Control center, Client 360, cobranza, commercial UI | Billing/support DB |
| OLA 2 | MikroTik profesional (backup, diff, preview) | PROD-5→7, §11 |
| OLA 3 | Network DB, GIS v2, FTTH persistente | `USE_DB_NETWORK` |
| OLA 4 | Portal cliente, PWA técnicos | Auth portal |
| OLA 5 | Reportes UI, SLA, notificaciones reales | `NOTIFICATIONS_LIVE` / PROD-9 |
| OLA 6 | RADIUS, SaaS multi-tenant | Fase 11 |

**Production gates** (`backend/config/production-gates.ts`): `NUGACORE_LIVE_MODE` master + flags por subsistema. API `GET /api/system/production-gates`. Por defecto dry-run; activar en staging solo tras checklist §11 y routers de lab.

## Principio de madurez

Cada módulo tiene dos estados diferentes:

1. Estado funcional: si la funcionalidad existe y pasa pruebas en desarrollo/staging.
2. Estado producción: si es seguro usarla en un WISP real con datos reales y reinicios/deploys reales.

Una fase puede estar funcionalmente aprobada y aun así no estar lista para producción.

Estados usados:

- ✅ Completa / aprobada
- 🟡 Avanzada / candidata, requiere cierre o hardening
- 🔴 Bloqueada para producción
- 🔄 Pendiente
- 🧪 Staging/lab solamente

## Estado global actual

| Área | Estado funcional | Estado producción | Nota |
| --- | --- | --- | --- |
| Infraestructura base | ✅ Completa | 🟡 Requiere pipeline/rollback formal | Docker/Coolify staging existe; falta producción formal. |
| Autenticación y RBAC | ✅ Completa | 🟡 Hardening final requerido | JWT/RBAC existen; producción debe prohibir trusted headers. |
| Clientes | ✅ Operativa | 🟡 Validar carga de datos reales | Persistencia DB avanzada. |
| Planes | ✅ Operativa | 🟡 Validar catálogo real | Persistencia DB avanzada. |
| Billing | ✅ Operativa | 🟡 Validar saldos reales/backups | No cargar seeds/mock a producción. |
| Payment Engine | ✅ Operativa | 🟡 Validar proveedor real/webhooks | Requiere conciliación real e idempotencia validada. |
| Suspension Engine | ✅ Operativa | 🔴 No activar contra routers reales | Mantener dry-run/lógico hasta Worker seguro. |
| Service Status SSOT | ✅ Operativa (Pre-PROD-7) | 🟢 Read-only + dryRun seguro | Fuente oficial de `serviceStatus`; KPI "Suspendidos". No ejecuta nada real. Ver `docs/SERVICE_STATUS_SSOT_RESULT.md`. |
| Provisioning Engine Foundation | ✅ Operativa (PROD-7) · Hermes ✅ | 🟢 Dry-run seguro | Calcula y audita acciones; no toca RouterOS ni Worker Live. Validada en staging. Ver `docs/PROVISIONING_ENGINE_FOUNDATION_RESULT.md`, `docs/PROVISIONING_ENGINE_FOUNDATION_STAGING_RESULT.md`. |
| Automation Engine Foundation | ✅ Operativa (PROD-8) · 🟡 pendiente Hermes | 🟢 Decisión / dry-run | El cerebro: recibe eventos, evalúa reglas y devuelve decisiones + executionPreview. No ejecuta nada. Falta `STAGING_RESULT`. Ver `docs/AUTOMATION_ENGINE_FOUNDATION_RESULT.md`. |
| Architecture Hardening | ✅ Completada (ARCH-1) · Hermes ✅ | 🟢 Sin cambio de comportamiento | Auditoría + dedup (`common/time`) + flags centralizadas. Validada en staging. Backlog priorizado en `docs/TECHNICAL_DEBT.md`. Ver `docs/ARCH1_ARCHITECTURE_HARDENING_RESULT.md`, `docs/ARCH1_STAGING_RESULT.md`, `docs/ARCHITECTURE_AUDIT.md`, `docs/ARCHITECTURE_OVERVIEW.md`. |
| Notification Engine Foundation | ✅ Operativa (PROD-9) · Hermes ✅ | 🟢 DRY RUN / mock provider | Motor central de notificaciones; solo preview/simulación, providers mock, `sent=false`. No envía nada real. Validada en staging. Ver `docs/NOTIFICATION_ENGINE_FOUNDATION_RESULT.md`, `docs/NOTIFICATION_ENGINE_FOUNDATION_STAGING_RESULT.md`. |
| Data Consistency (SSOT KPIs) | ✅ Operativa | 🟢 Auditor read-only | `systemMetrics` + `/api/system/data-consistency`. Ver `docs/DATA_CONSISTENCY_AUDIT_RESULT.md`. |
| WireGuard Manager | 🟡 Avanzada | 🟢 Re-download post-restart resuelto vía `wireguard_snapshot` cifrado (4.9.2.1) | `USE_DB_WIREGUARD` opcional; snapshot aprobado como alternativa. |
| Router Enrollment | ✅ Operativa | 🟢 Download post-restart APROBADO (4.9.2.1) | Snapshot router+WG; sin depender de stores en memoria. |
| Template Engine | 🟡 Avanzada | 🟡 Seguro como generador manual | No implica provisioning live. |
| Dynamic Parameters | 🟡 En progreso | 🔴 Bloqueado por persistencia total | Falta independencia total de stores en memoria. |
| MikroTik Worker | 🔄 Pendiente — propuesta PROD-10 Worker Engine **Dry-Run** | 🔴 No producción | Siguiente fase recomendada tras PROD-9: motor de ejecución en simulación (plan → preview de comandos → resultado mock), **gated**, sin activar `MIKROTIK_WORKER_LIVE` ni RouterOS Write. Requiere autorización explícita de Ramiro. |
| NOC | 🟡 Avanzada (read-only + telemetría SSOT) | 🔴 No producción | `noc-telemetry` + health; sin SNMP live. |
| Inventario | 🟡 Avanzada | 🔴 No producción | ERP 5.1 + serial units; validar staging DB. |
| Tickets | 🟡 Avanzada (SLA + OT + DB) | 🟡 Staging DB | `USE_DB_SUPPORT`; SLA breaches en dashboard. |
| CRM Comercial | 🟡 Avanzada (UI + API) | 🟡 Staging | `CommercialModule` pipeline/prospectos/cotizaciones/agenda. |
| Portal Cliente | 🟡 Avanzada (staging token) | 🔴 No producción completa | `PORTAL_STAGING_TOKEN` opcional; JWT cliente pendiente. |
| Mobile App / PWA Técnicos | 🟡 Avanzada (PWA shell) | 🔴 No producción | `TechPwaModule` + `sw.js` offline shell. |
| IA Operativa | 🔄 Pendiente | 🔴 No producción | Primero read-only. |
| SaaS Multiempresa | 🔄 Futuro | 🔴 No producción | Requiere tenancy completo. |

## Meta de producción por etapas

La ruta segura no es activar todo de golpe. La progresión correcta es:

1. Ver: NOC/read-only, datos persistentes, dashboards y reportes.
2. Auditar: logs, bitácoras, RBAC, trazabilidad de cambios.
3. Simular: dry-run de comandos y scripts, sin tocar routers reales.
4. Confirmar: acciones manuales con aprobación humana.
5. Ejecutar: Worker live en entorno controlado/lab.
6. Automatizar: producción real gradual con rollback y auditoría.

## Roadmap por fases

### FASE 1 — Core Platform

Estado funcional: ✅ Completa
Estado producción: 🟡 Hardening final requerido

Incluye:

- Login.
- JWT.
- Refresh tokens.
- RBAC.
- Perfil de usuario.
- Auditoría básica.
- Roles: Super Admin, Administrador, Técnico, Cobranza, Soporte, Solo lectura.

Gate producción:

- Todos los endpoints sensibles exigen JWT real.
- `AUTH_TRUST_HEADERS=false` en producción.
- Roles resueltos desde DB, no desde headers del cliente.
- Rate limit, CORS allowlist, headers seguros y HTTPS/HSTS.
- Logs sin JWT ni datos sensibles.

### FASE 2 — Customer Management

Estado funcional: ✅ Completa
Estado producción: 🟡 Requiere migración/validación de datos reales

Incluye:

- Clientes.
- Servicios.
- Planes.
- Estados.
- Búsquedas.
- Dashboard básico.
- Asignación IPAM local/mock en alta de cliente WISP: router/torre, pool,
  cálculo de IPs libres y validación de duplicados sin RouterOS real.
- Flujo WISP-1 a WISP-5 local/mock: capacidad por nodo, GPS, cobertura,
  reserva de equipo sin descuento de stock y providers IPAM con fallback.

Estados:

- Active.
- Suspended.
- Cancelled.

Gate producción:

- Importación de clientes reales validada.
- No duplicados.
- IDs estables.
- Historial consistente.
- Paginación/búsqueda para listas grandes.
- Backup antes de migrar.
- Persistir `routerId`, `poolId` e `ipAssignmentStatus` en DB antes de depender
  de esos metadatos fuera del store local.
- Integración RouterOS solamente read-only y después de aprobar PROD-5/CHR.
- Validar en staging el flujo WISP completo antes de cualquier integración
  real. `IPAM_PROVIDER` debe permanecer en `mock`.

### FASE 3 — Billing Persistence

Estado funcional: ✅ Aprobada
Estado producción: 🟡 Requiere validación financiera real

Incluye:

- Invoices.
- Payments.
- Subscriptions.
- Billing settings.
- PostgreSQL / Supabase / RLS.

#### Billing & Collections Foundation (2026-06-23)

Estado funcional: 🟡 Code-complete, pendiente validación de Hermes
Estado producción: 🔴 Mock local (sin SAT/CFDI/Stripe/MercadoPago/CoDi/Dimo)

Extensión aditiva del dominio `billing` como fuente de facturación/cobranza:

- Endpoints: `GET /invoices/:id`, `POST /invoices/:id/cancel`,
  `GET /customers/:id/balance`, `GET/POST /payments`, `POST /run-cycle`
  (simulación de facturación automática mensual/quincenal/semanal),
  `GET /api/dashboard/billing-kpis`.
- UI: Client 360 → Cobranza; Dashboard → Cobranza Ejecutiva (Top 10 adeudos).
- RBAC: lectura 6 roles, escritura super admin/administrador/cobranza; Bearer JWT.
- Tests: contract, service, ui, customer360, dashboard, rbac y secret scan.
- Sin tocar RouterOS Write / Worker Live / MikroTik Runtime / NOC.

Detalle: `docs/BILLING_COLLECTIONS_FOUNDATION_RESULT.md`.

#### Dashboard Ejecutivo V3 (2026-06-24)

Estado funcional: 🟡 Code-complete, pendiente validación de Hermes

Desaturación y enfoque: dashboard del dueño reducido a 8 KPIs clickeables,
Alertas Importantes (máx. 5, priorizadas) y 5 Acciones Rápidas en el primer
viewport. Sin duplicados. El tooling NOC (alertas en tiempo real, ping,
simulador, umbrales/push, bot) se movió a `NocOperationsPanel` bajo el tab NOC
(no se eliminó del sistema). Solo UX/UI; tema/branding sin cambios.

Detalle: `docs/DASHBOARD_EXECUTIVE_V3_RESULT.md`.

Gate producción:

- Saldos reales auditados.
- Facturas huérfanas = 0.
- Pagos idempotentes.
- Reportes contra DB real.
- Restore probado antes de operar billing real.
- No seeds mock en producción.

### FASE 4.8 — Payment Engine

Estado funcional: ✅ Operativa / aprobada funcionalmente
Estado producción: 🟡 Validar proveedor real y conciliación

Implementado:

- Payment providers: Manual, MercadoPago, OpenPay, SPEI preparado.
- `payment_orders`.
- `payment_events`.
- Webhooks manual/MercadoPago/OpenPay.
- Reactivación lógica.
- Idempotencia.
- Auditoría.
- Dry-run.
- Portal cliente básico: facturas, historial, pagar ahora, estado del servicio.

Gate producción:

- Webhooks reales firmados y validados.
- Reintentos idempotentes.
- Conciliación con billing real.
- No reactivar sin referencia causal de pago/factura.
- Logs sin tokens ni payloads sensibles.

### FASE 4.9 — WireGuard Auto Enrollment

Estado funcional: ✅ Base aprobada
Estado producción: 🔴 Bloqueada por persistencia post-restart

Arquitectura:

```text
VPS WireGuard Server
├── Router MikroTik A
├── Router MikroTik B
├── Router MikroTik C
└── Router MikroTik N
```

Beneficios:

- NAT traversal.
- Compatible con CGNAT.
- Sin puertos abiertos en routers cliente.
- Administración remota permanente por túnel.

Gate producción:

- WireGuard server persistido.
- Peers persistidos.
- IPAM persistente.
- Revocación/rotación persistente.
- Restart real no rompe download ni estado.
- No imprimir claves privadas/preshared keys.

### FASE 4.9.1 — Advanced Template Engine

Estado funcional: ✅ Aprobada
Estado producción: 🟡 Apta como generador manual, no provisioning live

Plantillas soportadas:

- `router_base_wireguard`
- `pcc_2wan`
- `pcc_3wan`
- `pcc_4wan`
- `pcc_5wan`
- `pppoe_server`
- `noc_ready`
- `hotspot_basic` pendiente generador avanzado
- `wireguard_managed` pendiente

Gate producción:

- Validación semántica por plantilla.
- Scripts nunca persistidos completos.
- Preview redactado.
- Descarga manual auditada.
- Pruebas por RouterOS v6/v7.

### FASE 4.9.2 — Dynamic Template Parameters

Estado: ✅ APROBADA por Hermes (commit `a0c9b55`). Ver
[`docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`](./docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md).

Objetivo:

Permitir que cada plantilla reciba parámetros dinámicos desde el Wizard:

- LAN.
- WAN.
- Gateways.
- PPPoE.
- VLAN.
- Interfaces.
- Balanceadores PCC.

Resuelto (validado por Hermes sobre `a0c9b55`):

- `wireguard_snapshot` cifrado: re-download post-restart real = HTTP 200 para `pcc_5wan` y `router_base_wireguard`.
- Independencia total de `store.MIKROTIK_ROUTERS` y del WireGuard store en memoria.
- `USE_DB_ROUTER_ENROLLMENT=true`; `USE_DB_WIREGUARD=false`.
- Documentación de aprobación creada (`docs/DYNAMIC_TEMPLATE_PARAMETERS_DB_APPROVAL.md`).

### FASE 4.9.2.1 — Router/WireGuard Snapshot Persistence

Estado: ✅ APROBADA por Hermes (2026-06-16, commit `a0c9b55`). Ver
[`docs/ROUTER_ENROLLMENT_4_9_2_1_RESULT.md`](./docs/ROUTER_ENROLLMENT_4_9_2_1_RESULT.md).

Objetivo:

Cerrar la brecha entre persistencia de enrollment y re-descarga real después de restart.

Incluye:

- `router_snapshot` no sensible.
- `wireguard_snapshot` no sensible o persistencia DB real de WireGuard.
- `GET /api/router-enrollment/:id` después de restart = 200.
- `GET /api/router-enrollment/:id/download` después de restart = 200.
- Script regenerado con parámetros dinámicos originales.
- Sin scripts completos en DB.
- Sin secretos en logs/respuestas.

Criterio de salida:

- Test DB pasa.
- Test funcional con restart real pasa.
- Cleanup de artefactos test confirmado.
- Documento de aprobación creado.

### FASE 4.9.2.5 — Production Readiness Manual Safe Mode

Estado: 🔄 Pendiente

Objetivo:

Permitir usar NugaCore en producción de forma segura sin ejecutar comandos en routers reales.

Incluye:

- Auth/RBAC real.
- Clientes/planes/billing/payment persistentes.
- Router Enrollment persistente.
- WireGuard persistente o autosuficiente para downloads.
- Scripts manuales descargables.
- Auditoría.
- Backups y restore probado.
- Runbooks de operación.
- Healthchecks y alertas básicas.

Queda prohibido en esta fase:

- `MIKROTIK_WORKER_LIVE=true`.
- Commit mode.
- Ejecución RouterOS automática.
- Suspensión automática real.

### FASE 4.9.3 — Real Provisioning

Estado: 🔄 Pendiente

Objetivo:

Pasar de generar `.rsc` a provisionar routers reales de manera segura.

Incluye:

- MikroTik Worker live.
- Ejecución segura.
- Confirmaciones humanas.
- Dry-run obligatorio antes de live.
- Rollback/runbook.
- Auditoría por comando.
- Pruebas en CHR/lab.

Gate producción:

- No iniciar hasta aprobar Fase 4.9.2.5.
- Piloto con router no crítico.
- Backups/export antes de cambios.

### FASE 4.10 — MikroTik Command Center

Estado: 🔄 Pendiente

Funciones previstas:

- Reboot.
- Backup.
- Restore.
- Upgrade.
- Enable/disable interface.
- Ejecutar scripts.
- Gestión masiva.

Gate producción:

- Solo acciones allowlist.
- Confirmación humana por acción peligrosa.
- Auditoría completa.
- Rollback cuando aplique.
- Permisos por rol.

### DB-1 — MikroTik Routers Schema Reconciliation

Estado: ✅ Aprobada por Hermes en staging

Prerequisito para NOC Read-Only e Inventory Read-Only. Resuelve el drift del repo entre
las dos definiciones de `public.mikrotik_routers` (modelo de monitoreo en `init_schema`
vs modelo de provisioning en `mikrotik_provisioning_schema`).

Diseño completo: [`docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md`](./docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md).

Nota: la migración `20260605000000` **ya es evolutiva** (`ADD COLUMN IF NOT EXISTS`); el
conflicto descrito en versiones antiguas de la doc ya fue corregido (`b4d19c4`/`7264e59`).

Alcance (solo preparación de DB y validadores):

1. Sellar el modelo canónico (unión monitoreo + provisioning) resolviendo redundancias (`status` vs `provisioning_status`, `ip_address` vs `management_ip`).
2. Reconciliar el historial (`schema_migrations`) — lo aplica/valida Hermes en staging.
3. Validar que `USE_DB_MIKROTIK=false` sigue intacto (dominio en memoria; no existe aún repository DB de MikroTik).
4. Actualizar validadores (`scripts/validate-staging-migrations.mjs`) y tests, solo con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (nunca DROP).

Resultado registrado:

- `docs/MIKROTIK_SCHEMA_RECONCILIATION_STAGING_RESULT.md`
- Commit documental: `e65cbf6 docs(mikrotik): validate schema reconciliation staging`

### Secuencia de ejecución (orden estricto)

No avanzar a un punto sin cerrar el anterior:

```text
DB-1 (reconciliación mikrotik_routers)
  ↓
Inventory Read-Only
  ↓
NOC Read-Only
  ↓
PROD-1 Manual Safe Mode
  ↓
Safe Command Queue (dry-run)
  ↓
RouterOS Read-Only Lab (mock)
  ↓
4.9.3 Real Provisioning
```

### Inventory Read-Only

Estado: ✅ **4.11.1 Foundation aprobada en staging**.

Vista consolidada de routers leyendo el modelo canónico de `mikrotik_routers`. Solo
lectura: resumen + tabla; sin escritura sobre routers, sin RouterOS, sin comandos.
Endpoints `/api/inventory/routers`, `/api/inventory/routers/:id`, `/api/inventory/summary`.
Resultado: [`docs/INVENTORY_READ_ONLY_RESULT.md`](./docs/INVENTORY_READ_ONLY_RESULT.md).
Validación staging: [`docs/INVENTORY_READ_ONLY_STAGING_RESULT.md`](./docs/INVENTORY_READ_ONLY_STAGING_RESULT.md).
Diseño en [`docs/NOC_READ_ONLY_ARCHITECTURE.md`](./docs/NOC_READ_ONLY_ARCHITECTURE.md) §1.

### FASE 4.11 — NOC Read-Only

Estado: ✅ 4.11.2 Foundation + ✅ 4.11.3 Real Telemetry aprobadas en staging por Hermes.
4.11.3 agrega `GET /api/noc/health` y `GET /api/noc/towers` (telemetría agregada por
salud y por torre) más UI `NocTelemetryModule`; reutiliza `/api/noc/alerts`. Resultado:
[`docs/NOC_REAL_TELEMETRY_RESULT.md`](./docs/NOC_REAL_TELEMETRY_RESULT.md).

Subfase actual (4.11.2 Foundation):

- Backend read-only: `GET /api/noc/summary`, `GET /api/noc/routers`, `GET /api/noc/alerts`.
- UI base NOC read-only (resumen, tabla de routers, alertas derivadas, empty state).
- RBAC: Super Admin, Administrador, Técnico, Soporte, Solo lectura. Cobranza bloqueado.
- Sin RouterOS real, sin worker live, sin acciones write.

Recomendación: validar esta foundation en staging antes de avanzar a NOC completo.

Prerrequisito: **cerrar DB-1** (reconciliación de `mikrotik_routers`) antes de NOC
read-only sobre DB real.

Diseño completo: [`docs/NOC_READ_ONLY_ARCHITECTURE.md`](./docs/NOC_READ_ONLY_ARCHITECTURE.md).

Dashboard:

- Torres.
- Routers.
- WANs.
- Clientes.
- WireGuard peers.

Monitoreo:

- Ping.
- CPU.
- RAM.
- Interfaces.
- Queues.
- PPP.
- WireGuard.

Alertas:

- Telegram.
- Email.
- Push.

Gate producción:

- Read-only primero.
- Sin modificar routers.
- Datos sanitizados.
- Alertas con rate limit.
- No exponer MAC/IP privada de clientes en logs públicos.

### PROD-1 — Manual Safe Mode

Estado: ✅ Aprobada por Hermes en staging.

Infraestructura segura para acciones manuales futuras (modo manual con confirmación
humana). **NO ejecuta nada**: solo modela, audita y transiciona estados sobre store en
memoria. Dominio `backend/domains/manual-safe-mode/`.

- Modelo `SafeAction` (status `PENDING/APPROVED/REJECTED/SIMULATED/CANCELLED`;
  **sin `EXECUTED`**) + auditoría `SafeActionAudit`.
- Endpoints `GET/POST /api/manual-actions` (+ `:id`, `:id/approve|reject|simulate|cancel`).
- `simulateAction` solo cambia `PENDING → SIMULATED` y audita; no ejecuta comandos.
- RBAC: Super Admin, Administrador, Técnico, Soporte, Solo lectura. Cobranza 403.
- UI `src/modules/manual-safe-mode/ManualSafeModeModule.tsx` (badge SAFE MODE).
- Sin RouterOS, sin escritura real, sin commit mode, sin DB/migraciones.

Resultado: [`docs/PROD1_MANUAL_SAFE_MODE_RESULT.md`](./docs/PROD1_MANUAL_SAFE_MODE_RESULT.md).
Siguiente: Safe Command Queue (dry-run).

### FAST-1 — Safe Command Queue (Dry-Run) + CHR Lab Prep

Estado: ✅ Aprobada por Hermes en staging.

Cola SEGURA de comandos en **dry-run**: modela/valida/simula/aprueba/rechaza/cancela y
audita comandos **sin ejecutar nada**. Dominio `backend/domains/safe-command-queue/`.

- Estados `PENDING/VALIDATED/SIMULATED/APPROVED/REJECTED/CANCELLED`; **sin
  `EXECUTED`/`RUNNING`/`COMPLETED`**. `dryRun=true`, `wouldExecute=false`.
- Tipos: SUSPEND/RESTORE_CUSTOMER, UPDATE_QUEUE/PLAN, ADD/REMOVE_ADDRESS_LIST, REBOOT_CPE.
- Endpoints `GET/POST /api/safe-command-queue` (+ `:id`, `:id/validate|simulate|approve|reject|cancel`).
  **No existe `/execute`.** Aprobar exige simular antes.
- UI `src/modules/safe-command-queue/SafeCommandQueueModule.tsx` (badge DRY RUN).
- RBAC: SA/Admin/Técnico/Soporte/Solo lectura; Cobranza 403.
- Preparación documental de la fase siguiente:
  [`docs/CHR_LAB_PREP_RUNBOOK.md`](./docs/CHR_LAB_PREP_RUNBOOK.md) y
  [`docs/ROUTEROS_READ_ONLY_API_PLAN.md`](./docs/ROUTEROS_READ_ONLY_API_PLAN.md).
- Sin RouterOS, sin worker live, sin commit mode, sin DB/migraciones.

Resultado: [`docs/SAFE_COMMAND_QUEUE_DRY_RUN_RESULT.md`](./docs/SAFE_COMMAND_QUEUE_DRY_RUN_RESULT.md).
Validación staging: [`docs/SAFE_COMMAND_QUEUE_DRY_RUN_STAGING_RESULT.md`](./docs/SAFE_COMMAND_QUEUE_DRY_RUN_STAGING_RESULT.md).
Siguiente: RouterOS Read-Only Lab.

### PROD-3 — RouterOS Read-Only Lab

Estado: ✅ Implementada localmente (mock read-only, pendiente validación staging si se solicita).

Primera integración RouterOS de laboratorio. Es estrictamente read-only y usa provider mock;
no conecta con RouterOS real, no toca routers reales y no activa Worker Live ni runtime DB.

- Dominio `backend/domains/routeros-readonly/`.
- Provider mock con identity, version, uptime, CPU, RAM, interfaces, routes y WireGuard summary.
- Endpoints GET-only: `/api/routeros/identity`, `/api/routeros/system`, `/api/routeros/interfaces`, `/api/routeros/routes`, `/api/routeros/wireguard`.
- Sin endpoints write en el dominio.
- RBAC: SA/Admin/Técnico/Soporte/Solo lectura; Cobranza 403.
- UI `src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx` con badge READ ONLY LAB.
- Tests contract/UI/security; safety guard impide APIs/verbos de mutación en el dominio.

Resultado: [`docs/ROUTEROS_READ_ONLY_LAB_RESULT.md`](./docs/ROUTEROS_READ_ONLY_LAB_RESULT.md).

Siguiente gated: laboratorio RouterOS real controlado/read-only solo con autorización explícita.

### PROD-3 a PROD-7 — Camino corto a producción controlada (MikroTik)

Ruta gated desde laboratorio mock hasta un piloto en router no crítico. **Orden
estricto: no avanzar a una fase sin cerrar la anterior y sin aprobación Hermes /
autorización explícita de Ramiro.** Cada fase mantiene apagados
`USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE`,
`MIKROTIK_COMMIT_MODE`, `MIKROTIK_WRITE_ENABLED` salvo autorización posterior.

#### PROD-3 — RouterOS Read-Only Lab Foundation

Estado: 🟡 **Implementada localmente** (pendiente validación Hermes).

NugaCore sabe representar datos RouterOS de laboratorio en modo **mock**: provider
mock, 5 endpoints GET `/api/routeros/*` (identity, system, interfaces, routes,
wireguard), UI read-only `RouterOS Read-Only Lab` (badge `READ ONLY LAB`), tests
(contract/service/ui/static-safety) y una prueba que hace al dominio
**físicamente incapaz de escribir**. Sin conexión real, sin RouterOS real, sin
worker live, sin escritura. RBAC: SA/Admin/Técnico/Soporte/Solo lectura; Cobranza
403. Resultado: [`docs/ROUTEROS_READ_ONLY_LAB_RESULT.md`](./docs/ROUTEROS_READ_ONLY_LAB_RESULT.md).

#### PROD-4 — CHR Real Read-Only Integration

Estado: 🟡 **Implementada localmente — CLIENTE REAL CONECTABLE (gated, solo lab)**
(pendiente validación Hermes con CHR de lab).

Abstracción de **providers** en el dominio RouterOS Read-Only: contrato async
común con dos implementaciones (`mock` y `routeros`), feature flag
`ROUTEROS_READONLY_PROVIDER` (default `mock`) y **fallback seguro** a mock ante
timeout/auth/host inalcanzable (responde 200, `source=mock`, warning sin
secretos). El provider `routeros` usa una **allowlist** de comandos `print` y un
transporte read-only (`print` únicamente). Endpoints/UI/RBAC sin cambios de
contrato (la UI añade un indicador `Fuente: MOCK | ROUTEROS`). Sin
`.add/.set/.remove/.execute`, sin escritura.

Completado en esta fase (etiquetada **PROD-5** en el sprint, = conectar el CHR
real read-only de PROD-4): cliente RouterOS REST **real** de solo lectura
(`providers/routeros-client.ts`), configurado por entorno (`ROUTEROS_HOST/PORT/
USERNAME/PASSWORD/TIMEOUT_MS/TLS`), que mapea cada `print` allowlisted a su ruta
REST y hace `GET` HTTPS con Basic Auth y timeout. Sin credenciales → cae a mock.
Logs `routeros_read_success` / `routeros_read_fallback` sin secretos. Resultado:
[`docs/PROD5_CHR_REAL_READ_ONLY_RESULT.md`](./docs/PROD5_CHR_REAL_READ_ONLY_RESULT.md)
(antecedente [`docs/CHR_REAL_READ_ONLY_RESULT.md`](./docs/CHR_REAL_READ_ONLY_RESULT.md)).
Producción permanece en `mock`; solo CHR de **lab**. Falta (gated): validación
Hermes/Ramiro con CHR de lab real (credenciales fuera del repo). No avanza a
PROD-6 ni RouterOS write.

#### PROD-5 — Safe Command Queue Dry-Run sobre CHR

Estado: 🔄 **TODO — no implementar todavía.** Requiere PROD-4 aprobado.

Tomar comandos de la Safe Command Queue y **simularlos contra los datos del CHR**:
validar precondiciones, generar plan de ejecución y rollback simulado. No ejecuta
comandos, no modifica el CHR.

#### PROD-6 — Primer comando real controlado en CHR

Estado: 🔄 **TODO — no implementar todavía.** Requiere PROD-5 aprobado y
autorización explícita de Ramiro.

Solo CHR de lab: una acción mínima y reversible, con aprobación humana
obligatoria, backup/export antes, rollback documentado y commit mode explícito
**solo para CHR**. No routers reales.

#### PROD-7 — Piloto en router no crítico

Estado: 🔄 **TODO — no implementar todavía.** Requiere PROD-6 aprobado.

Un router **no crítico**, en ventana de mantenimiento, con backup/export, acción
reversible, monitoreo antes/después, rollback y aprobación explícita de Ramiro.

#### Secuencia PROD-3 → PROD-7

```text
PROD-3 RouterOS Read-Only Lab (mock)      ← implementada localmente
  ↓ (Hermes)
PROD-4 CHR Real Read-Only (cliente real)  ← implementada localmente (CONECTABLE, gated/solo lab)
  ↓ (Hermes valida con CHR de lab real, gated)
PROD-5 Safe Command Queue Dry-Run / CHR   ← TODO, gated
  ↓
PROD-6 Primer comando real en CHR         ← TODO, gated + autorización Ramiro
  ↓
PROD-7 Piloto en router no crítico        ← TODO, gated + autorización Ramiro
```

#### UX-1 — Simplificación de navegación WISP + Dashboard operativo

Estado: ✅ **Completada (solo UI/UX + módulo de documentación; sin cambios de tema).**

Sidebar final en 6 secciones con nombres claros en español: **Inicio, Clientes,
Red, MikroTik, Reportes y Sistema**. **NOC** vive en Red; **Routers** en MikroTik;
`RouterOS Lab` se renombró a `Laboratorio MikroTik` (etiqueta del menú). Decisiones
de producto: **WireGuard, Modo Seguro Manual y Cola Dry-Run se ocultan del sidebar**
(infraestructura/herramientas internas) pero conservan código, rutas, tests y acceso
por tab/URL directo (`isVisibleInSidebar` / `SIDEBAR_HIDDEN_TABS` en `rbac.ts`). Se
mantiene el módulo **Manual de Usuario** (frontend, sin backend) visible para todos
los roles, ahora con FAQ. El **Dashboard** agrega un "Resumen operativo" priorizado
(estado de red + alertas y KPIs clave enlazables) reutilizando los mismos
estilos/colores. RBAC funcional, backend, endpoints, providers, RouterOS y tema sin
cambios. Resultado:
[`docs/UI_NAVIGATION_SIMPLIFICATION_RESULT.md`](./docs/UI_NAVIGATION_SIMPLIFICATION_RESULT.md)
(antecedente: [`docs/UI_NAVIGATION_REORGANIZATION_RESULT.md`](./docs/UI_NAVIGATION_REORGANIZATION_RESULT.md)).
**Avanzar a PROD-5 / CHR Read-Only real solo después de validar esta UX con Hermes.**

#### CUSTOMER-IPAM-1 — Asignación de IP en alta de cliente WISP

Estado: ✅ **Implementada localmente (mock/read-only; sin RouterOS).**

El alta de Cliente Activo ahora exige router/torre, pool e IP validada. IPAM
calcula libres desde CIDR, excluye gateway/network/broadcast/reservadas, datos
mock y direcciones ya usadas por clientes NugaCore. Lead Comercial puede
continuar sin IP. El backend expone `/api/ipam/**` y revalida el payload del alta
para bloquear duplicados aunque la UI sea omitida. No activa flags MikroTik,
Worker Live, Commit Mode ni escritura RouterOS. Resultado:
[`docs/IP_ASSIGNMENT_CUSTOMER_ONBOARDING_RESULT.md`](./docs/IP_ASSIGNMENT_CUSTOMER_ONBOARDING_RESULT.md).

Siguiente paso gated: fuente RouterOS read-only únicamente después de aprobar
PROD-5/CHR; persistencia DB de metadatos IPAM requiere diseño/migración separada.

#### CRM-360 — Client 360 + Acciones rápidas en clientes

Estado: ✅ **Code-complete local** (pendiente validación Hermes).

Flujo operativo inspirado en WispHub manteniendo la identidad visual de NugaCore.
La lista de clientes agrega una columna **Acciones** con menú `⋮` agrupado
(Cliente · Servicio · Cobranza · Soporte · Red · Historial) y un panel **Cliente
360** (resumen + acciones rápidas + historial local con empty state). Acciones
seguras: navegación, modales y **simulación local**. Suspender/Reactivar son
simulación (no tocan store ni router); Registrar pago y Crear ticket son
mock/local; Generar factura y Cambiar plan quedan "pendiente de integración";
Cambiar IP valida formato y duplicado local. RBAC por rol vía `clientActionCaps`.
No activa `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/commit mode
ni escritura RouterOS. Resultado:
[`docs/CLIENT_360_QUICK_ACTIONS_RESULT.md`](./docs/CLIENT_360_QUICK_ACTIONS_RESULT.md).

Siguiente fase gated: conectar pago/ticket/estado de cuenta a sus backends
seguros y suspender/reactivar al Suspension Engine en modo dry-run/manual.

### FASE 4.12 — Zero Touch Provisioning

Estado: 🔄 Pendiente

Objetivo:

```text
Agregar router
↓
Seleccionar plantilla
↓
Generar configuración
↓
Importar
↓
Conectar WireGuard
↓
Detectar automáticamente
↓
Registrar en NugaCore
↓
Monitorear
```

Gate producción:

- Requiere 4.9.3 y NOC read-only estables.
- Requiere detección live confiable.
- Requiere rollback operativo.

### FASE 5 — Inventory Management

Estado: 🟡 **5.1 code-complete local** (pendiente validación Hermes). Resto 🔄.

Equipos:

- MikroTik.
- Ubiquiti.
- OLT.
- ONU.
- Switches.
- Antenas.

Funciones:

- Entradas.
- Salidas.
- Garantías.
- Series.
- Asignaciones.

#### FASE 5.1 — Persistencia + UI aditiva

Estado: ✅ **Code-complete local** (typecheck/test/build verdes; pendiente Hermes).

Da persistencia real al Inventario ERP detrás de `USE_DB_INVENTORY` (default
`false` → store), promoviendo el **almacén** a entidad de primera clase y
modelando **transferencias** con ciclo `pending → completed | cancelled`.
Refactor del dominio a service+repository (Store + Supabase) sin romper el
contrato API v1 ni el frontend congelado; UI aditiva (Almacenes,
Transferencias, stock por almacén) como sub-tabs del módulo Inventario.

- Migración `20260622000000_inventory_schema.sql` (warehouses, inventory_items,
  inventory_movements, inventory_transfers, inventory_assignments; RLS).
- Endpoints aditivos `/api/inventory/warehouses*` y `/api/inventory/transfers*`.
- Tests: `inventory.contract.test.ts` (hermético) + `inventory.db.contract.test.ts`.
- Resultado: [`docs/INVENTORY_ERP_5_1_RESULT.md`](./docs/INVENTORY_ERP_5_1_RESULT.md).
  Diseño: [`docs/INVENTORY_ERP_PERSISTENCE.md`](./docs/INVENTORY_ERP_PERSISTENCE.md).

#### FASE 5.2 — Series, garantías y reportes (gated)

Estado: 🔄 Pendiente. Trazabilidad por número de serie, garantías, valuación y
reportes de inventario; almacenes dinámicos en los selects existentes (requiere
autorización de UI).

### FASE 6 — Ticketing System

Estado: 🔄 Pendiente

Funciones:

- Tickets.
- Asignación.
- SLA.
- Seguimiento.
- Cierre.

### FASE 7 — CRM Comercial

Estado: 🔄 Pendiente

Funciones:

- Prospectos.
- Cotizaciones.
- Instalaciones.
- Agenda.
- Seguimiento comercial.

### FASE 8 — Portal Cliente Avanzado

Estado: 🔄 Pendiente

Funciones:

- Estado del servicio.
- Historial.
- Tickets.
- Consumo.
- Velocidad.
- Pagos.
- Soporte.

### FASE 9 — Mobile Apps

Estado: 🔄 Pendiente

Aplicaciones:

- Android.
- iOS.

Roles:

- Cliente.
- Técnico.
- Administrador.

### FASE 10 — AI Platform

Estado: 🔄 Pendiente

Agentes previstos:

- NUGA-JARVIS: asistente principal.
- NUGA-NOC: monitoreo inteligente.
- NUGA-BILLING: cobranza automática.
- NUGA-OPS: operación técnica.

Regla:

- IA primero read-only.
- Ningún agente puede ejecutar acciones destructivas sin RBAC, confirmación y auditoría.

### FASE 11 — SaaS Multiempresa

Estado: 🔄 Futuro

Objetivo:

Permitir múltiples WISP independientes dentro de la misma plataforma.

Incluye:

- Tenancy completo.
- Facturación SaaS.
- Aislamiento total de datos.
- Marketplace futuro.

No iniciar hasta:

- Producto single-WISP estable.
- Auditoría/RLS maduros.
- Modelo de billing interno estable.

## Reglas del proyecto

### Seguridad

- Nunca exponer secretos.
- Nunca guardar scripts completos en DB.
- WireGuard private keys y preshared keys siempre cifradas o no persistidas.
- RLS obligatorio en tablas sensibles.
- Service role solo backend/runtime, nunca frontend.

### Operación

Toda nueva funcionalidad debe tener:

- Typecheck.
- Tests.
- Build.
- Documentación.
- Runbook Hermes/Claude Code cuando toque staging/producción.

### Producción

- No activar `MIKROTIK_WORKER_LIVE` sin fase aprobada.
- No activar commit mode sin rollback.
- No ejecutar cambios destructivos sin auditoría.
- No tocar routers reales desde staging sin autorización explícita.
- Primero CHR/lab, luego router no crítico, luego producción gradual.

## Documentos complementarios

- Checklist de producción y desarrollo: [`docs/PRODUCTION_READINESS_CHECKLIST.md`](docs/PRODUCTION_READINESS_CHECKLIST.md)
- Checklist operativo para técnicos/agentes: [`docs/DEVELOPMENT_HANDOFF_CHECKLIST.md`](docs/DEVELOPMENT_HANDOFF_CHECKLIST.md)
- Arquitectura rápida: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Backlog maestro histórico: [`docs/MASTER_BACKLOG.md`](docs/MASTER_BACKLOG.md)

## Meta final

Construir la plataforma WISP más completa del mercado para:

- Administración.
- Facturación.
- Pagos.
- MikroTik.
- Monitoreo.
- Automatización.
- Inteligencia artificial.

La meta no es solo tener funcionalidades, sino tener una operación segura, auditable y recuperable para un WISP real.
