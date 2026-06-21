# Simplificación de navegación WISP + Dashboard operativo

> Cambio **solo UI/UX** (navegación, jerarquía, orden de información) y un módulo
> de documentación frontend. **No** se cambian colores, fondo, paleta, tipografías,
> tema, branding ni se introducen librerías UI nuevas. **No** se toca backend,
> APIs, RBAC funcional, flags, RouterOS ni routers reales.
>
> Última actualización: 2026-06-21. Rama: `main`.

## Problema anterior

El sidebar mostraba demasiados módulos al mismo nivel y el Dashboard saturaba la
pantalla inicial con paneles de configuración/simulación antes que la información
operativa. Para un operador WISP costaba distinguir la operación diaria de las
herramientas internas, y el arranque no priorizaba estado de red, alertas ni KPIs.

## Cambios aplicados

1. **Sidebar más simple** en 6 áreas de trabajo, con nombres claros en español.
2. **NOC movido a Red** (monitoreo junto al mapa/infraestructura).
3. **Routers dentro de MikroTik** (no en Red).
4. **`RouterOS Lab` renombrado a `Laboratorio MikroTik`** (etiqueta del menú).
5. **Reportes** sustituye a "Operaciones" como nombre de la sección de Analytics.
6. **Módulos internos ocultos** del sidebar (sin borrar): WireGuard, Modo Seguro
   Manual y Cola Dry-Run.
7. **Manual de Usuario** mejorado (Red/NOC, Inventario, Laboratorio MikroTik, FAQ).
8. **Dashboard operativo**: resumen priorizado arriba (estado de red + alertas y
   KPIs clave enlazables), reutilizando los mismos estilos/colores.

## Nueva navegación

```text
Inicio
  - Dashboard

Clientes
  - Clientes               (crm)
  - Tickets                (support)
  - Pagos                  (payments)
  - Facturación / Planes   (billing)
  - Suspensiones           (suspension)

Red
  - NOC                    (noc)
  - Mapa / Infraestructura (gis)
  - Torres y Sitios        (network)
  - Inventario             (inventory)

MikroTik
  - Routers                (inventory-routers)
  - Panel MikroTik         (mikrotik)
  - Alta de Router         (router-enrollment)
  - Plantillas             (routeros-templates)
  - Scripts                (routeros-resources)
  - Laboratorio MikroTik   (routeros-readonly)

Reportes
  - Analytics              (finance)

Sistema
  - Configuración          (owner)
  - Manual de Usuario      (user-manual)
```

> Nota: **Panel MikroTik** (`mikrotik`) se conserva visible dentro de MikroTik. No
> figura en la lista de módulos a ocultar (solo WireGuard, Safe Mode y Command
> Queue) y es un módulo operativo real; retirarlo lo dejaría huérfano del menú.

## Módulos ocultos del sidebar (no borrados)

| ID                   | Motivo                                                       | ¿Accesible? |
| -------------------- | ----------------------------------------------------------- | ----------- |
| `wireguard`          | Infraestructura interna del VPS/NugaCore; el peer se crea solo en Alta de Router. El WISP no crea servidores ni peers a mano. | Sí (RBAC + tab/URL directo) |
| `manual-safe-mode`   | Herramienta interna de seguridad/desarrollo; no es operación diaria. | Sí (RBAC + tab/URL directo) |
| `safe-command-queue` | Herramienta interna (dry-run) de seguridad/desarrollo; no es operación diaria. | Sí (RBAC + tab/URL directo) |

Mecanismo (sin cambios respecto a la fase anterior): `isVisibleInSidebar(role, tab)
= canAccessTab(role, tab) && !SIDEBAR_HIDDEN_TABS.has(tab)` en `src/lib/rbac.ts`.
Acceso ≠ visibilidad: los ocultos siguen accesibles por tab/URL y se renderizan en
`App.tsx`.

### Por qué se oculta WireGuard

Es infraestructura interna (servidor en el VPS). Al generar un **Alta de Router**
el sistema crea el peer automáticamente; el WISP no debe crear servidores ni peers
manualmente. Se conserva todo el backend/dominio WireGuard porque lo usa el
enrollment.

### Por qué se ocultan Safe Mode y Command Queue

Son herramientas internas de seguridad para fases futuras (PROD-x). Exponerlas como
operación diaria confunde. Se conservan código, rutas y tests; solo dejan de
listarse en el sidebar normal.

## Manual de Usuario

`src/modules/user-manual/UserManualModule.tsx` (frontend, sin backend). Tab
`user-manual`, visible para **todos los roles incluida Cobranza**, en Sistema.
Secciones: Inicio/Dashboard, Clientes, Tickets, Pagos, Facturación y Planes,
Suspensiones, Red / NOC, Inventario, MikroTik / Routers, Alta de Router, Plantillas
y Scripts, Laboratorio MikroTik y **Preguntas frecuentes**. Aclara que WireGuard,
Safe Mode y Command Queue no son módulos operativos normales.

## Dashboard operativo mejorado

Se agregó un bloque **Resumen operativo** al inicio del Dashboard
(`id="dashboard-operativo"`) que prioriza:

- **Estado general de la red** (operativa / requiere atención) según torres offline
  y alertas críticas.
- **Alertas NOC** activas (enlace a NOC), torres online/total y torres offline.
- **KPIs clave** enlazables a su módulo: Suscriptores activos (→ Clientes),
  Suspendidos (→ Suspensiones), Tickets abiertos (→ Tickets), Pendiente de cobro
  (→ Facturación) e Ingresos del mes (→ Reportes).

Todo se deriva de datos ya disponibles (`stats`/`alerts`), sin integraciones nuevas
(p. ej. "Pendiente de cobro" = facturación del mes − cobranza del mes). Se
reutilizan exactamente las clases/colores existentes (slate/indigo); no se cambió
el layout global ni se introdujo tema nuevo. El detalle (tablas largas, consolas de
NOC/push) permanece debajo; la pantalla inicial prioriza el resumen.

## Backend / APIs / tema sin cambios

No se tocó backend, endpoints, dominios (routeros, mikrotik, wireguard, payments,
billing…), RBAC funcional ni flags. No se cambiaron colores, fondos, tipografías,
tamaños globales, tema ni branding.

## Archivos modificados / creados

- `src/components/Sidebar.tsx` — 6 secciones, NOC en Red, Routers en MikroTik,
  Laboratorio MikroTik.
- `src/components/Dashboard.tsx` — bloque "Resumen operativo" + prop `onNavigate`.
- `src/App.tsx` — `onNavigate={setActiveTab}` al Dashboard; copy del banner.
- `src/modules/user-manual/UserManualModule.tsx` — secciones Red/NOC, Inventario,
  Laboratorio MikroTik y FAQ.
- Tests: `navigation.ui`, `routeros.readonly.ui`, `user-manual.ui` actualizados;
  `dashboard.ui` **nuevo**.
- `docs/UI_NAVIGATION_SIMPLIFICATION_RESULT.md` — este documento.

## Validación

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build` — PASS

## Qué debe validar Hermes

1. Sidebar con 6 secciones: Inicio, Clientes, Red, MikroTik, Reportes, Sistema.
2. El sidebar **NO** muestra WireGuard, Modo Seguro Manual ni Cola Dry-Run.
3. NOC aparece en Red; Routers aparece en MikroTik.
4. Manual de Usuario en Sistema, visible para todos los roles (incluida Cobranza).
5. Dashboard muestra el resumen operativo arriba (estado de red, alertas, KPIs).
6. Sin módulos duplicados ni IDs huérfanos; `activeTab` y RBAC sin regresiones.
7. No cambiaron colores/tema; los badges internos (READ ONLY LAB, SAFE MODE, DRY
   RUN) siguen dentro de sus módulos, no en el sidebar.

## Siguiente fase recomendada

Validar esta UX con Hermes **antes** de PROD-5. No avanzar a CHR Read-Only real ni
tocar RouterOS real hasta el visto bueno sobre la navegación y el dashboard.
