# Resumen Técnico del Repositorio - NugaCore

**Documento generado para el equipo de desarrollo.**

Este documento proporciona una visión técnica del estado actual del proyecto NugaCore, su arquitectura, los componentes implementados y los pasos críticos pendientes para alcanzar la estabilidad y la preparación para producción.

## 1. Resumen Ejecutivo

NugaCore es una plataforma integral de operaciones (ERP/SaaS) para proveedores de servicios de Internet (WISP/ISP). El objetivo es centralizar la gestión de clientes, facturación, pagos, infraestructura de red (con un fuerte enfoque en MikroTik), monitoreo (NOC), inventario y soporte.

**Estado Clave:** El proyecto está en una fase avanzada de desarrollo funcional, con una arquitectura robusta y modular. Sin embargo, **NO está listo para producción.** Los principales bloqueos son la dependencia de stores en memoria para datos críticos, la falta de un motor de ejecución "en vivo" para interactuar con los routers y la necesidad de un "hardening" general de seguridad y persistencia.

## 2. Arquitectura y Stack Tecnológico

El proyecto sigue una estructura de monorepo con una clara separación de responsabilidades.

-   **Stack Principal:**
    -   **Frontend:** React 19, Vite, TypeScript, Tailwind CSS.
    -   **Backend:** Node.js, Express, TypeScript (ejecutado con `tsx` en desarrollo).
    -   **Base de Datos:** Supabase (PostgreSQL con Row-Level Security).
    -   **Despliegue y CI/CD:** Docker (`docker-compose` para dev/prod) y GitHub Actions para CI.

-   **Arquitectura del Backend:**
    -   **Diseño Orientado a Dominios (DDD):** La lógica de negocio está organizada en módulos cohesivos dentro de `backend/domains/`. Cada dominio (ej. `billing`, `inventory`, `mikrotik`) encapsula su propia lógica, servicios y, eventualmente, su repositorio.
    -   **Seguridad y Calidad:** Existe una base sólida de componentes comunes (`backend/common/`) para logging, manejo de errores, seguridad HTTP (Helmet, CORS, rate-limit), RBAC y validaciones.

## 3. Estado Actual de los Módulos Principales

La mayoría de los módulos existen en un estado funcional, pero su preparación para producción varía. La estrategia central es implementar todo en modo `read-only` o `dry-run` primero.

| Módulo | Estado Funcional | Estado Producción | Notas Clave |
| :--- | :--- | :--- | :--- |
| **Autenticación/RBAC** | ✅ Completo | 🟡 Requiere Hardening | Basado en JWT. Roles y permisos definidos. Falta prohibir `trusted-headers` en producción. |
| **Gestión de Clientes** | ✅ Operativo | 🟡 Pendiente Carga Real | El CRUD de clientes, planes y servicios funciona. La persistencia es avanzada pero necesita validación con datos masivos. |
| **Facturación (Billing)** | ✅ Operativo | 🟡 Requiere Validación Financiera | Lógica de facturación y pagos implementada. La persistencia en DB está avanzada pero debe ser auditada con saldos reales. |
| **Motor de Pagos** | ✅ Operativo | 🟡 Requiere Conciliación Real | Soporta múltiples proveedores (mock/real). Los webhooks y la idempotencia deben validarse en un entorno real. |
| **Gestión MikroTik** | 🟡 Avanzado | 🔴 **Bloqueado** | Incluye Enrollment (vía WireGuard), plantillas (`.rsc`) con parámetros dinámicos. **No ejecuta comandos de escritura.** |
| **Motor de Provisión** | ✅ Operativo (Dry-Run) | 🔴 **Bloqueado** | Calcula y audita las acciones necesarias (`suspend`, `change plan`) pero no las ejecuta en los routers. |
| **NOC (Monitoreo)** | 🟡 Avanzado (Read-Only) | 🟡 Staging | Puede leer y mostrar datos (telemetría, estado). Aún no realiza monitoreo activo (SNMP/ping live). |
| **Inventario** | 🟡 Avanzado (UI/Lógica) | 🔴 **Bloqueado** | El modelo de datos y la UI existen. La persistencia (`USE_DB_INVENTORY`) es una feature flag desactivada por defecto. |
| **WireGuard Manager** | 🟡 Avanzado | 🟢 Estable (con Snapshot) | La gestión de túneles para acceso a routers detrás de NAT es funcional. La persistencia post-reinicio está resuelta mediante snapshots. |

## 4. Estrategia de Persistencia de Datos

Este es un punto **crítico** para el equipo.

-   **Estado Actual:** El sistema opera en un modo híbrido. Algunos dominios ya leen y escriben en Supabase, pero muchos otros dependen de **stores en memoria** que se pierden al reiniciar el servidor.
-   **Estrategia de Migración:** La transición se gestiona mediante feature flags (ej. `USE_DB_INVENTORY`, `USE_DB_ROUTER_ENROLLMENT`). El objetivo es mover progresivamente toda la lógica a un patrón `Service -> Repository` que interactúe con Supabase.
-   **Blocker de Producción:** La dependencia de stores en memoria es el principal impedimento para la estabilidad y la fiabilidad de los datos.

## 5. Flujo de Trabajo y "Production Gates"

El proyecto prioriza la seguridad operativa por encima de todo.

-   **Filosofía:** Read-Only → Simulate (Dry-Run) → Confirm (Manual Action) → Execute (Live).
-   **Production Gates:** El código contiene una serie de flags en `backend/config/production-gates.ts` que actúan como interruptores de seguridad. Funcionalidades peligrosas (como la escritura en routers) están desactivadas por defecto.
-   **Safe Command Queue:** Se ha implementado una cola de comandos segura (`safe-command-queue`) que solo funciona en modo `dry-run`. Modela, valida y audita comandos **sin ejecutarlos**.
-   **Manual Safe Mode:** Existe un modo de operación seguro que permite usar la plataforma en un entorno real para tareas de consulta y gestión de datos (CRM, Billing) sin riesgo de afectar la infraestructura de red.

## 6. Pasos Críticos para Producción (Qué Falta)

1.  **Cierre de la Persistencia:**
    -   **Acción:** Migrar todos los dominios restantes que usan stores en memoria para que utilicen Supabase.
    -   **Prioridad:** Máxima. Es el principal habilitador para cualquier entorno estable.

2.  **Implementación del "MikroTik Worker Engine":**
    -   **Acción:** Desarrollar el servicio responsable de ejecutar comandos reales en los routers.
    -   **Ruta Segura (Obligatoria):**
        1.  **PROD-5:** Conectar la `Safe Command Queue` a un CHR (Cloud Hosted Router) de laboratorio para simular acciones con datos reales.
        2.  **PROD-6:** Ejecutar un primer comando real (mínimo y reversible) en el CHR de laboratorio, con aprobación manual obligatoria.
        3.  **PROD-7:** Realizar un piloto en un router de producción no crítico.

3.  **Hardening y Auditoría General:**
    -   **Acción:** Revisar y fortalecer la seguridad en todos los módulos, especialmente:
        -   Políticas RLS en Supabase.
        -   Validación de webhooks de pago.
        -   Protección contra inyección de comandos.
        -   Auditoría de consistencia de datos entre dominios.

4.  **Pipeline de CI/CD para Producción:**
    -   **Acción:** Formalizar y probar el flujo de despliegue a producción, incluyendo health checks, y estrategias de rollback.

5.  **Documentación de Runbooks:**
    -   **Acción:** Crear guías operativas para tareas críticas: despliegues, backups de la base de datos, procedimientos de restauración y recuperación ante desastres.

## 7. Cómo Empezar

Para levantar el entorno de desarrollo local:

1.  **Instalar dependencias:**
    ```bash
    npm install
    ```
2.  **Configurar el entorno:**
    -   Copiar `.env.example` a `.env`.
    -   Asegurarse de que `NODE_ENV=development`.
3.  **Ejecutar la aplicación:**
    ```bash
    npm run dev
    ```

El servidor y el frontend se ejecutarán en `http://localhost:3000`.
