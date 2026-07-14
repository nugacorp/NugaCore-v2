# NugaCore — Análisis de Módulos (MODULES_ANALYSIS)

> Última actualización: 2026-07-08 (WISP OS Olas 0–6)
> Para cada módulo: **qué existe · qué falta · riesgos · complejidad · dependencias.**
> Leyenda complejidad: 🟢 baja · 🟡 media · 🟠 alta · 🔴 muy alta.

> **WISP OS (jul 2026):** ver [`WISP_OS_MODULE_MAP.md`](../planning/WISP_OS_MODULE_MAP.md) para el mapa código↔flags↔gates. Cobertura promedio ~3.2/5 tras Olas 0–6; persistencia crítica activable vía `USE_DB_*` (ver `STAGING_FLAGS_WISP_OS.md`).

| # | Módulo | Cobertura | Gap principal restante |
|---|--------|:---------:|------------------------|
| 1 | Dashboard / Control | 3.5 | Telemetría NOC real |
| 2 | CRM / Client 360 | 3.5 | Storage documentos (Supabase), contrato PDF |
| 3 | Planes | 3 | Cambio masivo MikroTik por tecnología |
| 4 | Facturación / Cobranza | 3.5 | CFDI PAC real; conciliación bancaria |
| 5 | Cortes | 2.5 | Live MikroTik (PROD-5→7) |
| 6 | MikroTik | 2.5 | Write live; torch; multi-WAN |
| 7–20 | Ver WISP_OS_MODULE_MAP | 2–3 | Telemetría, portal auth, app campo |

> **Realidad transversal:** el frontend está completo; persistencia real depende de flags `USE_DB_*`. Dominios críticos tienen repository+service; `store.ts` sigue como fallback hasta cerrar OLA 0 en staging.

---

## 1. Dashboard / NOC

**Frontend:** `src/components/Dashboard.tsx` (841 líneas) · **Backend:** `backend/domains/dashboard/routes.ts` (427)

### Qué existe
- KPIs ejecutivos calculados desde el store: clientes activos/suspendidos/leads, MRR, cobranza/facturación del mes, tickets activos, estado de torres, ONUs.
- `GET /api/dashboard-stats`, `/api/dashboard/executive-summary`, `/api/dashboard/kpi-trends` (tendencia de ingresos 3–12 meses).
- Monitoreo: `/api/monitoring/overview`, `/snapshots`, `/targets`, `/ping-scan` (simulado), `/basic-alert-rules`.
- Alertas NOC: `/api/alerts`, `/api/alerts/acknowledge-all`, banner crítico en `App.tsx`.
- Configuración de notificaciones: `/api/notifications/settings`, `/trigger-simulation`.
- Cálculos de crecimiento mensual, tasa de cobranza, disponibilidad de torres, resolución de tickets.

### Qué falta
- Monitoreo **real** (ping/SNMP/ICMP); hoy `ping-scan` genera datos aleatorios.
- Envío real de notificaciones (push/email/webhooks); solo se cuenta `webhooksCount`.
- Persistencia de snapshots (hoy capados a 200 en memoria).
- Histórico real de KPIs (las tendencias dependen de facturas mock).

### Riesgos
- KPIs "ejecutivos" pueden dar falsa confianza: son derivados de datos demo.
- Polling de 60 s recalcula KPIs en cada request (sin caché).

**Complejidad:** 🟠 alta (muchos cálculos agregados) · **Dependencias:** clientes, facturas, torres, ONUs, tickets, monitoreo.

---

## 2. CRM (Clientes y Prospectos)

**Frontend:** `src/components/CrmModule.tsx` (607) · **Backend:** `backend/domains/customers/routes.ts` (229)

### Qué existe
- Listado con filtros server-side: `status`, `type`, `city`, `planId`, búsqueda `q` (nombre/email/teléfono).
- `GET /api/clients`, `/:id`, `/:id/history` (timeline).
- Alta `POST /api/clients` con conversión de lead → cliente (genera factura inicial, ONU si residential/school, log PPPoE).
- `PUT /api/clients/:id` con efectos: cambio de estatus dispara logs MikroTik, alertas y eventos de timeline (suspensión/reactivación).
- `DELETE /api/clients/:id` con limpieza en cascada (facturas, ONUs, timeline).
- Timeline de eventos por cliente (`created`, `status_change`, `lead_conversion`, `updated`, `note`).

### Qué falta
- Persistencia + integridad referencial real (hoy la cascada es manual con `filter`).
- Documentos e instalación: el tipo soporta `documents[]`/`installationPhotos[]` pero no hay subida real de archivos (storage).
- Validación robusta de entrada (email, teléfono, duplicados).
- Asignación real de IP/PPPoE (hoy se generan valores pseudoaleatorios).

### Riesgos
- IDs hardcodeados como fallback (`planId || 'plan-basic'`) acoplan el frontend a slugs concretos.
- PII en claro (email, teléfono, dirección, lat/lng, pppoePassword).

**Complejidad:** 🟠 alta (efectos colaterales de negocio) · **Dependencias:** planes, facturas, ONUs, timeline, suspensión.

---

## 3. Facturación / Billing

**Frontend:** `src/components/BillingModule.tsx` (553) · **Backend:** `backend/domains/billing/routes.ts` (232)

### Qué existe
- `GET /api/billing/invoices` con `paidAmount`/`pendingAmount` calculados y `syncInvoiceStatus()` (recalcula `paid/unpaid/overdue`).
- `/api/billing/invoices/:id/account-state`, `/account-summary`, `/revenue-report` (por método de pago, top pendientes).
- `POST /api/billing/invoices/:id/pay`: pagos **parciales**, validación de monto, generación de CFDI UUID simulado, **reactivación automática** del cliente al pagar.
- `POST /api/billing/invoices` (alta) y `PUT /:id` (edición).
- `PAYMENT_ALLOCATIONS` para conciliación de pagos.

### Qué falta
- Pasarela de pago real (Stripe/MercadoPago/OXXO/SPEI) y webhooks de conciliación.
- Timbrado CFDI real con PAC (hoy `cfdiUuid` es aleatorio).
- Generación de PDF de recibo/factura (pdfkit está disponible, usado en reportes).
- Generación periódica de facturas (ciclo de facturación / cron).

### Riesgos
- `syncInvoiceStatus()` muta el store en cada GET (lecturas con efectos secundarios).
- Estado "moroso" no existe como tal; se deriva de `overdue` (alineado al contrato, pero hay que documentarlo a usuarios).
- Lógica de negocio (reactivación) embebida en la ruta, no en un service.

**Complejidad:** 🟠 alta · **Dependencias:** clientes, planes, suspensión, automatizaciones, CFDI/PAC (futuro).

---

## 4. Finanzas / Owner

**Frontend:** `src/components/FinanceOwnerModule.tsx` (1086 — **el archivo más grande**) · **Backend:** comparte dashboard/billing/reports.

### Qué existe
- Doble modo (`finance` / `owner`) en un mismo componente, controlado por prop `mode`.
- Vista ejecutiva para el dueño: ingresos, crecimiento, cartera, tickets.
- Consume KPIs de dashboard y datos de facturas/clientes/tickets.

### Qué falta
- Backend dedicado de finanzas (P&L, flujo de caja, gastos, nómina) — hoy reutiliza billing/dashboard.
- Reportes financieros formales y exportes específicos del dueño.

### Riesgos
- 🔴 **Componente God de 1086 líneas**: alta complejidad, difícil de mantener/testear; dos vistas acopladas.
- Sin un dominio "finanzas" propio en backend, la lógica vive dispersa.

**Complejidad:** 🔴 muy alta (por tamaño) · **Dependencias:** dashboard, billing, clientes, tickets.

---

## 5. Red / Network

**Frontend:** `src/components/NetworkModule.tsx` (825) · **Backend:** `backend/domains/network/routes.ts` (328)

### Qué existe
- Torres: CRUD (`/api/network-towers`), estado (`/state`, `/toggle-state`), sectores (`/sectors`).
- FTTH: `GET /api/olt`, `/onu`, `/naps`; `POST /api/onu/provision` (aprovisionamiento simulado).
- Sectores de red con azimuth, frecuencia, conteo de clientes.
- Telemetría de torre (CPU/RAM/temp/ping/uptime/puertos) — **en el tipo, pero mock**.

### Qué falta
- Telemetría real (la decisión de diseño dice que NO se persiste como columnas; viene de monitoreo o del equipo en vivo — ese pipeline no existe).
- Aprovisionamiento real de ONU contra OLT.
- Edición/gestión completa de NAP y puertos de NAP (existen tablas, no endpoints CRUD).
- Relación física real torre ↔ MikroTik ↔ sectores ↔ clientes.

### Riesgos
- `Tower` mezcla config persistente con telemetría en vivo → confunde el modelo (ver contrato §4.6).
- OLT/ONU/NAP existen en tipos y SQL pero la operación real depende de integración FTTH inexistente.

**Complejidad:** 🟠 alta · **Dependencias:** monitoreo, MikroTik, clientes (ONU↔cliente).

---

## 6. MikroTik

**Frontend:** `src/components/MikrotikModule.tsx` (349) · **Backend:** `backend/domains/mikrotik/routes.ts` (418)

### Qué existe
- Registro de routers (CRUD) con **credenciales cifradas** (AES-256-GCM) y `sanitizeRouter` (nunca expone password).
- Consola de comandos `POST /api/mikrotik/command`: clasifica read/write, bloquea escritura sin `confirmWrite=true`, bloquea destructivos (`reboot`, `reset configuration`), audita todo.
- Lecturas: `/health`, `/read/interfaces`, `/read/queues`, `/read/ppp`.
- Auditoría de comandos `/api/mikrotik/command-audit` y logs `/api/mikrotik/logs`.
- **Copiloto IA** `POST /api/mikrotik/copilot` (Gemini) con fallback a script RouterOS pre-generado.

### Qué falta
- 🔴 **Ejecución real contra RouterOS API** (todo es `getSimulatedCommandOutput`).
- Worker/conector real (puerto 8728/8729 TLS), manejo de timeouts y reconexión.
- Health check real (hoy CPU/RAM se copian de la torre o son aleatorios).
- Aplicación real de queues/PPPoE/cortes (la suspensión solo escribe en `MIKROTIK_LOGS`).

### Riesgos
- 🟠 Cuando sea real: comandos de escritura son destructivos por naturaleza; la política de confirmación y auditoría ya existe pero debe endurecerse.
- Modelo IA `gemini-3.5-flash` (nombre dudoso) — solo afecta copiloto, tiene fallback.

**Complejidad:** 🔴 muy alta (integración con hardware de red) · **Dependencias:** crypto, torres, clientes (PPPoE), suspensión, Gemini.

---

## 7. Soporte (Tickets + Órdenes de trabajo)

**Frontend:** `src/components/SupportModule.tsx` (573) · **Backend:** `backend/domains/tickets/routes.ts` (647 — **el router más grande**)

### Qué existe
- **Tickets**: CRUD, asignación de técnico, cambio de estatus, mensajes, adjuntos, historial, SLA (`slaHours`).
- **Órdenes de trabajo**: CRUD, agenda (`/workorders/agenda`), checklist con toggle por ítem, evidencias, firma (base64), `update-status`.
- `GET /api/technicians` (catálogo de técnicos).
- Estados de ticket: open/assigned/resolved/closed; tipos de orden: installation/repair/migration/reallocation.

### Qué falta
- Subida real de adjuntos/evidencias/firmas a storage (hoy son URLs/base64 en memoria).
- Notificaciones de SLA (vencimiento), escalamiento automático.
- Catálogo de técnicos real (ligado a usuarios/roles).
- Métricas de SLA y first-response.

### Riesgos
- Router de 647 líneas con muchos sub-recursos; conviene dividir tickets ↔ workorders.
- Divergencias de enums documentadas en el contrato (estados/tipos) ya resueltas en el SQL, vigilar al migrar.

**Complejidad:** 🟠 alta · **Dependencias:** clientes, técnicos/usuarios, notificaciones, storage.

---

## 8. Inventario

**Frontend:** `src/components/InventoryModule.tsx` (395) · **Backend:** `backend/domains/inventory/routes.ts` (346)

### Qué existe
- Items con categoría, modelo, marca, qty, almacén, seriales.
- Estados operativos (`Disponible/Instalado/En reparacion/...`), movimientos (`in/out/transfer`), asignaciones (assign/unassign a torre/cliente/técnico).
- Endpoints: listado, `/movements`, `/assignments`, `/:id/state`, `/:id/assign`, `/:id/unassign`, `/movement`, `/add`, `/:id`.
- Bitácora de movimientos y asignaciones.

### Qué falta
- Control de stock por serial individual (hoy `serials[]` es informativo, no rastrea cada unidad).
- Conciliación inventario ↔ instalaciones (ONU asignada = item descontado).
- Alertas de stock mínimo.

### Riesgos
- Doble fuente de cantidad: `qty` del item vs movimientos; consistencia manual.

**Complejidad:** 🟡 media · **Dependencias:** torres, clientes, técnicos, red (equipos instalados).

---

## 9. GIS / Mapa

**Frontend:** `src/components/GisModule.tsx` (1075) · **Backend:** `backend/domains/gis/routes.ts` (99)

### Qué existe
- `GET /api/gis/map-data`, `/layers`, `/customers`, `/towers`, `/health`.
- Visualización de clientes, torres, NAP y ONU en mapa con filtros.
- Capas seleccionables por tipo de elemento.

### Qué falta
- Verificar/definir el proveedor de mapa real (Leaflet/OpenStreetMap, mencionado en plan).
- Cálculo de factibilidad/cobertura real (radio de torre vs ubicación de prospecto).
- Trazado de fibra (rutas NAP → cliente).

### Riesgos
- 🔴 Componente de 1075 líneas (segundo más grande); mucha lógica de render geoespacial.
- Depende de coordenadas mock; precisión real sin validar.

**Complejidad:** 🔴 muy alta (por tamaño + geoespacial) · **Dependencias:** clientes, torres, NAP, ONU, OLT.

---

## 10. Owner (vista del dueño)

Comparte el componente `FinanceOwnerModule.tsx` (`mode="owner"`). Ver §4. Diferencia: enfoque en visión global de negocio (KPIs ejecutivos, cartera, salud de red) frente a la vista "finance" más operativa de cobranza.

---

## Módulos transversales de backend (sin tab propio)

| Dominio | Endpoints clave | Estado |
|---------|-----------------|--------|
| **Suspensión** | `/api/suspension/policy`, `/logs`, `/run`, `/clients/:id/suspend|reactivate` | Reglas funcionales, corte simulado |
| **Automatizaciones** | `/api/automations/rules` (CRUD), `/run` | Reglas configurables, ejecución mock |
| **Reportes** | `/api/reports/catalog`, `/summary`, `/export` (CSV/Excel/PDF) | Exportes funcionales con xlsx/pdfkit |
| **Seguridad** | `/api/security/audit-logs`, `/permission-matrix`, `/backup-policy`, `/backup/run`, `/secrets/status` | Bitácora + política de backup (sin backup real) |
| **Auth** | `/api/auth/health`, `/api/auth/me` | Devuelve contexto de auth |
| **Planes** | `/api/plans` CRUD | Funcional sobre store |

---

## Mapa de complejidad y prioridad de migración

| Módulo | Tamaño FE | Complejidad | Prioridad de migración a DB | Riesgo de migración |
|--------|-----------|-------------|------------------------------|---------------------|
| CRM/Clientes | 607 | 🟠 | **1 (piloto)** | Medio (efectos en cascada) |
| Planes | — | 🟢 | 2 | Bajo |
| Facturación | 553 | 🟠 | 3 | Alto (dinero) |
| Suspensión | — | 🟡 | 4 | Medio |
| Red/Torres | 825 | 🟠 | 5 | Medio |
| FTTH (OLT/ONU/NAP) | — | 🟠 | 6 | Alto (tablas nuevas) |
| Inventario | 395 | 🟡 | 7 | Bajo |
| Soporte | 573 | 🟠 | 8 | Medio |
| MikroTik | 349 | 🔴 | 9 (+ worker) | Muy alto (hardware) |
| Dashboard/Monitoreo | 841 | 🟠 | 10 (deriva de los demás) | Bajo |
| GIS | 1075 | 🔴 | 11 (deriva) | Bajo |
| Finanzas/Owner | 1086 | 🔴 | 12 (deriva) | Bajo |

> Recomendación de orden derivada en [DEVELOPMENT_STRATEGY.md](../planning/DEVELOPMENT_STRATEGY.md) y [MASTER_BACKLOG.md](../planning/MASTER_BACKLOG.md).
