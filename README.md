# NugaCore ERP — WISP & FTTH Management Engine

### Sistema de Administración, Facturación y Control NOC para NugaCorp 🚀

NugaCore es la consola centralizada de ERP y CRM para **NugaCorp**, diseñada para optimizar de forma integral la administración técnica y comercial de un Proveedor de Servicios de Internet (WISP/FTTH). Inspira sus mejores prácticas en UISP, WispHub y Odoo, implementando un diseño de alta visibilidad, monitoreo continuo de red y Copiloto de diagnóstico de red con Inteligencia Artificial.

---

## 🛠️ 1. Arquitectura de Software Propuesta

Para asegurar alta disponibilidad, tiempos de carga mínimos (Latencia reducida) y seguridad de secrets de la API MikroTik y Gemini, la arquitectura final recomendada se define en **Capas Desacopladas (Decoupled SaaS Architecture)**:

```
┌────────────────────────────────────────────────────────┐
│               CAPA DE CLIENTE (FRONTEND)               │
│  - React 19 + Vite + Tailwind CSS                      │
│  - Lucide Icons & Motion Animations                    │
│  - GIS Mapas Georreferenciados (WGS-84)                │
└───────────────────────────┬────────────────────────────┘
                            │ (Consultas REST / WebSockets)
                            ▼
┌────────────────────────────────────────────────────────┐
│           CAPA DE PROXY & COPILOT (BACKEND)            │
│  - Node.js + Express API Gateway (Puerto 3000)         │
│  - Encriptación AES-256 para credenciales MikroTik     │
│  - SDK Google GenAI (@google/genai) para NOC Copilot   │
└───────────────────────────┬────────────────────────────┘
                            │ (Relación de persistencia y sockets)
                            ▼
┌────────────────────────────────────────────────────────┐
│             CAPA DE PERSISTENCIA & AUTH                │
│  - Supabase client para tiempo real                    │
│  - PostgreSQL Base de Datos Relacional                 │
│  - Row-Level Security (RLS) habilitado                 │
└────────────────────────────────────────────────────────┘
```

### Justificación Tecnológica:
1. **Frontend Multipantalla SPA**: Construido sobre Vite + React para actualizaciones de estado en milisegundos sin refrescar pantalla en el centro de operaciones (NOC).
2. **Express API Gateway**: Proxy obligatorio para proteger la llave privada de **Gemini** y las contraseñas de acceso a los routers MikroTik. Ninguna clave sensible toca el navegador del agente.
3. **Supabase & PostgreSQL**: Estructura relacional rígida indispensable para contener el saldo financiero de facturas, transacciones parciales y coordenadas geográficas.

---

## 💾 2. Esquema de Base de Datos Relacional (PostgreSQL)

Se implementó el esquema inicial con restricciones estrictas de integridad referencial. El script SQL con las especificaciones técnicas completas se encuentra en:
👉 `/supabase/migrations/20260531000000_init_schema.sql`

### Mapa de Tablas Principales:

| Tabla | Propósito | Relaciones Clave |
| :--- | :--- | :--- |
| `users_profile` | Perfiles de operarios de NugaCorp | Link a `auth.users` de Supabase |
| `roles` y `permissions` | Control de accesos de personal | Relación Many-to-Many con usuarios |
| `plans` | Tarifas y anchos de banda simétricos/asimétricos | - |
| `clients` | Registro de leads y clientes activos de fibra/antena | `plan_id` -> `plans` |
| `invoices` | Estados de cuenta mensuales y saldo | `client_id` -> `clients` |
| `invoice_payments` | Control de pagos parciales o adelantados | `invoice_id` -> `invoices` |
| `towers` y `sectors` | Catastro de red inalámbrica WISP física | `tower_id` -> `towers` |
| `mikrotik_routers` | Direcciones IP de routers y claves cifradas | - |
| `tickets` | Soporte postventa y SLA de resolución | `client_id` -> `clients` |
| `work_orders` | Órdenes técnicas de campo con firma digital | `client_id`, `technician_id` |
| `inventory_items` | Inventarios de CPEs, ONUs y routers en bodega | - |
| `audit_logs` | Historial de auditoría para seguridad regulada | `user_id` -> `users_profile` |

---

## 🗺️ 3. Roadmap de Desarrollo por Fases

El desarrollo se planificó de forma sistemática y modular para asegurar estabilización antes del escalamiento:

```
[FASE 0: PREPARACIÓN] ──► [FASE 1: SECURITY & AUTH] ──► [FASE 2: CRM CLIENTES] ──► [FASE 3: PLANES]
                                                                                        │
[FASE 7: BODES ERP] ◄── [FASE 6: TORRES & RED] ◄── [FASE 5: SUSPENSIONES] ◄── [FASE 4: FACTURACIÓN]
       │
[FASE 8: MIKROTIK RUN] ──► [FASE 9: TICKETS] ──► [FASE 10: TRABAJOS] ──► [FASE 11: GEOMAPAS (GIS)]
                                                                                │
[FASE 15: INSIGHTS] ◄── [FASE 14: NOC BOARD] ◄── [FASE 13: STOCK ERP] ◄── [FASE 12: MONITOREOS]
       │
[FASE 16: IA TRIGGERS] ──► [FASE 17: PORTAL HOME] ──► [FASE 18: CHATS APIS] ──► [FASE 19-20: AUDIT & IA]
```

---

## 📋 4. Backlog de Tareas por Sprint

### Sprint 1: Infraestructura Base (Fases 0 - 3)
- [x] **Fase 0**: Configurar la estructura de archivos, definición de ruteo base, Tailwind CSS, y documentación del plan maestro.
- [x] **Fase 0.SQL**: Creación del script DDL PostgreSQL completo con Enums y dependencias de claves secundarias.
- [ ] **Fase 1**: Vinculación de Login/Logout con Supabase Auth e inyección estricta de Roles en el token JWT.
- [x] **Fase 2**: Dashboard CRUD interactivo para administración de prospectos/activos con soporte de mapas georreferenciados.
- [x] **Fase 3**: Catálogo de velocidad de bajada, velocidad de subida y mensualidades autorizadas por plan.

### Sprint 2: Control Comercial y Facturas (Fases 4 - 5)
- [x] **Fase 4**: Motor de cálculo para corte de facturación recursiva, recibos de caja y split de pagos parciales.
- [ ] **Fase 5**: Implementación segura del pool de suspensiones virtuales en listados del router sin alterar tráfico de producción.

### Sprint 3: Planta Externa e Inventarios (Fases 6 - 8)
- [x] **Fase 6**: Vista de Sectores de Transmisión Inalámbrica y cálculo dinámico de cargas por antena.
- [x] **Fase 7**: Creación del maestro de inventarios de CPEs y ONUs por número de serie.
- [x] **Fase 8**: Conector del Mikrotik API RouterOS vía sockets de consulta no destructivos (Queues y Clientes Activos).

### Sprint 4: Control de Soporte y GIS (Fases 9 - 11)
- [x] **Fase 9**: Panel Kanban para la remesa de tickets organizados por SLA contractual.
- [x] **Fase 10**: Hojas de Órdenes Técnicas de instalación con checklist obligatorio y simulación de Firma Digital del cliente.
- [x] **Fase 11**: Mapeo georreferenciado GIS (Co-Map) de cajas de empalme, hilos troncales y drops de fibra óptica.

---

## 🌟 5. Estado Actual: Fase 0 Completada con Éxito

Hemos completado la **Fase 0 (Preparación del Proyecto)** con éxito:
1. **Estructura de Carpetas base**: Creado `/supabase/migrations` para la infraestructura de persistencia.
2. **Entorno de Configuración**: Actualizado `/env.example` con la declaración de las variables de conexión del WISP.
3. **Plano de Base de Datos**: Desplegado todo el esquema DDL PostgreSQL indispensable para Fases 1 a 20.
4. **Dashboard List**: Sidebar de navegación optimizada con accesibilidad responsive para los operadores del NOC de NugaCorp.

---

## 🚀 6. Instrucciones de Ejecución en Desarrollo

1. **Instalar Dependencias**:
   ```bash
   npm install
   ```

2. **Iniciar Servidor Local de Desarrollo**:
   ```bash
   npm run dev
   ```
   *El servidor compilará los módulos dinámicamente y servirá la UI en el puerto 3000.*

3. **Verificar Compilación & Calidad de Tipados**:
   ```bash
   npm run build
   ```
