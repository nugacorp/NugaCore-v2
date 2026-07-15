# UX — Módulo Routers (alta embebida)

Fecha: 2026-07-15  
Estado: en `main` (`521c5fc`).

## Decisión de producto

El alta de router **no** es un ítem separado del sidebar. El flujo WISP diario es:

**Sistema → Routers → Dar de alta** → wizard de enrollment existente.

## Comportamiento

| Superficie | Comportamiento |
| --- | --- |
| Sidebar Sistema | Categoría desplegable → `Routers`, `Plantillas`, Configuración, … (un solo lugar) |
| `InventoryRoutersModule` | Inventario + **Dar de alta** + **Verificar** + **Eliminar** |
| Eliminar | `DELETE /api/mikrotik/routers/:id` → revoca WG + borra alta + inventario |
| Panel enrollment | Renderiza `RouterEnrollmentWizard` (`startInWizard`, `onBack` → inventario) |
| Tab `router-enrollment` | Oculto del sidebar (`SIDEBAR_HIDDEN_TABS`); deep-link / workspace redirige a Routers con alta abierta |
| Dashboard “Alta router” | Navega a Routers + abre enrollment |
| Manual de usuario | Instrucciones actualizadas a “Sistema → Routers → Dar de alta” |
| NOC | Solo lectura; no elimina routers |

## RBAC

- Inventario (`inventory-routers`): visible según rol (incl. Soporte / Solo lectura).
- Alta / Verificar: Super Admin / Administrador / Técnico (`canStartEnrollment`).
- Eliminar / Revocar: Super Admin / Administrador (`canRevokeEnrollment`).
- Si un rol sin permiso llega con panel enrollment, se muestra inventario.

## Archivos

- `src/components/InventoryRoutersModule.tsx`
- `src/components/RouterEnrollmentWizard.tsx` (`onBack`, `startInWizard`)
- `src/App.tsx` (`navigateToTab`, `routersOpenEnrollment`)
- `src/lib/rbac.ts` (`router-enrollment` en `SIDEBAR_HIDDEN_TABS`)
- `src/components/Sidebar.tsx`
- `tests/unit/navigation.ui.test.ts`

## Contrato de navegación

Sistema sidebar ids de routers: `inventory-routers`, `routeros-templates` (antes de Configuración).  
`router-enrollment` permanece en el union `AppTab` y en role tabs, pero no se lista.
