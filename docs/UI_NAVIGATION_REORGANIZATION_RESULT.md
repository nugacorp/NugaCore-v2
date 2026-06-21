# Reorganización profesional de la navegación (Sidebar WISP) + Manual de Usuario

> Cambio **solo UI/UX de navegación** (más un módulo de documentación frontend).
> No se crean funcionalidades backend, no se tocan APIs/endpoints, no se eliminan
> módulos, no se cambian permisos reales, no se activan flags, no se toca RouterOS
> ni routers reales.
>
> Última actualización: 2026-06-21. Rama: `main`.

## Problema anterior

El sidebar mostraba módulos técnicos al mismo nivel, mezclando operación diaria
del WISP con herramientas internas de seguridad (Safe Mode, Cola Dry-Run) e
infraestructura interna (WireGuard). Para un operador de WISP esto era confuso:
no quedaba claro qué se usa a diario y qué es interno/avanzado. Además faltaba un
punto de entrada de ayuda para usuarios nuevos.

## Decisiones de producto

1. **WireGuard se oculta del sidebar.** Es infraestructura interna de NugaCore
   (servidor en el VPS). Al generar un **Alta de Router** (Router Enrollment) el
   sistema crea el peer automáticamente; el WISP no crea servidores ni peers a
   mano. El backend y el dominio WireGuard se conservan intactos (lo usa el
   enrollment).
2. **Modo Seguro Manual y Cola Dry-Run se ocultan del sidebar.** Son herramientas
   internas de seguridad para fases futuras (PROD-x). Se conservan código, rutas,
   tests y acceso directo por tab/URL; solo dejan de listarse como módulos
   operativos normales.
3. **Routers vive dentro de MikroTik** (antes estaba suelto en Red).
4. **Se agrega Manual de Usuario** como módulo visible (documentación frontend).

## Nueva estructura final del sidebar (6 secciones, español)

```text
1. Inicio
   - Dashboard              (id: dashboard)
   - NOC                    (id: noc)

2. Clientes
   - Clientes               (id: crm)
   - Tickets                (id: support)
   - Suspensiones           (id: suspension)
   - Pagos                  (id: payments)
   - Facturación / Planes   (id: billing)

3. Red WISP
   - Mapa / Infraestructura (id: gis)
   - Torres y Sitios        (id: network)
   - Inventario             (id: inventory)

4. MikroTik
   - Routers                (id: inventory-routers)
   - Panel MikroTik         (id: mikrotik)
   - Alta de Router         (id: router-enrollment)
   - Plantillas             (id: routeros-templates)
   - Scripts                (id: routeros-resources)
   - RouterOS Lab           (id: routeros-readonly)

5. Operaciones
   - Analytics              (id: finance)

6. Sistema
   - Configuración          (id: owner)
   - Manual de Usuario      (id: user-manual)   ← NUEVO
```

## Módulos ocultos del sidebar principal (no borrados)

| ID                   | Por qué se oculta                                              | ¿Accesible? |
| -------------------- | ------------------------------------------------------------- | ----------- |
| `wireguard`          | Infraestructura interna; peer automático en Alta de Router    | Sí (RBAC + tab directo) |
| `manual-safe-mode`   | Herramienta interna de seguridad (fases futuras)              | Sí (RBAC + tab directo) |
| `safe-command-queue` | Herramienta interna de seguridad (dry-run, fases futuras)     | Sí (RBAC + tab directo) |

No se eliminan, no se rompen tests backend ni rutas. Solo no se renderizan como
módulos visibles del sidebar normal.

## Mecanismo: visibilidad ≠ acceso

Se separó **acceso RBAC** de **visibilidad en sidebar** en `src/lib/rbac.ts`:

- `canAccessTab(role, tab)` — acceso real (sin cambios; gobierna render en
  `App.tsx` y redirección).
- `SIDEBAR_HIDDEN_TABS` — set de módulos ocultos (`wireguard`,
  `manual-safe-mode`, `safe-command-queue`).
- `isSidebarHiddenTab(tab)` / `isVisibleInSidebar(role, tab)` —
  `isVisibleInSidebar = canAccessTab && !isSidebarHiddenTab`. El sidebar filtra
  sus items con este helper, de forma centralizada.

Así los módulos ocultos siguen accesibles por tab/URL directo y se renderizan en
`App.tsx` cuando `activeTab` coincide; simplemente no aparecen en el menú.

## Manual de Usuario (nuevo módulo)

- Archivo: `src/modules/user-manual/UserManualModule.tsx` (100% frontend, sin
  backend ni APIs).
- Tab id: `user-manual`. Integrado en `App.tsx`, `Sidebar.tsx` (Sistema) y
  `rbac.ts` (AppTab, todos los roles, `MODULE_LABELS`).
- Visible para **todos** los roles (Super Admin, Administrador, Técnico, Soporte,
  Solo lectura y **Cobranza**).
- Contenido: título, descripción y secciones con pasos básicos para Dashboard,
  Clientes, Tickets, Facturación y Planes, Pagos, Suspensiones, Red WISP,
  MikroTik / Routers, Alta de Router, Plantillas y Scripts, RouterOS Lab y NOC.
- Aclara explícitamente que **WireGuard, Safe Mode y Command Queue no están
  disponibles como módulos operativos normales**.

## IDs conservados

Los IDs de tab existentes no cambian. Se agrega un único ID nuevo: `user-manual`
(22 tabs en total = 21 previos + Manual). Por eso `activeTab` no se rompe y el
view dispatcher de `App.tsx` sigue intacto. El "MikroTik Workspace" in-page
(`MIKROTIK_WORKSPACE_TABS`) se conserva sin cambios.

## RBAC funcional sin cambios

La matriz de **acceso** por rol (`roleTabs`) no se reduce: los módulos ocultos
siguen accesibles para los roles que ya los tenían. Lo único añadido es
`user-manual` para todos los roles. La novedad es la capa de **visibilidad** en
sidebar, que no quita permisos.

## Backend / APIs sin cambios

No se tocó backend, endpoints, providers, dominio WireGuard, RouterOS ni routers
reales. No se activó ningún flag.

## Archivos modificados / creados

- `src/components/Sidebar.tsx` — 6 secciones, Routers en MikroTik, Manual en
  Sistema, filtro `isVisibleInSidebar`.
- `src/lib/rbac.ts` — `user-manual` (AppTab/roleTabs/labels), `SIDEBAR_HIDDEN_TABS`,
  `isSidebarHiddenTab`, `isVisibleInSidebar`.
- `src/App.tsx` — import + render de `UserManualModule`; copy del banner.
- `src/modules/user-manual/UserManualModule.tsx` — **nuevo**.
- `tests/unit/navigation.ui.test.ts`, `tests/unit/rbac.frontend.test.ts`,
  `tests/unit/manual-safe-mode.ui.test.ts`, `tests/unit/safe-command-queue.ui.test.ts`
  — actualizados.
- `tests/unit/user-manual.ui.test.ts` — **nuevo**.
- `docs/UI_NAVIGATION_REORGANIZATION_RESULT.md` — este documento.

## Validación

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build` — PASS

## Qué debe validar Hermes

1. El sidebar muestra 6 secciones: Inicio, Clientes, Red WISP, MikroTik,
   Operaciones, Sistema.
2. El sidebar **NO** muestra WireGuard, Modo Seguro Manual ni Cola Dry-Run.
3. Routers aparece dentro de MikroTik.
4. Manual de Usuario aparece en Sistema y es visible para todos los roles,
   incluida Cobranza.
5. Los módulos ocultos siguen accesibles por tab/URL directo (RBAC intacto) y se
   renderizan en `App.tsx`.
6. No hay módulos duplicados; `activeTab` y RBAC sin regresiones.
7. El sidebar no muestra badges ruidosos; los badges siguen dentro de cada vista.

## Siguiente fase recomendada

**PROD-5 / CHR Read-Only real** queda recomendado **solo después** de validar
esta UX. No avanzar a conectar CHR real ni tocar RouterOS real hasta el visto
bueno de Hermes sobre la navegación.
