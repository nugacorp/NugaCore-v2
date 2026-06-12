# NugaCore — Roadmap Maestro

> Última actualización: 2026-06-12
> Relacionado: [MASTER_PLAN.md](MASTER_PLAN.md) · [BILLING_ROADMAP.md](BILLING_ROADMAP.md) · [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)

---

## Principio rector

> **Visual freeze · Functional expansion.**
> El diseño visual existente se congela. Toda expansión ocurre en backend, datos, seguridad y automatización alrededor del frontend actual.

Cada fase cierra solo cuando entrega: análisis, artefactos construidos, archivos modificados, tablas migradas, instrucciones de prueba, riesgos remanentes y criterio de "siguiente fase".

---

## Estado global

| Grupo | Fases | Estado |
|-------|-------|--------|
| Fundamentos | 0 – 3 | ✅ Completado |
| Billing (Fase 4) | 4.1 – 4.7 | ✅ Completado |
| Billing — Payment Engine | 4.8 | 🔲 Planificado |
| Billing — CFDI | 4.9 | 🔲 Futuro |
| Operaciones de red | 5 – 8 | 🔲 Futuro |
| Soporte y campo | 9 – 10 | 🔲 Futuro |
| Observabilidad | 11 – 13 | 🔲 Futuro |
| Automatizaciones y seguridad | 14 – 16 | 🔲 Futuro |

---

## FASE 0 — Limpieza y base técnica ✅

**Objetivo:** base técnica sólida, estructura limpia, dependencias alineadas.

Entregables completados:

- Diagnóstico `package.json` y scripts
- Stack validado: Vite + Express + TypeScript
- Estructura de carpetas por dominio (sin romper frontend)
- Variables de entorno estandarizadas
- Supabase client/server utilities
- Error model común (`AppError`, `asyncHandler`)
- Helpers comunes (`logger`, `crypto`, `validators`)
- README profesional

---

## FASE 1 — Autenticación y usuarios ✅

**Objetivo:** login real y control de acceso por roles.

Entregables completados:

- Login/Logout con Supabase Auth
- Protección de rutas (`requireRoles`, `requireAction`)
- Perfil de usuario
- 6 roles: Super Admin · Administrador · Cobranza · Técnico · Soporte · Solo lectura
- Tablas: `profiles`, `roles`, `permissions`, `user_roles`, `role_permissions`
- Middleware `attachAuthContext` (JWT real + trusted headers dev)
- RBAC cosmético en UI (`roleTabs`)

---

## FASE 2 — Clientes ✅

**Objetivo:** módulo CRM real con persistencia y filtros.

Entregables completados:

- CRUD clientes con estados (`active`, `suspended`, `cancelled`)
- Búsqueda y filtros por estado
- Ubicación GPS
- Plan contratado (`plan_id`)
- Historial de estados (`customer_status_history`)

---

## FASE 3 — Planes de internet ✅

**Objetivo:** catálogo de planes funcional.

Entregables completados:

- CRUD planes (`residential` / `business`)
- Estado activo/inactivo
- Precio y velocidad (Mbps)
- Tablas: `plans`

---

## FASE 4 — Cobranza y Automatización de Red ✅ / 🔲

> Detalle completo: [BILLING_ROADMAP.md](BILLING_ROADMAP.md)

### Cronología de sub-fases

| Sub-fase | Descripción | Estado | Commit / Aprobación |
|----------|-------------|--------|---------------------|
| **4.1** | Modelo financiero + migración DB | ✅ | `BILLING_4_1_RESULT.md` |
| **4.2** | Persistencia CRUD con feature flag | ✅ | `BILLING_4_2_RESULT.md` |
| **4.3** | UI: gestión de facturas | ✅ | `BILLING_4_3_FINAL_APPROVAL.md` |
| **4.4** | Reportes financieros (6 endpoints) | ✅ | — |
| **4.5** | Suspension Engine + Motor de corte | ✅ | `SUSPENSION_ENGINE_4_5_2_FINAL_APPROVAL.md` |
| **4.6** | MikroTik Provisioning + WireGuard Manager + RouterOS Templates | ✅ | `WIREGUARD_MANAGER_STAGING_RESULT.md` |
| **4.7** | WireGuard Auto Enrollment | ✅ | commit `b683867` · `WIREGUARD_AUTO_ENROLLMENT_REVIEW_FIXES.md` |
| **4.8** | Payment Engine + Reactivación Automática | 🔲 | [PAYMENT_ENGINE_PHASE_PLAN.md](PAYMENT_ENGINE_PHASE_PLAN.md) |
| **4.9** | CFDI / Facturación electrónica SAT | 🔲 | Depende de 4.8 |

### Fases 4.1–4.7 — Resumen ejecutivo

**4.1 – 4.4:** esquema financiero completo en DB, repositorio/service con `USE_DB_BILLING`, UI de facturas conectada, 6 endpoints de reportes financieros.

**4.5:** Suspension Engine con motor de órdenes, worker MikroTik (dry-run confirmado), reglas configurables de vencimiento/corte.

**4.6:** MikroTik Provisioning (credenciales AES-256-GCM, health check), WireGuard Manager (IPAM, keypairs, rotación, cifrado estable para re-descarga), RouterOS Templates Library (13 plantillas en 8 categorías, validación semántica, staging aprobado).

**4.7:** WireGuard Auto Enrollment — dominio completo `backend/domains/router-enrollment/` con 6 estados, 6 endpoints REST con RBAC, UI Wizard 7 pasos, 57 tests (unit + contrato). Hotfix pre-Hermes: rollback de router huérfano, `routerosVersion` persistida en enrollment, `vpnIp` asignada en store.

### Fase 4.8 — Payment Engine (planificada)

> **No iniciada. No implementada. No validada.**

7 subfases: base de datos de pagos → abstracción de proveedores → webhooks → integración billing → reactivación MikroTik → portal cliente → seguridad y auditoría.

Detalle completo en [PAYMENT_ENGINE_PHASE_PLAN.md](PAYMENT_ENGINE_PHASE_PLAN.md).

---

## FASE 5 — Suspensión y reactivación real (MikroTik live) 🔲

**Objetivo:** conectar el Suspension Engine (Fase 4.5) a RouterOS real.

Tareas previstas:

- Worker MikroTik: modo escritura confirmado (PPPoE disable/enable)
- Cola de comandos con reintentos
- Reactivación automática al confirmar pago (Fase 4.8 prerequisito)
- Bitácora de acciones en `mikrotik_actions`

**Dependencia:** Fase 4.5 ✅ · Fase 4.8 🔲

---

## FASE 6 — Torres y sitios 🔲

**Objetivo:** gestión operativa de infraestructura física de red.

Tareas previstas:

- CRUD torres con GPS y sectores
- Estado de torre (operativa/degradada/offline)
- Asignación de clientes a sectores
- Tablas: `towers`, `sectors`

---

## FASE 7 — Equipos e inventario técnico 🔲

**Objetivo:** control técnico de activos de red.

Tareas previstas:

- Alta/edición/asignación de equipos
- Estados: en almacén/desplegado/dañado/retirado
- Historial de movimientos
- Tablas: `inventory_items`, `warehouses`, `inventory_movements`, `inventory_assignments`

---

## FASE 8 — MikroTik API segura (full read/write) 🔲

**Objetivo:** integración completa con RouterOS vía API real.

Tareas previstas:

- Registro de routers con credenciales cifradas (ya en Fase 4.6)
- Health check real (CPU/RAM/uptime/interfaces)
- Lectura de queues/PPP/NAT
- Escritura confirmada con auditoría
- Worker separado del proceso web

**Dependencia:** Fase 4.6 ✅

---

## FASE 9 — Tickets de soporte 🔲

**Objetivo:** soporte con trazabilidad.

Tareas previstas:

- CRUD ticket con prioridad/estado
- Asignación a técnico
- Historial, comentarios y adjuntos
- Tablas: `tickets`, `ticket_messages`

---

## FASE 10 — Órdenes de trabajo 🔲

**Objetivo:** operación de campo controlada.

Tareas previstas:

- Órdenes por tipo (instalación/retiro/soporte)
- Agenda y checklist
- Evidencias fotográficas
- Tablas: `work_orders`, `work_order_checklist_items`, `work_order_media`

---

## FASE 11 — Mapas geoespaciales 🔲

**Objetivo:** vista geoespacial de clientes y red.

Tareas previstas:

- OpenStreetMap/Leaflet
- Filtros por estado/plan/torre
- Geofencing de sectores

---

## FASE 12 — Monitoreo básico NOC 🔲

**Objetivo:** telemetría operativa mínima.

Tareas previstas:

- Ping/latencia/online-offline por router
- Alertas básicas en dashboard
- Tabla: `monitoring_events`

---

## FASE 13 — Dashboard ejecutivo real 🔲

**Objetivo:** KPIs conectados a datos reales.

Tareas previstas:

- Clientes activos/suspendidos/nuevos
- Ingresos del mes, mora, tickets abiertos
- Estado de torres y routers offline
- Crecimiento mensual

---

## FASE 14 — Reportes exportables 🔲

**Objetivo:** exportables operativos y financieros.

Tareas previstas:

- CSV, Excel, PDF
- Reportes por período, por módulo
- Programación de reportes automáticos

---

## FASE 15 — Automatizaciones 🔲

**Objetivo:** reglas de negocio automáticas.

Tareas previstas:

- Reglas: vencimiento → suspensión → alerta → corte
- Motor de notificaciones (email/WhatsApp/Telegram)
- Tablas: `automation_rules`, `automation_runs`, `notifications_queue`

---

## FASE 16 — Seguridad y auditoría avanzada 🔲

**Objetivo:** hardening y cumplimiento operativo.

Tareas previstas:

- Bitácora completa (`audit_logs` con actor/acción/antes/después)
- Permisos granulares por acción
- Cifrado de todos los secretos
- Política de backups real
- Rate limiting y 2FA

---

## Ruta crítica hasta Fase 5

```
4.8.1 → 4.8.2 → 4.8.3 → 4.8.7 → 4.8.4 → 4.8.5 → 4.8.6
                                                      │
                                                      ▼
                                              Fase 5 (MikroTik live)
                                                      │
                                                      ▼
                                              Fase 4.9 (CFDI)
```

---

## Cuándo iniciar Fase 4.8

**Condición de entrada:**
1. Fase 4.7 aprobada por Hermes ✅ (en progreso — hotfix enviado)
2. Diseño del esquema de base de datos (subfase 4.8.1) revisado con el equipo
3. Decisión sobre proveedor de pagos prioritario (MercadoPago vs OpenPay vs manual)

**Recomendación:** iniciar por 4.8.1 + 4.8.7 en paralelo (schema + auditoría), ya que ambos son prerequisito de todas las subfases restantes. No implementar webhooks (4.8.3) hasta que la abstracción de proveedores (4.8.2) esté aprobada.
