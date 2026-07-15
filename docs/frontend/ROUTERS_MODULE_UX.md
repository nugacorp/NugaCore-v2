# UX — Módulo Routers (alta embebida)

Fecha: 2026-07-15  
Estado: en `main` (`521c5fc`).

## Decisión de producto

El alta de router **no** es un ítem separado del sidebar. El flujo WISP diario es:

**MikroTik → Routers → Dar de alta** → wizard de enrollment existente.

## Comportamiento

| Superficie | Comportamiento |
| --- | --- |
| Sidebar MikroTik | `Routers`, `Plantillas` |
| `InventoryRoutersModule` | Inventario + botón **Dar de alta** (roles con `canStartEnrollment`) |
| Panel enrollment | Renderiza `RouterEnrollmentWizard` (`startInWizard`, `onBack` → inventario) |
| Tab `router-enrollment` | Oculto del sidebar (`SIDEBAR_HIDDEN_TABS`); deep-link / workspace redirige a Routers con alta abierta |
| Dashboard “Alta router” | Navega a Routers + abre enrollment |
| Manual de usuario | Instrucciones actualizadas a “Routers → Dar de alta” |

## RBAC

- Inventario (`inventory-routers`): visible según rol (incl. Soporte / Solo lectura).
- Alta: Super Admin / Administrador / Técnico (`canStartEnrollment`).
- Si un rol sin permiso llega con panel enrollment, se muestra inventario.

## Archivos

- `src/components/InventoryRoutersModule.tsx`
- `src/components/RouterEnrollmentWizard.tsx` (`onBack`, `startInWizard`)
- `src/App.tsx` (`navigateToTab`, `routersOpenEnrollment`)
- `src/lib/rbac.ts` (`router-enrollment` en `SIDEBAR_HIDDEN_TABS`)
- `src/components/Sidebar.tsx`
- `tests/unit/navigation.ui.test.ts`

## Contrato de navegación

MikroTik sidebar ids esperados: `inventory-routers`, `routeros-templates`.  
`router-enrollment` permanece en el union `AppTab` y en role tabs, pero no se lista.
