# Billing 4.3 — Validación staging Billing UI

Fecha UTC: 2026-06-04T18:26:40+00:00

URL staging: https://nugacore-staging.5.180.151.109.sslip.io

Commit esperado/validado: `dd72239 feat(billing): connect billing UI to persistent backend`

Contenedor staging: imagen del commit `dd72239`, estado healthy.

## Alcance y restricciones

- No se modificó código fuente.
- No se tocó frontend, MikroTik, Tickets, Inventory ni GIS.
- No se avanzó a Fase 4.4.
- No se imprimieron ni documentaron passwords, JWTs ni secrets.
- Los datos de prueba creados fueron eliminados al final.
- La validación combinó navegador, API autenticada real, lectura de wiring UI y verificación directa en DB para limpieza.

## Git / deploy

Últimos commits:

```text
dd72239 feat(billing): connect billing UI to persistent backend
e22dcfe docs(billing): add billing persistence staging validation
84fa25f feat(billing): add persistence layer behind USE_DB_BILLING flag (Fase 4.2)
6393172 docs(billing): update 4.1 result with staging validation
1341aa3 feat(billing): add financial schema migrations (Fase 4.1)
```

Evidencia de despliegue:

```text
zmjc5lnl0wj3kh0uj14s2p4i:dd722390ca360c6855cbfe4adb2f1db0a85d9953 Up 4 minutes (healthy)
```

Coolify no había redeployado automáticamente desde el commit previo; se disparó redeploy y se confirmó contenedor healthy con imagen `dd72239`.

## Healthchecks

| Endpoint | Resultado |
|---|---|
| `/api/health` | PASS HTTP 200; `persistence=mixed`; `domainsOnDb=[customers, plans, billing]` |
| `/api/health/live` | PASS HTTP 200 |
| `/api/health/ready` | PASS HTTP 200 |

Flags esperados confirmados por comportamiento y healthcheck:

- `USE_DB_CUSTOMERS=true`
- `USE_DB_PLANS=true`
- `USE_DB_BILLING=true`

## Navegador / app

- La app cargó tras forzar cache-bust con `?v=dd72239`.
- Se observó login con banner `Conexión Real Supabase Activa`.
- Se verificó que el bundle actual ya no corresponde al asset cacheado anterior.
- Captura de referencia del navegador: `/root/.hermes/cache/screenshots/browser_screenshot_6dbf80b0da574bc59faab2c5100b6fb2.png`.

Observación importante:

- Los botones rápidos del login siguen mostrando/llenando correos demo `@nugacorp.com`, no los usuarios staging `@staging.nugacore.local`.
- Esos accesos rápidos fallaron con `Invalid login credentials`.
- Además, el código del login contiene una contraseña hardcodeada para autofill. No se reproduce aquí el valor por higiene de secretos.

Esto no bloqueó la validación API real con usuarios staging, pero sí es un riesgo/bug de UI y secret hygiene.

## Usuarios autenticados reales

| Persona | Email | Rol desde `/api/auth/me` | Source | Resultado |
|---|---|---|---|---|
| Cobranza | `billing@staging.nugacore.local` | `cobranza` | `supabase-jwt` | PASS |
| Solo lectura | `readonly@staging.nugacore.local` | `solo lectura` | `supabase-jwt` | PASS |
| Administrador | `admin@staging.nugacore.local` | `administrador` | `supabase-jwt` | PASS |
| Super Admin | `superadmin@staging.nugacore.local` | `super admin` | `supabase-jwt` | PASS |

## Wiring UI Billing -> backend persistente

Verificado en código desplegado:

- Billing UI usa `GET /api/billing/invoices` para lista.
- KPIs/resumen usan `GET /api/billing/account-summary`.
- Detalle usa `GET /api/billing/invoices/:id/account-state`.
- Crear factura usa `POST /api/billing/invoices`.
- Registrar pago usa `POST /api/billing/invoices/:id/pay`.
- Editar/cancelar usa `PUT /api/billing/invoices/:id`.
- Reporte usa `GET /api/billing/revenue-report`.
- Botones de escritura están protegidos visualmente por `canManageBilling(userRole)`.

## Cobranza — flujo principal

Usuario: `billing@staging.nugacore.local`.

| Validación | Resultado |
|---|---|
| Billing visible por rol | PASS por RBAC y API auth real |
| KPIs cargan desde backend | PASS |
| KPIs coinciden con `/api/billing/account-summary` | PASS: `totalInvoiced=299`, `totalCollected=299`, `totalPending=0`, `invoicesCount=1` durante la prueba |
| Lista de facturas carga | PASS HTTP 200 |
| Crear factura cliente `c-1`, monto `299` | PASS HTTP 201 |
| Factura aparece en lista | PASS: `True` |
| Persiste en API/DB | PASS |
| Refresh / recarga conserva datos | PASS por backend persistente y validación tras reinicio |

Factura de prueba principal:

| Campo | Resultado |
|---|---|
| ID | `fac-101` |
| Monto | 299 |
| Status inicial | `unpaid` |
| Pending inicial | 299 |
| CFDI inicial | `None` |

## Pago parcial

| Campo | Resultado |
|---|---|
| HTTP | 200 |
| Monto pagado | 100 |
| Status factura | `unpaid` |
| Paid amount | 100 |
| Pending amount | 199 |
| remainingAfterPayment | 199 |
| Allocations | 1 |
| Badge esperado UI | `Pago Parcial` / estado parcial equivalente |

## Pago completo

| Campo | Resultado |
|---|---|
| HTTP | 200 |
| Status factura | `paid` |
| Paid amount | 299 |
| Pending amount | 0 |
| Allocations | 2 |
| CFDI UUID generado | `4F17A9B9-2772-4EF2-BD44-FFBBAA12377` |

## Editar / cancelar factura

La UI sí muestra acciones `Editar` y `Cancelar` para roles con escritura cuando la factura es pagable.

Validación API con factura temporal adicional:

| Acción | Resultado |
|---|---|
| Crear factura temporal | PASS HTTP 201 |
| Editar monto y vencimiento | PASS HTTP 200 |
| Cancelar vía `status=canceled` | PASS HTTP 200 |
| Limpieza posterior | PASS; factura temporal eliminada |

## Reporte de ingresos

Desde wiring UI:

- Botón: `Ver Reporte de Ingresos`.
- Panel: `Reporte de Ingresos`.
- Secciones: `Ingresos por Método`, `Top Facturas Pendientes`.

Comparación API:

| Endpoint | Resultado |
|---|---|
| `GET /api/billing/revenue-report` | PASS HTTP 200 |
| `byMethod` | PASS; contiene `Transferencia: 299` durante la prueba |
| `topPendingInvoices` | PASS; arreglo válido, vacío después de pagar completo |

## Solo lectura — RBAC visual y API

Usuario: `readonly@staging.nugacore.local`.

| Validación | Resultado |
|---|---|
| Puede ver lista de facturas | PASS HTTP 200 |
| Puede ver resumen | PASS HTTP 200 |
| Puede ver reporte | PASS HTTP 200 |
| Crear factura forzado por API | PASS bloqueado HTTP 403 |
| Registrar pago forzado por API | PASS bloqueado HTTP 403 |
| Editar forzado por API | PASS bloqueado HTTP 403 |
| Botones crear/pagar/editar/cancelar | PASS por gating visual `canManageBilling=false` |

## Admin / Super Admin rápido

| Persona | Crear factura | Registrar pago | Limpieza |
|---|---:|---:|---|
| Administrador | HTTP 201 | HTTP 200 | PASS |
| Super Admin | HTTP 201 | HTTP 200 | PASS |

## Persistencia tras reinicio

Se reinició el contenedor de aplicación con la factura principal aún existente y pagada.

| Validación | Resultado |
|---|---|
| Health tras reinicio | HTTP 200 |
| `GET account-state` tras reinicio | HTTP 200 |
| Status factura | `paid` |
| Allocations | 2 |

Resultado: PASS, la factura y pagos persistieron tras reinicio.

## Limpieza

Se eliminaron únicamente las facturas/pagos de prueba creados en esta validación.

| Artefacto | Antes | Después |
|---|---:|---:|
| Factura principal `fac-101` | 1 | 0 |
| Items factura principal | 1 | 0 |
| Aplicaciones pago principal | 2 | 0 |
| Pagos vinculados principal | 2 | 0 |
| Factura admin `fac-102` | 1 | 0 |
| Factura superadmin `fac-103` | 1 | 0 |

Conteos finales:

| Tabla | Conteo |
|---|---:|
| clients | 3 |
| plans | 5 |
| invoices | 0 |
| payments | 0 |
| payment_applications | 0 |
| service_subscriptions | 1 |

## Errores encontrados

1. `FAIL` — accesos rápidos del login usan correos demo `@nugacorp.com`, no los usuarios staging reales `@staging.nugacore.local`; el intento con Cobranza demo mostró `Invalid login credentials`.
2. `FAIL` — el formulario de login contiene una contraseña hardcodeada para autofill. No se incluye el valor en este documento.
3. `WARN` — el primer acceso del navegador recibió un `index.html` cacheado que apuntaba a un asset JS anterior; con `?v=dd72239` cargó correctamente el bundle nuevo.
4. `WARN` — la validación de UI interactiva con contraseña real no se hizo escribiendo el secreto en el navegador para cumplir la restricción de no imprimir passwords/JWT/secrets. La autenticación real se validó por API segura leyendo secretos desde archivo local sin imprimirlos.

## Riesgos restantes

- Los accesos rápidos del login pueden confundir pruebas de staging y operadores porque no usan los usuarios staging reales.
- El password hardcodeado en frontend/autofill es un riesgo de exposición y debe eliminarse antes de considerar la UI lista para entornos compartidos.
- El navegador puede quedar con HTML cacheado; conviene revisar headers/cache-busting del `index.html` o limpiar caches tras deploy.
- No se validó CFDI real, pasarela real de pagos ni suspensión automática.

## Resultado final

Resultado general: **FAIL por secret hygiene / login quick buttons**, aunque el backend persistente, endpoints de Billing, RBAC API y wiring de Billing UI contra backend persistente dieron PASS.

La Fase 4.3 no debería avanzar a 4.4 hasta corregir:

1. eliminar password hardcodeado/autofill del frontend;
2. actualizar o remover botones rápidos demo del login en staging;
3. revalidar UI con login real en navegador sin exponer secretos.

## Recomendación siguiente

Corregir los dos bugs de login/secret hygiene en una fase corta de hardening 4.3.x, redeployar, y repetir esta validación UI con credenciales reales mediante un mecanismo seguro que no exponga passwords ni JWTs en logs/transcript.
