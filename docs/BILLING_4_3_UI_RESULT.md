# BILLING 4.3 — UI CON DATOS REALES (RESULTADO)

Fecha: 2026-06-04
Objetivo: conectar la UI de Billing al backend persistente (`USE_DB_BILLING=true`)
sin rediseñar el dashboard ni romper el contrato de la API v1.

Auditoría previa: [BILLING_UI_AUDIT.md](BILLING_UI_AUDIT.md).

## 1. Pantallas afectadas

| Pantalla / módulo | Cambio |
|---|---|
| **Billing** (`src/components/BillingModule.tsx`) | Reescrito para operar con Billing DB real: pago parcial/total, estado de cuenta por factura, resumen de cobranza desde API, reporte de ingresos, estados de carga/error/éxito, confirmaciones, RBAC visual y estado vacío. |
| **Finance / Owner** (`src/components/FinanceOwnerModule.tsx`) | El "Simulador App Cliente" ahora maneja el error de pago (los handlers de App relanzan errores) mostrando un mensaje en vez de fallar en silencio. Sin rediseño. |
| **App shell** (`src/App.tsx`) | Carga `account-summary` y `revenue-report`; expone `onFetchAccountState`; `handlePayInvoice` acepta monto parcial; los handlers de billing **relanzan** errores. |

No se tocó MikroTik, Tickets, Inventory ni GIS. No se crearon migraciones. No se modificó `USE_DB_BILLING`.

## 2. Flujos UI implementados

- **Listar facturas** — desde `GET /api/billing/invoices` (ya existía; ahora muestra saldo/parciales y badge `canceled`).
- **Crear factura** — modal → `POST /api/billing/invoices` → refresco + toast de éxito/error.
- **Registrar pago total** — monto vacío = liquidar saldo completo.
- **Registrar pago parcial** — campo de monto; se envía `amount` al backend; valida sobrepago en cliente (clamp + aviso) y el backend revalida.
- **Editar factura** — modal con confirmación → `PUT /api/billing/invoices/:id`.
- **Cancelar factura** — confirmación → `PUT /api/billing/invoices/:id` con `status: 'canceled'` (usa contrato existente, sin endpoint nuevo).
- **Estado de cuenta por factura** — al seleccionar factura se consulta `GET /api/billing/invoices/:id/account-state`: total, pagado, pendiente, vencimiento, pagos aplicados (monto, método, fecha, `transactionId`, saldo restante por pago).
- **Resumen de cobranza** — KPIs del header desde `GET /api/billing/account-summary` (total facturado, cobrado, pendiente, pagadas, pendientes, vencidas), con fallback al cálculo en cliente mientras carga.
- **Reporte de ingresos** — panel conmutable desde `GET /api/billing/revenue-report`: ingresos por método y top facturas pendientes (deudores).
- **Refresco tras mutación** — cada mutación dispara `fetchData()` y recarga el estado de cuenta de la factura abierta.

### Estados UX añadidos (Task 6)
Cargando facturas (estado vacío/placeholder), cargando estado de cuenta, registrando pago, creando factura, editando, error de pago/creación/edición, pago exitoso, factura creada/actualizada, datos actualizados (toasts), y "sin facturas". Confirmaciones para registrar pago, editar y cancelar.

## 3. Endpoints usados

| Endpoint | Método | Uso en UI |
|---|---|---|
| `/api/billing/invoices` | GET | Listado (App.fetchData). |
| `/api/billing/invoices` | POST | Crear factura. |
| `/api/billing/invoices/:id/pay` | POST | Pago total (`{method}`) o parcial (`{method, amount}`). |
| `/api/billing/invoices/:id` | PUT | Editar / cancelar (`status`). |
| `/api/billing/invoices/:id/account-state` | GET | Estado de cuenta por factura. |
| `/api/billing/account-summary` | GET | KPIs de resumen. |
| `/api/billing/revenue-report` | GET | Reporte de ingresos. |

Contrato API v1 **sin cambios** (las pruebas de contrato siguen verdes).

## 4. RBAC visual (Task 7)

Helper `src/lib/billingRbac.ts → canManageBilling(role)`, espejo de `WRITE_ROLES` del backend.

| Rol | Crear / Pagar / Editar / Cancelar | Botones visibles |
|---|---|---|
| Super Admin | ✅ | Todos |
| Administrador | ✅ | Todos |
| Cobranza | ✅ | Todos |
| Técnico | ❌ | Solo lectura (oculta acciones, muestra "Modo solo lectura") |
| Soporte | ❌ | Solo lectura |
| Solo lectura | ❌ | Solo lectura |

El backend ya protege con 403; esto solo evita mostrar acciones inválidas.

## 5. Archivos modificados / creados

**Creados**
- `docs/BILLING_UI_AUDIT.md`
- `docs/BILLING_4_3_UI_RESULT.md`
- `src/lib/billingRbac.ts`
- `src/lib/billingView.ts`
- `tests/unit/billing.view.test.ts`

**Modificados**
- `src/types.ts` — `Invoice.paidAmount?` / `pendingAmount?` + tipos `InvoiceAllocation`, `AccountStateResponse`, `BillingAccountSummary`, `BillingRevenueReport`.
- `src/App.tsx` — estado de resumen/reporte, fetch de los dos endpoints, `handlePayInvoice(amount?)`, `fetchAccountState`, propagación de errores, props nuevas a `BillingModule`.
- `src/components/BillingModule.tsx` — reescritura de la UI conectada.
- `src/components/FinanceOwnerModule.tsx` — manejo de error en pago de portal.

## 6. Resultado de validación local

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ sin errores |
| `npm test` | ✅ 152 passed / 32 skipped (incl. 25 nuevos de `billing.view`) |
| `npm run build` | ✅ build de Vite + esbuild correcto |

## 7. Cómo probar local

1. `npm install` (si es la primera vez).
2. Backend en memoria (mock): `npm run dev` y abrir la app; iniciar sesión con un rol de escritura (Super Admin / Cobranza).
3. En el tab **Facturación & Cobros**:
   - Crear una factura → aparece en la lista con badge "Pendiente".
   - Seleccionarla → ver estado de cuenta (pagado/pendiente).
   - Registrar un **pago parcial** (ej. la mitad) → badge cambia a "Pago Parcial", saldo se actualiza, aparece el pago aplicado con `transactionId`.
   - Registrar el resto (monto vacío) → badge "Pagada".
   - Botón "Ver Reporte de Ingresos" → ingresos por método y top deudores.
   - Editar y cancelar piden confirmación.
4. Iniciar sesión como **Solo lectura**: en Billing no aparecen botones de crear/pagar/editar/cancelar (solo consulta).
5. Pruebas unitarias de la lógica: `npm test` (suite `billing.view`).

## 8. Cómo validar en staging con Hermes

Pre-requisito: `USE_DB_BILLING=true` y Supabase configurado en staging (ya validado en Fase 4.2).

Pasos sugeridos para Hermes:

1. **Login** con un usuario de rol **Cobranza** (escritura) y otro **Solo lectura**.
2. **Listado**: `GET /api/billing/invoices` debe poblar la lista; los KPIs del header deben coincidir con `GET /api/billing/account-summary`.
3. **Crear factura** desde la UI → verificar persistencia en Supabase (tabla `invoices`) y que reaparece tras refrescar (F5).
4. **Pago parcial**: registrar un abono menor al total → badge "Pago Parcial"; `GET /api/billing/invoices/:id/account-state` debe mostrar la asignación con `remainingAfterPayment` correcto; persiste tras reinicio del servicio.
5. **Pago restante**: liquidar → status `paid`, `cfdiUuid` generado.
6. **Editar / Cancelar**: confirmar que el `PUT` se refleja en DB.
7. **Reporte de ingresos**: `GET /api/billing/revenue-report` → ingresos por método y top deudores consistentes con los pagos.
8. **RBAC visual**: con rol de lectura, los botones de acción no se muestran; con rol de escritura sí. El backend debe responder 403 si se fuerza una escritura con rol de lectura.

Criterio de aceptación: las cifras de la UI coinciden con las respuestas de los endpoints, los pagos parciales/totales persisten tras reinicio, y la visibilidad de botones respeta el rol.

## 9. Riesgos

- **Divergencia de KPIs**: si `account-summary` tarda, la UI usa el cálculo local (fallback) hasta que llega el valor canónico. Tras el primer fetch manda el backend.
- **Firma `onPayInvoice`**: se extendió con `amount?` opcional; `FinanceOwnerModule` sigue llamando `(id, method)` sin cambios. Verificado por typecheck.
- **Pasarelas simuladas**: Stripe/OXXO/SPEI son selección de método, **no** pago en línea (fuera de alcance). El cobro se persiste igual.
- **Tests sin DOM**: la lógica se probó como helpers puros (`billing.view`), no como render de componentes (no se añadió jsdom/@testing-library para no alterar la config de Vitest ni el contrato de `npm test`). Cobertura funcional, no visual.
- **CFDI**: el `cfdiUuid` es simulado por el backend al liquidar; no es timbrado real (fuera de alcance).

No se avanza a Fase 4.4.
