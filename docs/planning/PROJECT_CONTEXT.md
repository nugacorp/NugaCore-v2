# NugaCore — Contexto Global del Proyecto (PROJECT_CONTEXT)

> Documento maestro de contexto. Punto de entrada para cualquier desarrollador que se incorpore a NugaCore.
> Última actualización: 2026-06-01 · Estado: **Auditoría de comprensión (no se modificó código)**

---

## 1. Visión general

**NugaCore** es la plataforma central de operación de **NugaCorp**, un WISP/ISP mexicano. Su objetivo es administrar **toda** una empresa de internet (inalámbrico + fibra FTTH) desde una sola aplicación, integrando las cuatro capas clásicas de un operador de telecomunicaciones:

| Capa | Significado | Cobertura en NugaCore |
|------|-------------|------------------------|
| **CRM** | Customer Relationship Management | Clientes, prospectos (leads), historial, conversión |
| **ERP** | Enterprise Resource Planning | Inventario, finanzas, planes, recursos |
| **OSS** | Operations Support Systems | Red física, torres, OLT/ONU/NAP, MikroTik, monitoreo |
| **BSS** | Business Support Systems | Facturación, cobranza, suspensiones, CFDI, automatizaciones |

Se inspira en plataformas comerciales del sector: **WispHub, UISP (Ubiquiti), Sonar, Splynx, Wispro y Odoo**. La meta funcional es cubrir el ciclo completo: *prospecto → alta → instalación → aprovisionamiento → facturación → cobranza → soporte → suspensión/reactivación*, todo trazable y auditable.

### Estado real en una frase

> El **frontend está completo y pulido** (10 módulos funcionales con datos en vivo), el **backend existe y es modular** (14 dominios, ~80 endpoints), pero **toda la persistencia es en memoria (mock)**: no hay base de datos conectada. El esquema SQL y el contrato de datos ya están diseñados y listos, pero **no implementados** todavía.

---

## 2. Objetivos

### Objetivo de negocio
Centralizar la operación de un WISP para reducir costos operativos, evitar fugas de cobranza, acelerar altas/instalaciones y dar visibilidad ejecutiva en tiempo real.

### Objetivos de producto (capacidades)
1. Gestión de clientes y prospectos con georreferenciación.
2. Catálogo de planes (residencial / empresarial / dedicado).
3. Facturación con CFDI (México), pagos parciales y estados de cuenta.
4. Cobranza con suspensión/reactivación automática.
5. Gestión de red: torres, sectores, OLT/ONU/NAP (FTTH).
6. Integración MikroTik (lectura segura primero, escritura confirmada después).
7. Inventario técnico con estados, movimientos y asignaciones.
8. Soporte: tickets con SLA y órdenes de trabajo con checklist/evidencias.
9. GIS / mapa operativo de la red y clientes.
10. Dashboard ejecutivo con KPIs y automatizaciones de negocio.

### Objetivo técnico actual (esta etapa)
Pasar de un sistema **mock funcional** a un sistema **persistente y seguro**, sin romper el frontend y sin redibujar la UI.

---

## 3. Alcance

### Dentro del alcance
- Conservar el frontend existente **tal cual** (congelamiento visual).
- Mantener el contrato de API v1 que el frontend ya consume.
- Migrar la persistencia del store en memoria a Supabase/PostgreSQL.
- Endurecer autenticación, RBAC y auditoría.
- Preparar integración real con MikroTik.
- Despliegue en VPS con Docker + Coolify.

### Fuera del alcance (por ahora)
- Rediseño visual o cambio de framework de UI.
- Migración a Next.js (decisión pendiente — ver §9).
- App móvil nativa.
- Integraciones de pago en producción (Stripe/MercadoPago reales).
- Multi-tenant / multi-empresa.

---

## 4. Módulos actuales (implementados en frontend + API mock)

| # | Módulo | Tab UI | Componente | Estado funcional |
|---|--------|--------|-----------|------------------|
| 1 | **Dashboard / NOC** | `dashboard` | `Dashboard.tsx` | KPIs, alertas, monitoreo (mock) |
| 2 | **CRM** | `crm` | `CrmModule.tsx` | Clientes + leads, alta, cambio de estatus |
| 3 | **Facturación** | `billing` | `BillingModule.tsx` | Facturas, pagos, estado de cuenta |
| 4 | **Finanzas / Owner** | `finance` / `owner` | `FinanceOwnerModule.tsx` | Vista financiera y ejecutiva (dueño) |
| 5 | **Red** | `network` | `NetworkModule.tsx` | Torres, sectores, OLT/ONU/NAP, aprovisionamiento |
| 6 | **MikroTik** | `mikrotik` | `MikrotikModule.tsx` | Consola de comandos + Copiloto IA (Gemini) |
| 7 | **Soporte** | `support` | `SupportModule.tsx` | Tickets + órdenes de trabajo |
| 8 | **Inventario** | `inventory` | `InventoryModule.tsx` | Items, movimientos, asignaciones |
| 9 | **GIS / Mapa** | `gis` | `GisModule.tsx` | Mapa de clientes, torres, NAP |

Dominios de backend adicionales que dan soporte transversal: **suspensión**, **automatizaciones**, **reportes** (CSV/Excel/PDF), **seguridad/auditoría**, **planes**, **auth**.

---

## 5. Módulos futuros / pendientes

| Prioridad | Capacidad | Nota |
|-----------|-----------|------|
| Alta | **Persistencia real (Supabase)** | Hoy todo es in-memory; es el bloqueante #1 |
| Alta | **Login real con Supabase Auth** | Hoy se entra con perfiles mock / headers de confianza |
| Alta | **Integración MikroTik real** | Hoy 100% simulada (`getSimulatedCommandOutput`) |
| Media | **Worker/cron de suspensión y monitoreo** | Hoy se dispara manualmente vía endpoint |
| Media | **Monitoreo real (ping/SNMP)** | Hoy son snapshots mock |
| Media | **Pagos en línea reales** (Stripe/MercadoPago/OXXO) | Hoy solo se registran pagos manuales |
| Media | **Timbrado CFDI real (PAC)** | Hoy el UUID es simulado |
| Baja | **Notificaciones reales** (email/WhatsApp/Telegram/push) | Hoy solo configuración |
| Baja | **Integración UISP/Splynx** | Mencionado en plan, no iniciado |
| Baja | **Portal de cliente / autoservicio** | No iniciado |

---

## 6. Arquitectura propuesta (resumen)

> Detalle completo en [SYSTEM_ARCHITECTURE.md](../architecture/SYSTEM_ARCHITECTURE.md).

```
Navegador (SPA React)
      │  fetch /api/* (mismo origen, sin CORS)
      ▼
Express (TS)  ── middleware: auth-context → security-audit → rutas por dominio → errorHandler
      │
      ├── state/store.ts        ← HOY: datos en memoria (mock)
      └── services/             ← supabase-admin, gemini, crypto
                  │
                  ▼ (FUTURO)
            Supabase / PostgreSQL  (service-role key, RLS deny-by-default)
                  │
                  ▼ (FUTURO)
            Worker MikroTik  (lectura/escritura RouterOS API)
```

**Patrón objetivo:** introducir una **capa repository** (mapeadores `snake_case` ↔ `camelCase`) entre las rutas y Supabase, migrando dominio por dominio sin cambiar el contrato de API. El frontend nunca habla con Supabase directamente para datos de negocio (solo Auth); todo pasa por Express.

---

## 7. Tecnologías

| Área | Tecnología | Versión | Notas |
|------|-----------|---------|-------|
| Frontend | React | 19 | SPA, sin router (navegación por `activeTab` en estado) |
| Build | Vite | 6 | Dev server en middleware mode dentro de Express |
| Lenguaje | TypeScript | ~5.8 | `noEmit`, bundler resolution |
| Estilos | Tailwind CSS | 4 | Vía `@tailwindcss/vite` |
| Iconos / anim. | lucide-react / motion | — | |
| Backend | Express | 4.21 | Servido con `tsx` en dev, bundle `esbuild` en prod |
| Base de datos | Supabase / PostgreSQL | — | **Diseñada, no conectada** |
| Auth | Supabase Auth (JWT) + headers de confianza | — | Fallback inseguro en dev |
| IA | @google/genai (Gemini) | 2.4 | Copiloto MikroTik, con fallback |
| Documentos | pdfkit, xlsx | — | Exportes de reportes |
| Deploy | Docker + Coolify + VPS | — | Planeado, sin Dockerfile aún |

**Runtime de un solo proceso:** Express sirve **a la vez** la API y el frontend (Vite en dev, estáticos en prod) en el puerto 3000. No hay separación de procesos front/back.

---

## 8. Decisiones tomadas

Estas decisiones ya están **ratificadas** (ver [DATA_CONTRACT.md](../architecture/DATA_CONTRACT.md) y `MASTER_PLAN.md`):

1. **Stack congelado:** React + Vite + TypeScript + Express (no migrar a Next.js en esta etapa).
2. **Visual freeze:** no se rediseña ni se altera el markup/colores de los componentes.
3. **Frontend es la fuente de verdad:** `src/types.ts` define el contrato; la DB se adapta a él, no al revés.
4. **IDs:** `TEXT`/slug para entidades de negocio (`c-1`, `plan-basic`, `fac-101`); `UUID` para IAM (atado a `auth.users`).
5. **Enums en inglés** en la DB, igual que el frontend; el español es solo etiqueta visual.
6. **Acceso a datos vía backend con service-role key**; RLS deny-by-default como defensa en profundidad.
7. **Auditoría dual:** `audit_logs` (cambios de datos) + `security_audit_logs` (accesos HTTP), no se fusionan.
8. **MikroTik:** lectura segura primero, escritura solo con confirmación explícita (`confirmWrite=true`).
9. **Migración por dominios**, preservando el contrato API v1.

---

## 9. Riesgos (resumen ejecutivo)

> Clasificación detallada en [SECURITY_AUDIT.md](../audits/SECURITY_AUDIT.md) y [TECHNICAL_DEBT.md](../architecture/TECHNICAL_DEBT.md).

| Severidad | Riesgo | Impacto |
|-----------|--------|---------|
| 🔴 Crítico | **Sin persistencia**: todo en memoria, se pierde al reiniciar | No es usable en producción |
| 🔴 Crítico | **Auth por headers de confianza**: el cliente declara su propio rol (`x-user-role`) | RBAC evadible si Supabase no está configurado |
| 🟠 Alto | **MikroTik simulado**: ninguna acción real sobre la red | Funcionalidad OSS no operativa |
| 🟠 Alto | **Secretos/PII en claro en el store** (pppoePassword, datos de clientes) | Riesgo de fuga de datos |
| 🟠 Alto | **Sin pruebas automatizadas ni CI** | Regresiones silenciosas al migrar |
| 🟡 Medio | **Componentes gigantes** (Finance 1086 / GIS 1075 líneas) | Mantenibilidad |
| 🟡 Medio | **`any` extendido en App.tsx y handlers** | Pérdida de seguridad de tipos |
| 🟡 Medio | **Sin rate limiting / helmet / CORS explícito** | Hardening incompleto |
| 🟢 Bajo | **`apiClient.ts` sin usar** (App usa su propio `fetchJson`) | Duplicación |
| 🟢 Bajo | **Modelo Gemini `gemini-3.5-flash`** (nombre dudoso) | Solo afecta copiloto; tiene fallback |

---

## 10. Roadmap (alto nivel)

> Backlog detallado por tareas en [MASTER_BACKLOG.md](./MASTER_BACKLOG.md). Estrategia en [DEVELOPMENT_STRATEGY.md](./DEVELOPMENT_STRATEGY.md).

El proyecto ya recorrió un plan de "Fases 0–16" (ver `MASTER_PLAN.md` y los `PHASE*_PROGRESS.md`), pero **construido sobre el store en memoria**. El roadmap real hacia producción se reorganiza así:

| Fase | Nombre | Meta |
|------|--------|------|
| **F0** | Estabilización | Tooling, lint, ESLint, tests base, Docker, decisión de runtime |
| **F1** | Capa de persistencia | Repository + Supabase, migrar dominio piloto (Clientes) |
| **F2** | Auth real + RBAC server | Supabase Auth, eliminar dependencia de headers de confianza |
| **F3** | Migración de dominios | Mover todos los dominios del store a la DB |
| **F4** | Integración MikroTik real | Worker RouterOS, lectura → escritura confirmada |
| **F5** | Automatización real | Cron suspensión/monitoreo/notificaciones |
| **F6** | Pagos + CFDI reales | Pasarelas y timbrado PAC |
| **F7** | Hardening + observabilidad | Rate limit, logs estructurados, métricas, backups reales |
| **F8** | Deploy productivo | VPS + Coolify + CI/CD |

---

## 11. Glosario WISP

| Término | Significado |
|---------|-------------|
| **WISP** | Wireless ISP — proveedor de internet inalámbrico |
| **FTTH** | Fiber To The Home — fibra hasta el hogar |
| **OLT** | Optical Line Terminal — equipo cabecera de fibra |
| **ONU** | Optical Network Unit — equipo de fibra en casa del cliente |
| **NAP** | Network Access Point — caja de distribución de fibra (splitters) |
| **PPPoE** | Protocolo de autenticación de sesión de cliente |
| **Splitter** | Divisor óptico (1:8, 1:16, 1:64) |
| **Sector** | Antena sectorial de una torre (azimuth/frecuencia) |
| **CFDI** | Comprobante Fiscal Digital por Internet (factura MX) |
| **PAC** | Proveedor Autorizado de Certificación (timbra CFDI) |
| **NOC** | Network Operations Center — centro de monitoreo |
| **MRR** | Monthly Recurring Revenue — ingreso recurrente mensual |
| **Dying gasp** | Última señal de una ONU al perder energía |
