# BILLING UI AUDIT — Fase 4.3

Fecha: 2026-06-04
Alcance: auditoría de la UI de Billing previa a conectarla al backend persistente
(`USE_DB_BILLING=true`). No se rediseña el sistema; se mapea qué funciona, qué
falta y qué riesgos existen.

## 1. Archivos revisados

| Archivo | Rol |
|---|---|
| `src/components/BillingModule.tsx` | UI principal de Facturación & Cobros (tab `billing`). |
| `src/components/FinanceOwnerModule.tsx` | Finanzas/Owner. Sub-tab "Simulador App Cliente" paga facturas; "Finanzas" calcula KPIs en cliente. |
| `src/App.tsx` | Estado global de `invoices`, handlers `handlePayInvoice` / `handleCreateInvoice` / `handleEditInvoice`, `fetchData()`. |
| `src/lib/apiClient.ts` | Cliente HTTP genérico (no usado aún por billing; App usa su propio `fetchJson`). |
| `src/lib/rbac.ts` | RBAC visual a nivel de **tab** (no a nivel de acción/botón). |
| `backend/domains/billing/{routes,service,repository,mappers}.ts` | Contrato real de la API v1. |

## 2. Endpoints actuales y su uso en la UI

| Endpoint | Método | Consumido por UI hoy | Notas |
|---|---|---|---|
| `/api/billing/invoices` | GET | ✅ `App.fetchData()` → `invoices` | Devuelve `EnrichedInvoice[]` (incluye `paidAmount`, `pendingAmount`). La UI ignora esos dos campos. |
| `/api/billing/invoices` | POST | ✅ `handleCreateInvoice` | Funciona contra backend real. |
| `/api/billing/invoices/:id/pay` | POST | ⚠️ `handlePayInvoice` | Solo envía `{ method }`. **Nunca envía `amount`** → imposible registrar pago parcial desde la UI. |
| `/api/billing/invoices/:id` | PUT | ✅ `handleEditInvoice` | Funciona. |
| `/api/billing/account-summary` | GET | ❌ No se usa | KPIs se calculan en el cliente desde `invoices`. |
| `/api/billing/revenue-report` | GET | ❌ No se usa | No hay vista de ingresos por método / top deudores. |
| `/api/billing/invoices/:id/account-state` | GET | ❌ No se usa | No hay estado de cuenta por factura (allocations). |

## 3. Qué UI YA funciona (contra backend real)

- **Listado de facturas**: `App` carga `/api/billing/invoices` y `BillingModule` las renderiza con filtro por estado y búsqueda. Compatible con DB real.
- **Crear factura**: modal "Emitir Factura / Cargo" → `POST /invoices` → `fetchData()` refresca. OK.
- **Editar factura**: modal "Editar Factura" → `PUT /invoices/:id` → refresca. OK.
- **Pago completo**: botón de pasarela → `POST /invoices/:id/pay` sin `amount` = backend paga el balance completo. OK para liquidación total.
- **Refresco tras mutación**: los tres handlers llaman `await fetchData()` al terminar.
- **Badges de estado**: `paid` / `unpaid` / `overdue` tienen badge visual.

## 4. Qué UI FALTA

1. **Pago parcial**: no hay campo de monto; siempre liquida el total. El backend ya soporta `amount` parcial y devuelve `paidAmount` / `pendingAmount`.
2. **Visual de saldo (partial)**: no se muestra pagado vs pendiente, aunque el backend lo devuelve.
3. **Estado `canceled`**: el tipo lo admite y el backend lo devuelve, pero la UI no tiene badge para él.
4. **Estado de cuenta por factura**: `account-state` (allocations: monto, método, fecha, transactionId, saldo tras cada pago) no se muestra.
5. **Resumen de cobranza desde API**: `account-summary` no se consume; los totales del header se calculan en cliente (pueden divergir del backend, sobre todo con pagos parciales).
6. **Reporte de ingresos**: `revenue-report` (ingresos por método, top facturas pendientes) no existe en la UI.
7. **RBAC visual por acción**: los botones crear/pagar/editar se muestran a todos los roles con acceso al tab (incluida "Solo lectura"). El backend rechaza (403) pero la UI no oculta los botones → mala UX.

## 5. Handlers acoplados al mock / problemas de contrato

- `handlePayInvoice(invoiceId, method)` — firma sin `amount`. Para pago parcial hay que extender a `(invoiceId, method, amount?)` **manteniendo compatibilidad** con `FinanceOwnerModule`, que llama `onPayInvoice(id, method)`.
- **Errores silenciados**: `handlePayInvoice` / `handleCreateInvoice` / `handleEditInvoice` hacen `catch (err) { console.error(err) }` y **no relanzan**. Por eso el `try/catch` de `BillingModule` nunca ve el fallo y no puede mostrar estado de error ni de éxito real. Hay que **propagar** el error (re-throw) para que la UI reaccione.
- **KPIs en cliente**: `BillingModule` recalcula `totalInvoiced/totalPaid/totalPending` desde `invoices`. Con pagos parciales esto es incorrecto (suma `amount` completo de facturas `unpaid`). Debe usar `account-summary`.
- **Botones decorativos**: "Generar Reporte Cobranza" hace `alert(...)`; las pasarelas (Stripe/OXXO/SPEI) son **simulación** (no hay pago en línea — fuera de alcance). Se conservan como simulación etiquetada.
- `apiClient.ts` existe pero billing usa el `fetchJson` propio de `App`. No se unifica en esta fase (fuera de alcance, evitar romper auth headers).

## 6. Estados faltantes (UX)

- Cargando facturas (la lista no tiene placeholder propio; depende del `loading` global de App).
- Cargando estado de cuenta (no existe la vista).
- Registrando pago / creando factura / editando (no hay feedback más allá del spinner del botón de pago).
- Error de pago / error de creación (silenciado hoy).
- Pago exitoso / factura creada / datos actualizados (sin toast).
- Sin facturas (no hay estado vacío en la lista).

## 7. Riesgos

- **Compatibilidad de firma `onPayInvoice`**: cambiarla mal rompería `FinanceOwnerModule`. Mitigación: parámetro `amount` **opcional** al final.
- **Divergencia de totales**: mover KPIs a `account-summary` puede mostrar cifras distintas a las previas (las nuevas son las correctas del backend). Mantener fallback al cálculo local si el endpoint aún no respondió.
- **Tipos**: `Invoice` no declara `paidAmount`/`pendingAmount`. Añadirlos como **opcionales** es aditivo y no rompe el contrato ni otros módulos.
- **Sin entorno de render en tests**: la suite corre en `environment: 'node'` sin `@testing-library/react` ni `jsdom`. Para no introducir dependencias pesadas ni reconfigurar Vitest, la lógica de presentación (derivación de estado, visibilidad por rol, cómputo de resumen) se **extrae a helpers puros** y se prueban como `.test.ts`. Cubre el *intento* de Task 8 sin riesgo de romper `npm test` / `build`.
- **No tocar**: MikroTik, Tickets, Inventory, GIS, migraciones, contrato API, `USE_DB_BILLING`. La reactivación automática al pagar vive en el backend (solo modo mock) y no se altera.

## 8. Plan de conexión (resumen)

1. Extender `Invoice` con `paidAmount?` / `pendingAmount?` (aditivo).
2. Helpers puros: `src/lib/billingRbac.ts` (`canManageBilling`) y `src/lib/billingView.ts` (estado/etiqueta, resumen, agregaciones de reporte).
3. `App.tsx`: cargar `account-summary` y `revenue-report` en `fetchData`; relanzar errores en handlers; `handlePayInvoice` acepta `amount?`; pasar `userRole`, `accountSummary`, `revenueReport` y un `onFetchAccountState` a `BillingModule`.
4. `BillingModule.tsx`: pago parcial + saldo, badges (incl. `canceled` + partial), estado de cuenta (`account-state`), resumen desde API, panel de reporte, estados loading/error/success, confirmaciones, RBAC visual, estado vacío.
5. Tests de helpers + doc de resultado.
