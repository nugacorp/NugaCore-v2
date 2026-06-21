# Reorganización profesional de la navegación (Sidebar WISP)

> Cambio **solo UI/UX de navegación**. No se crean funcionalidades, no se toca
> backend, no se cambian endpoints, no se modifican permisos reales, no se
> activan flags, no se toca RouterOS ni routers reales.
>
> Última actualización: 2026-06-21. Rama: `main`.

## Problema anterior

El sidebar mostraba muchos módulos técnicos al mismo nivel, con etiquetas en
inglés o demasiado largas, agrupados en 6 secciones que mezclaban dominios
operativos. El resultado se leía como una **lista técnica de módulos**, no como
el flujo de trabajo de un WISP profesional. Además, el bloque "MikroTik
Workspace" amontonaba funciones de router junto con las operaciones seguras
(modo seguro manual y cola dry-run), que tienen otra naturaleza operativa.

Estructura previa (6 secciones):

```
Dashboard            → Dashboard, NOC
Clientes             → Subscribers, Plans & Billing, Payments, Suspensions, Tickets
Red                  → Network, Infrastructure, Inventory, Routers, WireGuard
MikroTik Workspace   → MikroTik Core, Router Enrollment, Router Templates,
                       Router Scripts, RouterOS Lab, Manual Safe Mode,
                       Safe Command Queue
Operaciones          → Analytics
Administración       → Settings
```

## Nueva estructura (7 secciones, nombres claros en español)

```
1. Inicio
   - Dashboard            (id: dashboard)
   - NOC                  (id: noc)

2. Clientes
   - Clientes             (id: crm)
   - Tickets              (id: support)
   - Suspensiones         (id: suspension)
   - Pagos                (id: payments)
   - Facturación / Planes (id: billing)

3. Red WISP
   - Mapa / Infraestructura (id: gis)
   - Torres y Sitios        (id: network)
   - Inventario             (id: inventory)
   - Routers                (id: inventory-routers)
   - WireGuard              (id: wireguard)

4. MikroTik
   - Panel MikroTik       (id: mikrotik)
   - Alta de Router       (id: router-enrollment)
   - Plantillas           (id: routeros-templates)
   - Scripts              (id: routeros-resources)
   - RouterOS Lab         (id: routeros-readonly)

5. Operaciones Seguras
   - Modo Seguro Manual   (id: manual-safe-mode)
   - Cola Dry-Run         (id: safe-command-queue)

6. Reportes
   - Analytics            (id: finance)

7. Sistema
   - Configuración        (id: owner)
```

## Módulos movidos / renombrados

| ID (conservado)      | Antes (label)        | Ahora (label)            | Antes (sección)      | Ahora (sección)        |
| -------------------- | -------------------- | ------------------------ | -------------------- | ---------------------- |
| `dashboard`          | Dashboard            | Dashboard                | Dashboard            | Inicio                 |
| `noc`                | NOC                  | NOC                      | Dashboard            | Inicio                 |
| `crm`                | Subscribers          | Clientes                 | Clientes             | Clientes               |
| `support`            | Tickets              | Tickets                  | Clientes             | Clientes               |
| `suspension`         | Suspensions          | Suspensiones             | Clientes             | Clientes               |
| `payments`           | Payments             | Pagos                    | Clientes             | Clientes               |
| `billing`            | Plans & Billing      | Facturación / Planes     | Clientes             | Clientes               |
| `gis`                | Infrastructure       | Mapa / Infraestructura   | Red                  | Red WISP               |
| `network`            | Network              | Torres y Sitios          | Red                  | Red WISP               |
| `inventory`          | Inventory            | Inventario               | Red                  | Red WISP               |
| `inventory-routers`  | Routers              | Routers                  | Red                  | Red WISP               |
| `wireguard`          | WireGuard            | WireGuard                | Red                  | Red WISP               |
| `mikrotik`           | MikroTik Core        | Panel MikroTik           | MikroTik Workspace   | MikroTik               |
| `router-enrollment`  | Router Enrollment    | Alta de Router           | MikroTik Workspace   | MikroTik               |
| `routeros-templates` | Router Templates     | Plantillas               | MikroTik Workspace   | MikroTik               |
| `routeros-resources` | Router Scripts       | Scripts                  | MikroTik Workspace   | MikroTik               |
| `routeros-readonly`  | RouterOS Lab         | RouterOS Lab             | MikroTik Workspace   | MikroTik               |
| `manual-safe-mode`   | Manual Safe Mode     | Modo Seguro Manual       | MikroTik Workspace   | Operaciones Seguras    |
| `safe-command-queue` | Safe Command Queue   | Cola Dry-Run             | MikroTik Workspace   | Operaciones Seguras    |
| `finance`            | Analytics            | Analytics                | Operaciones          | Reportes               |
| `owner`              | Settings             | Configuración            | Administración       | Sistema                |

Cambio estructural clave: las **operaciones seguras** (`manual-safe-mode`,
`safe-command-queue`) se separaron del bloque MikroTik a su propia sección, para
no mezclar funciones de configuración de router con la operación segura
(dry-run / modo seguro). `RouterOS Lab` se mantiene dentro de **MikroTik**.

## IDs conservados

Los **21 IDs de tab** siguen siendo exactamente los mismos. Solo cambiaron los
labels visuales, el orden y el grupo. Por eso:

- `activeTab` no se rompe (los `id` de cada módulo no cambian).
- Las vistas en `App.tsx` (view dispatcher por `activeTab`) no se tocan.
- El "MikroTik Workspace" in-page de `App.tsx` (`MIKROTIK_WORKSPACE_TABS`)
  se conserva sin cambios.

## RBAC sin cambios

`src/lib/rbac.ts` **no se modificó**. La visibilidad por rol
(`canAccessTab` / `getAllowedTabsByRole`) sigue idéntica:

- **Super Admin** ve los 21 módulos permitidos.
- **Cobranza** no ve módulos restringidos (mikrotik, red, inventory-routers,
  safe-mode, dry-run, routeros-readonly, owner).
- Safe Mode, Dry-Run y RouterOS Lab siguen accesibles para los roles ya
  autorizados (SA, Admin, Técnico, Soporte, Solo lectura).

El sidebar sigue filtrando cada sección por RBAC y oculta las secciones que
quedan vacías para el rol activo (`filteredSections`).

## Backend sin cambios

No se tocó backend, endpoints, providers, RouterOS ni routers reales. No se
activó ningún flag (`USE_DB_*`, `MIKROTIK_WORKER_LIVE`, etc.).

## Badges fuera del sidebar

El sidebar **no** pinta badges ruidosos (SAFE MODE, DRY RUN, READ ONLY LAB,
NEW, LIVE). Cada módulo conserva su badge **dentro** de su propia vista. El
sidebar solo conserva los indicadores dinámicos de operación (alertas de red y
tickets abiertos) como contadores.

## Archivos modificados

- `src/components/Sidebar.tsx` — nueva definición de `menuSections` (7 secciones).
- `tests/unit/navigation.ui.test.ts` — contrato de navegación actualizado.
- `src/App.tsx` — solo copy del banner de bienvenida (nombres de secciones nuevos).
- `docs/UI_NAVIGATION_REORGANIZATION_RESULT.md` — este documento.

## Validación

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build` — PASS

## Qué debe validar Hermes

1. El sidebar renderiza las 7 secciones en orden: Inicio, Clientes, Red WISP,
   MikroTik, Operaciones Seguras, Reportes, Sistema.
2. Cada módulo aparece en su grupo correcto y con su nombre en español.
3. No hay módulos duplicados ni faltantes (21 tabs).
4. Cobranza no ve módulos restringidos; Super Admin ve todos los permitidos.
5. Safe Mode, Dry-Run y RouterOS Lab siguen accesibles para roles permitidos.
6. El sidebar no muestra badges ruidosos; los badges siguen dentro de cada vista.
7. `activeTab` y RBAC sin regresiones.

## Siguiente fase recomendada

**PROD-5 / CHR Read-Only real** queda recomendado **solo después** de validar
esta UX. No avanzar a conectar CHR real ni tocar RouterOS real hasta el visto
bueno de Hermes sobre la navegación.
