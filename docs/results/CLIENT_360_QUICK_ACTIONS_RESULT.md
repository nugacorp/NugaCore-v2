# Client 360 + Acciones rápidas en la lista de clientes (Resultado)

> Estado: ✅ **Code-complete local** (typecheck/test/build verdes).
> Pendiente: validación de Hermes en staging.
> Inspirado en WispHub, manteniendo la identidad visual de NugaCore (tema
> slate/indigo). Sin cambios de colores, tema ni branding.

## Objetivo

Permitir al operador ejecutar acciones rápidas sobre un cliente directamente
desde la lista de clientes (CRM), sin saltar entre módulos, y abrir un panel
**Cliente 360** con resumen, acciones y historial. Todo seguro: navegación,
modales y simulación local. No toca RouterOS, Worker ni flags peligrosos.

## Qué se agregó

- **Columna "Acciones"** en la tabla de clientes con un botón compacto `⋮`
  (`crm-actions-btn-<id>`).
- **Menú de acciones rápidas** agrupado (`ClientActionsMenu.tsx`):
  Cliente · Servicio · Cobranza · Soporte · Red · Historial. Cada acción se
  muestra solo si el rol tiene la capacidad.
- **Panel Cliente 360** (`Client360Panel.tsx`, slide-over derecho,
  `id="client-360-panel"`): Resumen (nombre, estado, plan, IP, router,
  zona/ciudad, dirección, teléfono/WhatsApp, email, fecha instalación, GPS),
  Acciones rápidas (según rol) e Historial reciente (mock/local con empty state).
- **Modales de acción** y **toast** de feedback en `CrmModule.tsx`.
- **RBAC** de acciones por rol vía `clientActionCaps(role)` en `src/lib/rbac.ts`.

## Qué es REAL vs SIMULACIÓN

| Acción | Comportamiento |
|--------|----------------|
| Ver perfil / Ver eventos | Abre Cliente 360 (real, lectura) |
| Copiar IP | Copia al portapapeles + toast (real) |
| Ver ubicación | Abre Google Maps si hay GPS; si no, "Cliente sin coordenadas." (real) |
| Ver router | Navega a Inventario Routers (RO) / muestra router asignado (real, read-only) |
| Estado de cuenta / Ver tickets | Navega a Facturación / Soporte con contexto (real, navegación) |
| Cambiar IP | Valida formato IPv4 **y duplicado local** contra los clientes cargados; aplicación al router **pendiente** |
| Registrar pago | Modal local → registra en historial **mock/local** (no afecta facturación real) |
| Crear ticket | Modal local → registra en historial **mock/local** (no abre ticket real) |
| Suspender / Reactivar | **Simulación**: modal de confirmación ("no ejecuta cambios reales"), registra evento local. **No** llama RouterOS/Worker/`onUpdateClientStatus` |
| Generar factura | Modal "pendiente de integración" |
| Cambiar plan | Modal "pendiente de integración" |
| Editar cliente | Abre Cliente 360 + aviso "Edición completa pendiente de integración" |

## RBAC (clientActionCaps)

| Acción | SA | Admin | Técnico | Soporte | Cobranza | Solo lectura |
|--------|----|----|----|----|----|----|
| Ver perfil / historial | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copiar IP / ubicación | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Editar | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Suspender / Reactivar | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Cambiar plan / Cambiar IP | ✓ | ✓ | ✓(IP) | ✗ | ✗ | ✗ |
| Registrar pago / Estado de cuenta | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Generar factura | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Crear / Ver tickets | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Ver router | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

No se modificó el RBAC de módulos existente (`canAccessTab`/roleTabs). El panel
de detalle CRM legacy y sus botones conservan su comportamiento previo.

## Archivos

Nuevos:
- `src/components/ClientActionsMenu.tsx`
- `src/components/Client360Panel.tsx`
- `tests/unit/client-360-quick-actions.test.ts`
- `docs/CLIENT_360_QUICK_ACTIONS_RESULT.md`

Modificados:
- `src/components/CrmModule.tsx` (columna Acciones, menú, Client 360, modales, toast, historial local)
- `src/lib/rbac.ts` (`clientActionCaps` + `ClientActionCaps`, aditivo)
- `src/App.tsx` (pasa `userRole` y `onNavigate` a CrmModule)
- `ROADMAP.md`, `docs/DEVELOPMENT_HANDOFF_CHECKLIST.md`, `docs/PROJECT_STATUS_CURRENT.md`

## Tests

`tests/unit/client-360-quick-actions.test.ts` (23 casos): UI (columna, menú,
grupos, Client 360, copiar IP, GPS, simulación, factura pendiente), RBAC por rol
(`clientActionCaps`) y Seguridad (sin `/execute`, sin flags peligrosos, sin
llamadas a RouterOS/MikroTik/Worker desde las acciones rápidas).

## Limitaciones / pendiente de integración

- Registrar pago y Crear ticket son **mock/local** (no persisten en backend).
- Suspender/Reactivar son **simulación** (no aplican cambios ni en store ni en router).
- Cambiar IP valida pero **no aplica** al router.
- Generar factura y Cambiar plan: pendientes de backend seguro.

## Siguiente fase recomendada (gated)

1. Conectar "Registrar pago" al Payment Engine seguro (idempotente) con contexto del cliente.
2. Conectar "Crear/Ver tickets" al módulo de Soporte real.
3. "Cambiar IP" sobre IPAM con `validate-ip` + persistencia de metadatos.
4. Suspender/Reactivar vía Suspension Engine en modo **dry-run/manual** (sin Worker Live).
   Mantener prohibido `MIKROTIK_WORKER_LIVE`, commit mode y escritura RouterOS.

## Qué debe validar Hermes

- La lista de clientes muestra la columna **Acciones** y el menú `⋮` por cliente,
  con visibilidad correcta por rol.
- Cliente 360 abre con resumen, acciones rápidas e historial (empty state).
- Acciones de simulación/pendiente NO ejecutan cambios reales ni tocan routers.
- Sin regresión visual (tema/colores intactos) ni en el alta de clientes existente.
