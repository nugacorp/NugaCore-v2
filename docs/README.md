# Documentación — NugaCore

Documentación organizada por tema. Los **artefactos de proceso** (evidencia de
validación, auditorías, runbooks) se agrupan por tipo; los **documentos de
diseño vivos** se agrupan por dominio.

## Índice

| Carpeta | Contenido |
| --- | --- |
| [`architecture/`](architecture/) | Diseño de arquitectura, sistema, contratos de datos y deuda técnica |
| [`auth/`](auth/) | Autenticación, RBAC y hardening de login |
| [`billing/`](billing/) | Diseño de facturación y cobranza |
| [`inventory/`](inventory/) | Inventario / ERP |
| [`mikrotik/`](mikrotik/) | MikroTik, RouterOS, provisioning, CHR y plantillas |
| [`network/`](network/) | CRM, clientes, IPAM, planes y cobertura |
| [`noc/`](noc/) | NOC, telemetría y estado de servicio (SSOT) |
| [`suspension/`](suspension/) | Motor de suspensiones y cortes |
| [`wireguard/`](wireguard/) | WireGuard Manager y router enrollment |
| [`frontend/`](frontend/) | Auditoría y diseño de la UI |
| — | — |
| [`results/`](results/) | Evidencia de validación (RESULT / STAGING) para el gate de Hermes |
| [`audits/`](audits/) | Auditorías técnicas, de seguridad y revisiones |
| [`runbooks/`](runbooks/) | Runbooks operativos |
| [`deployment/`](deployment/) | Despliegue, staging, Coolify, VPS y Supabase |
| [`planning/`](planning/) | Roadmap, fases, backlog y estrategia |
| [`reports/`](reports/) | Reportes y auditorías puntuales fechadas |

## Puntos de entrada recomendados

- **Handoff julio 2026 (última ola Router/WG):** [`reports/SPRINT_HANDOFF_2026-07-15.md`](reports/SPRINT_HANDOFF_2026-07-15.md)
- Estado actual del proyecto: [`reports/PROJECT_STATUS_CURRENT.md`](reports/PROJECT_STATUS_CURRENT.md)
- Visión y ruta del producto: [`../ROADMAP.md`](../ROADMAP.md)
- Arquitectura rápida: [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md)
- Checklist de producción: [`deployment/PRODUCTION_READINESS_CHECKLIST.md`](deployment/PRODUCTION_READINESS_CHECKLIST.md)
- Backlog / handoff operativo: [`planning/DEVELOPMENT_HANDOFF_CHECKLIST.md`](planning/DEVELOPMENT_HANDOFF_CHECKLIST.md)
- Backlog maestro: [`planning/MASTER_BACKLOG.md`](planning/MASTER_BACKLOG.md)

## Documentos nuevos / actualizados (julio 2026)

| Documento | Tema |
| --- | --- |
| [`reports/SPRINT_HANDOFF_2026-07-15.md`](reports/SPRINT_HANDOFF_2026-07-15.md) | Resumen del sprint (RSC, UX Routers, inventario, host-apply) |
| [`wireguard/WIREGUARD_HOST_APPLY.md`](wireguard/WIREGUARD_HOST_APPLY.md) | Apply automático peers → `wg0` |
| [`mikrotik/ROUTEROS_RSC_IMPORT_HARDENING.md`](mikrotik/ROUTEROS_RSC_IMPORT_HARDENING.md) | Endurecimiento `/import` CHR |
| [`frontend/ROUTERS_MODULE_UX.md`](frontend/ROUTERS_MODULE_UX.md) | Alta embebida en Routers |
| [`results/WG_HOST_APPLY_STAGING_RESULT.md`](results/WG_HOST_APPLY_STAGING_RESULT.md) | Evidencia staging host-apply |
| [`results/ROUTERS_MODULE_UX_STAGING_RESULT.md`](results/ROUTERS_MODULE_UX_STAGING_RESULT.md) | Evidencia staging UX Routers |
