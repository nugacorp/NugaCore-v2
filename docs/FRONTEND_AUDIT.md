# NugaCore Frontend Audit

## 0. Alcance de esta auditoria
Este documento audita el frontend y la base tecnica actual sin redisenar la interfaz visual.
Se reviso estructura, pantallas, componentes, integracion de datos y riesgos.

## 1. Estructura actual del proyecto
Raiz:
- index.html
- metadata.json
- package.json
- server.ts
- vite.config.ts
- tsconfig.json
- README.md
- supabase/migrations/20260531000000_init_schema.sql
- src/

Frontend en src:
- App.tsx (orquestador principal de vistas, estado global, fetch y control de sesion)
- main.tsx
- index.css
- types.ts
- lib/supabase.ts
- components/
  - LandingPage.tsx
  - LoginForm.tsx
  - Sidebar.tsx
  - Dashboard.tsx
  - CrmModule.tsx
  - BillingModule.tsx
  - NetworkModule.tsx
  - MikrotikModule.tsx
  - SupportModule.tsx
  - InventoryModule.tsx
  - GisModule.tsx
  - FinanceOwnerModule.tsx

Backend actual:
- server.ts con Express + Vite middleware en desarrollo
- API REST simulada en memoria, sin persistencia real

## 2. Tecnologias detectadas
- Frontend: React 19 + TypeScript + Vite
- Backend: Node.js + Express
- Estilos: Tailwind v4 via plugin de Vite
- Iconografia y UI: lucide-react, motion
- IA: @google/genai (copiloto de red)
- DB/Auth cliente: @supabase/supabase-js (uso parcial)
- SQL base: migracion en Supabase PostgreSQL

Observacion:
La base actual NO esta en Next.js. El runtime es Vite + Express.

## 3. Pantallas existentes
Pantallas de entrada:
- Landing comercial-operativa
- Login

Pantallas internas (dashboard shell con sidebar):
- Dashboard Ejecutivo
- CRM Clientes y Leads
- Facturacion y Cobros
- Finanzas y EBITDA
- Red WISP y FTTH
- MikroTik Core Control y Copilot
- Soporte y Ordenes de Trabajo
- Inventario
- GIS y Cobertura
- Owner y Automatizaciones

## 4. Componentes reutilizables detectados
Reutilizables reales:
- Sidebar como layout y navegacion por modulo
- LoginForm y LandingPage reutilizables para acceso/demo
- Tipos compartidos en src/types.ts
- Configuracion Supabase compartida en src/lib/supabase.ts

Reutilizacion limitada o ausente:
- No existe biblioteca UI comun (botones, inputs, cards, modales) desacoplada
- No existe capa de hooks reutilizables para data fetching
- No existe capa de servicios API tipada reutilizable

## 5. Codigo duplicado o desordenado
Hallazgos principales:
1. Monolito de aplicacion
- App.tsx concentra routing interno, sesiones, polling, fetch, errores y acciones de negocio.

2. Monolito de backend
- server.ts concentra datos mock, logica de negocio y endpoints en un solo archivo.

3. Duplicacion de utilidades de formato
- formatMXN duplicado entre modulos.

4. Tipado debil
- Uso extendido de any en props, handlers y respuestas API.

5. Contratos no centralizados
- Esquemas de payload/request/response no estan versionados ni validados de forma comun.

6. Estados y etiquetas inconsistentes
- Estados en UI/backend mock difieren de estados en esquema SQL inicial (ejemplo: lead vs Prospecto, baja vs Cancelado).

7. Seguridad insuficiente en preview fallback
- Login de fallback permite elevacion a Super Admin por email no registrado en mocks.

8. Persistencia local de sesion sin hardening
- Perfil de usuario en localStorage sin firma ni expiracion.

## 6. Que modulos ya estan maquetados
Maquetados con alto nivel visual:
- Dashboard
- CRM
- Billing
- Network
- MikroTik
- Support
- Inventory
- GIS
- Finance/Owner
- Landing y Login

Estado funcional actual:
- Funcionan visualmente y consumen API
- Pero API es principalmente simulada en memoria
- No hay persistencia productiva end-to-end

## 7. Que falta para hacerlo funcional de verdad
1. Arquitectura de backend modular real
- Separar dominios: auth, customers, plans, billing, network, tickets, inventory, maps, monitoring.

2. Persistencia real en PostgreSQL Supabase
- Reemplazar colecciones en memoria por repositorios SQL.

3. Autenticacion y autorizacion reales
- Supabase Auth + perfiles + RBAC robusto por modulo/accion.

4. Validacion de entrada/salida
- Esquemas de validacion para requests y respuestas.

5. Manejo de errores estandar
- Error model comun, codigos, trazabilidad y mensajes de usuario.

6. Capa de datos frontend tipada
- API client tipado y desacoplado de componentes visuales.

7. Estados UX de operacion
- Loading, empty, retry y confirmaciones criticas homogeneros en todos los modulos.

8. Auditoria y seguridad
- Registro de acciones sensibles, cifrado de secretos MikroTik, politicas de acceso.

9. Integraciones externas preparadas
- Adaptadores para MikroTik API, UISP API, pasarelas de pago.

10. Entregabilidad
- Dockerfile, variables de entorno por ambiente, guias de deploy en Coolify.

## 8. Riesgos tecnicos
Riesgo alto:
1. Inconsistencia entre frontend, backend mock y esquema SQL
2. Seguridad de acceso insuficiente en modo fallback
3. Credenciales y datos sensibles no protegidos por arquitectura de secretos

Riesgo medio:
4. Deuda tecnica por archivos monoliticos grandes
5. Contratos API inestables sin versionado
6. Tipado debil con any

Riesgo operativo:
7. Migracion a backend real puede romper UI si cambian payloads sin capa de compatibilidad
8. Falta de tests de regresion para preservar comportamiento visual y funcional

## 9. Plan para conectar backend sin romper el diseno
Estrategia de cero ruptura visual:
1. Mantener componentes y clases CSS existentes intactos.
2. Congelar contratos actuales de endpoints como capa de compatibilidad v1.
3. Implementar nueva capa de servicios por dominio en backend.
4. Reemplazar datos in-memory por repositorios Supabase en backend.
5. Introducir validacion de payload sin modificar estructura de respuesta esperada por UI.
6. Migrar progresivamente handlers de App.tsx a hooks y API client tipado.
7. Agregar feature flags para transicion segura modulo por modulo.
8. Validar cada modulo con checklist visual para confirmar cero cambios de apariencia.

## 10. Roadmap por fases (vision de ejecucion)
Fase A. Auditoria y plan maestro
- Cerrar auditoria tecnica y backlog de trabajo

Fase B. Base tecnica sin cambios visuales
- Estructura backend modular
- utilidades comunes
- error model
- supabase client/server robusto

Fase C. Auth y RBAC
- Login real, logout, proteccion de rutas, roles y permisos

Fase D. Modulos core de negocio
- Clientes
- Planes
- Cobranza
- Suspension simulada

Fase E. Red y operacion
- Torres
- Equipos
- MikroTik seguro
- Tickets
- Ordenes de trabajo

Fase F. Inteligencia operativa
- GIS
- Monitoreo
- Dashboard ejecutivo
- Reportes

Fase G. Automatizacion y seguridad avanzada
- Reglas de automatizacion
- Auditoria profunda
- hardening y respaldo

## 11. Propuesta de estructura de base de datos inicial (alineada a frontend + roadmap)
Nucleo IAM:
- profiles
- roles
- permissions
- user_roles
- role_permissions

Comercial:
- plans
- customers
- customer_status_history
- customer_documents
- customer_locations

Cobranza:
- invoices
- invoice_items
- payments
- payment_allocations

Red fisica y logica:
- towers
- sectors
- network_devices
- customer_services
- service_assignments
- ip_assignments

FTTH/WISP:
- olts
- naps
- nap_ports
- onus
- ppp_secrets_cache
- queues_cache

Soporte y operacion:
- tickets
- ticket_messages
- work_orders
- work_order_checklist_items
- work_order_media

Inventario:
- inventory_items
- warehouses
- inventory_movements
- inventory_assignments

Auditoria y automatizacion:
- audit_logs
- automation_rules
- automation_runs
- notifications_queue

Integraciones:
- mikrotik_routers
- mikrotik_command_logs
- uisp_sites
- uisp_devices

Nota:
Existe una migracion inicial en supabase/migrations con parte de estas entidades, pero requiere normalizacion y cierre de brechas de estados/enum para alinearse al frontend actual y al roadmap.

## 12. Conclusiones ejecutivas
- El frontend visual esta fuerte y no necesita rediseno.
- Hoy el sistema es mayormente una maqueta funcional con backend mock.
- La prioridad tecnica es transformar la capa de datos y seguridad, preservando por completo la apariencia.
- El siguiente paso correcto es ejecutar Fase 0 de base tecnica con enfoque de compatibilidad.
