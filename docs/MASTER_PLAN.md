# NugaCore Master Plan

> Última actualización: 2026-06-12
> Roadmap detallado por fases: [NUGACORE_ROADMAP.md](NUGACORE_ROADMAP.md)
> Arquitectura del sistema: [ARCHITECTURE.md](ARCHITECTURE.md)

## Estado de implementación (2026-06-12)

| Fases | Estado |
|-------|--------|
| Fase 0 — Base técnica | ✅ Completado |
| Fase 1 — Autenticación y usuarios | ✅ Completado |
| Fase 2 — Clientes | ✅ Completado |
| Fase 3 — Planes | ✅ Completado |
| Fase 4.1–4.7 — Billing, Suspension Engine, WireGuard, Enrollment | ✅ Completado |
| Fase 4.8 — Payment Engine + Reactivación Automática | 🔲 Planificado — No iniciado |
| Fase 4.9 — CFDI / Facturación electrónica | 🔲 Futuro |
| Fases 5–16 | 🔲 Futuro |

---

## 1. Objetivo maestro
Convertir el frontend actual de NugaCore en una plataforma SaaS interna funcional para WISP/ISP, sin alterar apariencia visual sin autorizacion.

Principio rector:
- Visual freeze: se congela el diseno existente.
- Functional expansion: se construye backend, datos, seguridad y automatizacion alrededor del frontend actual.

## 2. Principios de implementacion
1. No redisenar componentes existentes sin aprobacion.
2. Compatibilidad de contratos API para evitar ruptura visual.
3. Dominio por dominio, sin mezclar todo en una fase.
4. Tipado estricto en TypeScript y validaciones de entrada/salida.
5. Seguridad por defecto y auditoria desde fases tempranas.
6. Entrega incremental con criterio de calidad por fase.

## 3. Arquitectura objetivo
Frontend:
- Mantener componentes actuales.
- Introducir capa data-client tipada por dominio.
- Reemplazar fetch directo en componentes con servicios/hooks.

Backend:
- API modular por dominio.
- Services + repositories + validators.
- Error handling comun.

Datos:
- Supabase PostgreSQL con migraciones ordenadas.
- RLS y RBAC.

Integraciones:
- Adaptadores desacoplados para MikroTik, UISP, pagos y notificaciones.

Deploy:
- Docker + Coolify
- Config por ambiente via variables seguras.

## 4. Fases de trabajo

### Fase 0 - Limpieza y base tecnica (sin cambios visuales)
Objetivo:
Dejar base tecnica solida, estructura limpia y dependencias alineadas.

Entregables:
1. Diagnostico package.json y scripts.
2. Validacion de stack (Vite actual o migracion planificada a Next si se aprueba despues).
3. Estructura de carpetas por dominio sin romper frontend.
4. Variables de entorno estandarizadas.
5. Supabase client/server utilities.
6. Error model comun.
7. Helpers comunes.
8. README profesional actualizado.

Criterio de salida:
- Frontend se ve igual.
- Build y dev server estables.
- Sin regresion visual.

### Fase 1 - Autenticacion y usuarios
Objetivo:
Login real y control de acceso por roles/permisos.

Entregables:
- Login/Logout con Supabase Auth.
- Proteccion de rutas.
- Perfil de usuario.
- Roles: Super Admin, Administrador, Cobranza, Tecnico, Soporte, Solo lectura.
- Tablas: profiles, roles, permissions, user_roles.

### Fase 2 - Clientes
Objetivo:
Activar modulo CRM real con persistencia y filtros.

Entregables:
- CRUD clientes.
- Busqueda y filtros por estado.
- Ubicacion GPS.
- Plan contratado.
- Historial basico.

### Fase 3 - Planes de internet
Objetivo:
Gestion funcional de catalogo de planes.

Entregables:
- CRUD planes.
- Tipos residencial/empresarial.
- Activo/inactivo.

### Fase 4 - Cobranza
Objetivo:
Flujo de facturacion y pagos real.

Entregables:
- Estado de cuenta.
- Pagos parciales/adelantados.
- Vencidos/morosos.
- Recibos y reporte de ingresos.

### Fase 5 - Suspension y reactivacion simulada
Objetivo:
Aplicar reglas de suspension sin acciones destructivas reales en MikroTik.

Entregables:
- Suspender/reactivar.
- Bitacora.
- Arquitectura preparada para integracion real.

### Fase 6 - Torres y sitios
Objetivo:
Gestion operativa de red fisica.

Entregables:
- CRUD torres.
- GPS.
- Sectores.
- Estado de torre.

### Fase 7 - Equipos e inventario tecnico
Objetivo:
Control tecnico de activos de red.

Entregables:
- Alta/edicion/asignacion.
- Estados de equipo.
- Historial de movimientos.

### Fase 8 - MikroTik API segura
Objetivo:
Integracion segura con lectura primero y acciones confirmadas despues.

Entregables:
- Registro de routers.
- Credenciales cifradas.
- Health check y lectura de interfaces/queues/ppp.
- Auditoria de comandos.

### Fase 9 - Tickets
Objetivo:
Soporte funcional con trazabilidad.

Entregables:
- CRUD ticket.
- Asignacion tecnico.
- Prioridad/estado.
- Historial/comentarios/adjuntos.

### Fase 10 - Ordenes de trabajo
Objetivo:
Operacion de campo controlada.

Entregables:
- Ordenes por tipo.
- Agenda.
- Checklist.
- Evidencias.

### Fase 11 - Mapas
Objetivo:
Vista geoespacial de clientes y red.

Entregables:
- OpenStreetMap/Leaflet.
- Filtros por estado/plan/torre.

### Fase 12 - Monitoreo basico
Objetivo:
Telemetria operativa minima para NOC.

Entregables:
- Ping/latencia/online-offline.
- Alertas basicas.

### Fase 13 - Dashboard ejecutivo real
Objetivo:
KPIs conectados a datos reales.

Entregables:
- Clientes, ingresos, tickets, torres, offline, crecimiento.

### Fase 14 - Reportes
Objetivo:
Exportables operativos y financieros.

Entregables:
- CSV, Excel, PDF.

### Fase 15 - Automatizaciones
Objetivo:
Reglas iniciales de negocio y alertas.

Entregables:
- Reglas de vencimiento/pago/suspension/alerta.

### Fase 16 - Seguridad y auditoria avanzada
Objetivo:
Hardening y cumplimiento operativo.

Entregables:
- Bitacora completa.
- Permisos por accion.
- Cifrado de secretos.
- Politica de backups.

## 5. Estructura de base de datos inicial propuesta

### IAM
- profiles
- roles
- permissions
- user_roles
- role_permissions

### Clientes y planes
- plans
- customers
- customer_status_history
- customer_documents
- customer_locations

### Cobranza
- invoices
- invoice_items
- payments
- payment_allocations

### Red y servicios
- towers
- sectors
- network_devices
- customer_services
- service_assignments
- ip_assignments

### FTTH y acceso
- olts
- naps
- nap_ports
- onus
- ppp_secrets_cache
- queues_cache

### Soporte y campo
- tickets
- ticket_messages
- work_orders
- work_order_checklist_items
- work_order_media

### Inventario
- inventory_items
- warehouses
- inventory_movements
- inventory_assignments

### Seguridad y automatizacion
- audit_logs
- automation_rules
- automation_runs
- notifications_queue

### Integraciones
- mikrotik_routers
- mikrotik_command_logs
- uisp_sites
- uisp_devices

## 6. Estrategia de no ruptura visual
1. Mantener IDs, estructura y estilos de componentes existentes.
2. Reusar payloads actuales como contrato de compatibilidad v1.
3. Introducir refactor interno por capas sin cambiar markup de UI.
4. Validar cada fase con checklist visual modulo por modulo.

## 7. Criterio de calidad por fase
Cada fase se cierra solo si se entrega:
1. Que se analizo.
2. Que se construyo.
3. Archivos modificados.
4. Tablas creadas o migradas.
5. Como probar.
6. Riesgos remanentes.
7. Siguiente fase.

## 8. Backlog inmediato recomendado (antes de codificar Fase 0)
1. Confirmar decision de runtime: mantener Vite+Express actual o migrar a Next.js por etapas.
2. Definir contrato estable de endpoints por modulo.
3. Definir catalogo final de estados para evitar divergencias UI/DB.
4. Definir convenciones de errores y logging.
5. Aprobar plan de base de datos inicial.

## 9. Estado actual para decision
- Auditoria completada.
- Plan maestro completado.
- No se altero diseno del frontend.
- No se inicio implementacion de modulos funcionales (pendiente de aprobacion).
