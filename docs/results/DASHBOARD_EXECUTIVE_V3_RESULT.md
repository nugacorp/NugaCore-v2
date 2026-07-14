# Dashboard Ejecutivo V3 — desaturación y enfoque operativo

Fecha: 2026-06-24
Rama: `main` (trabajo directo sobre main, según protocolo del repo)

## Objetivo

Convertir el Dashboard Ejecutivo en una **pantalla de decisión rápida para el
dueño del WISP**: quitar duplicados y ruido, dejar 8 KPIs principales, una lista
corta de alertas importantes y acciones rápidas, todo en el primer viewport.

Sin cambiar colores, branding, tema oscuro, tipografía ni estilos globales:
**solo reorganización UX/UI e información**.

## Alcance respetado

- No se tocó Billing (funcional), Inventory Sync, RouterOS, MikroTik Runtime,
  Worker Live ni PROD-7.
- No se eliminó funcionalidad del sistema: el tooling NOC se **movió** a un panel
  propio bajo el tab NOC (`NocOperationsPanel`).
- Sin migraciones, sin routers reales, sin flags peligrosos.

---

## Archivos modificados / creados

- `src/components/Dashboard.tsx` — **reescrito** a V3 (8 KPIs + alertas + acciones).
- `src/components/NocOperationsPanel.tsx` — **nuevo**: tooling operativo del NOC
  reubicado (alertas en tiempo real, métricas de red, bot de cobranza, ping,
  umbrales/push Telegram-WhatsApp, consola simuladora de eventos, toasts).
- `src/App.tsx` — Dashboard recibe props recortadas; el tab NOC monta además
  `NocOperationsPanel` (recibe `stats/alerts/onAcknowledgeAlerts/onRefresh/onPostAlert/getAuthHeaders`).
- `tests/unit/dashboard.executive.ui.test.ts` — **nuevo** (validación V3).
- `tests/unit/dashboard.ui.test.ts` — actualizado a la estructura V3.
- `docs/DASHBOARD_EXECUTIVE_V3_RESULT.md` — este documento.

## Widgets eliminados del Dashboard (FASE A + E)

Duplicados retirados:

- "Suscriptores Activos" / "hogares/suc" (duplicaba **Clientes Activos**).
- "Ingresos del mes" (duplicaba **MRR**).
- "SLA Tickets / Alarmas" (duplicaba **Tickets Abiertos**).
- Bento grid completo, sección "Resumen operativo" y "Operación WISP".
- Sección "Cobranza Ejecutiva" + "Top 10 Adeudos" (vive en Facturación).

Movido a NOC (`NocOperationsPanel`, NO eliminado del sistema):

- Alertas del NOC en tiempo real + consola de eventos.
- Simulador de eventos (latencia / corte de fibra).
- Ping / latencia / diagnósticos.
- Umbrales, push notifications, Telegram NOC, WhatsApp Gateway.
- Bot de cobranza (Nuga Automations).

Conceptualmente reubicado (ya existía su módulo): Top 10 adeudos / facturación /
cobrado / clientes con adeudo → **Billing**; equipos reservados / instalaciones /
prospectos → **Operaciones (inventory/support/crm)**.

## Widgets agregados (FASE B/C/D)

**8 KPIs principales** (2 filas de 4, clickeables):

| # | KPI | Fuente | Navega a |
|---|-----|--------|----------|
| 1 | Clientes Activos | `stats.activeClients` | crm |
| 2 | Suspendidos | `stats.suspendedClients` | suspension |
| 3 | MRR | `stats.mrr` | billing |
| 4 | Cobranza del Mes | `billingKpis.cobradoMes` / `stats.cobranzaMes` | payments |
| 5 | Tickets Abiertos | `stats.activeTickets` | support |
| 6 | Torres Online | `stats.towers` | network |
| 7 | Capacidad Promedio | `stats.wispOperations.capacityUtilizationPercent` | inventory |
| 8 | Facturas Vencidas | `billingKpis.facturasVencidas` | billing |

**Alertas Importantes** (máximo 5, priorizadas critical > high > warning):
torre offline, cobranza vencida, capacidad > 90%, clientes suspendidos y alertas
NOC críticas/warning sin reconocer. Cada alerta navega a su módulo.

**Acciones Rápidas** (5): Nuevo Cliente (crm), Registrar Pago (payments), Crear
Ticket (support), Alta Router (router-enrollment), Abrir NOC (noc).

## Navegación implementada (FASE G)

Cada KPI, alerta y acción usa `onNavigate` (cableado en App con `setActiveTab`).
Mapeo de KPIs según FASE G (ver tabla). MRR → `billing` (módulo de facturación);
Capacidad → `inventory`; Torres → `network`.

## Responsive (FASE F)

- KPIs: `grid-cols-2 lg:grid-cols-4` (2×4).
- Acciones: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`.
- Las tres secciones (KPIs, alertas, acciones) caben en el primer viewport
  desktop; el contenido pesado se movió fuera del dashboard.

## Tests agregados (FASE H)

- `tests/unit/dashboard.executive.ui.test.ts`: exactamente 8 KPIs, sin widgets
  duplicados, navegación por KPI correcta, máximo 5 alertas, 5 acciones rápidas,
  responsive, tema preservado y tooling NOC reubicado.
- `tests/unit/dashboard.ui.test.ts`: actualizado a la estructura V3.

## Resultados de verificación

- `npm run typecheck`: **PASS** (exit 0).
- `npm test` (hermético): **PASS** — 1577 passed, 49 skipped (opt-in db/auth).
- `npm run build`: **PASS** (exit 0).

## Qué debe validar Hermes

1. Abrir Dashboard: ver 8 KPIs + Alertas Importantes + Acciones Rápidas en el
   primer viewport (desktop), sin scroll excesivo.
2. Cada KPI navega al módulo correcto (tabla FASE G).
3. Alertas: máximo 5, priorizadas; cada una navega a su módulo.
4. Acciones rápidas: 5 botones operativos.
5. Tab NOC: el tooling movido (alertas RT, ping, simulador, umbrales/push, bot)
   sigue funcionando bajo NOC (no se perdió funcionalidad).
6. Tema/colores/branding/tipografía sin cambios.
