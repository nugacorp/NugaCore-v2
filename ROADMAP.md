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
| WireGuard Manager | 🟡 Avanzada | 🟢 Re-download post-restart resuelto vía `wireguard_snapshot` cifrado (4.9.2.1) | `USE_DB_WIREGUARD` opcional; snapshot aprobado como alternativa. |
| Router Enrollment | ✅ Operativa | 🟢 Download post-restart APROBADO (4.9.2.1) | Snapshot router+WG; sin depender de stores en memoria. |
| Template Engine | 🟡 Avanzada | 🟡 Seguro como generador manual | No implica provisioning live. |
| Dynamic Parameters | 🟡 En progreso | 🔴 Bloqueado por persistencia total | Falta independencia total de stores en memoria. |
| MikroTik Worker | 🔄 Pendiente | 🔴 No producción | No activar `MIKROTIK_WORKER_LIVE`. |
| NOC | 🔄 Pendiente | 🔴 No producción | Primero read-only. |
| Inventario | 🔄 Pendiente | 🔴 No producción | Falta modelo/operación real. |
| Tickets | 🔄 Pendiente | 🔴 No producción | Falta trazabilidad completa. |
| CRM Comercial | 🔄 Pendiente | 🔴 No producción | Futuro. |
| Portal Cliente | 🟡 Parcial | 🔴 No producción completa | Falta hardening y validación real. |
| Mobile App | 🔄 Pendiente | 🔴 No producción | Futuro. |
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

### FASE 3 — Billing Persistence

Estado funcional: ✅ Aprobada
Estado producción: 🟡 Requiere validación financiera real

Incluye:

- Invoices.
- Payments.
- Subscriptions.
- Billing settings.
- PostgreSQL / Supabase / RLS.

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

Estado: 🔄 Pendiente · **Prioridad inmediata**

Prerequisito para NOC Read-Only e Inventory Read-Only. Resuelve el drift del repo entre
las dos definiciones de `public.mikrotik_routers` (modelo de monitoreo en `init_schema`
vs modelo de provisioning en `mikrotik_provisioning_schema`).

Alcance (solo preparación de DB y validadores):

1. Reconciliar el schema de `mikrotik_routers` (ver `docs/SUPABASE_MIGRATIONS_SYNC.md`).
2. Crear una migración evolutiva nueva (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), no el `CREATE TABLE` conflictivo de `20260605000000_mikrotik_provisioning_schema.sql`.
3. Validar que `USE_DB_MIKROTIK=false` sigue intacto (dominio en memoria).
4. Actualizar validadores (`scripts/validate-staging-migrations.mjs`) y tests.

Gate:

- No activa `USE_DB_MIKROTIK`.
- No toca routers reales.
- No aplica la migración en Supabase desde Claude; la validación staging la hace Hermes.
- Solo después de DB-1 se prepara NOC e Inventory read-only.

### FASE 4.11 — NOC Read-Only

Estado: 🔄 Pendiente

Recomendación: adelantar esta fase antes de acciones live.

Prerrequisito: **cerrar DB-1** (reconciliación de `mikrotik_routers`) antes de NOC
read-only sobre DB real.

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

Estado: 🔄 Pendiente

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
