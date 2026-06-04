# Billing 4.3.1 - Validacion final login hardening + Billing UI

Fecha: 2026-06-04T19:09Z
URL staging: https://nugacore-staging.5.180.151.109.sslip.io
Commit validado/desplegado: f70ba78 fix(auth): harden login, remove hardcoded creds and demo bypass, fix cache busting

## Alcance y restricciones

- No se modifico codigo fuente.
- No se avanzo a Fase 4.4.
- No se tocaron MikroTik, Suspensiones, Inventory ni Tickets.
- No se imprimieron passwords, JWTs, service-role keys ni secretos.
- Se crearon datos temporales unicamente via flujo Billing API para validar regresion y se limpiaron al final.

## 1. Deploy y healthchecks

Resultado: PASS

Evidencia:

- Repo staging actualizado por fast-forward a `main`.
- `git log --oneline -5` contiene `f70ba78` como HEAD.
- Coolify fue redeployado manualmente porque el contenedor previo seguia en `dd72239`.
- Contenedor nuevo healthy con imagen `zmjc5lnl0wj3kh0uj14s2p4i:f70ba78bcf8f69549256c49957e082d6746791dc`.
- Healthchecks:
  - `/api/health`: HTTP 200, `status=ok`, `persistence=mixed`, `domainsOnDb=[customers, plans, billing]`.
  - `/api/health/live`: HTTP 200.
  - `/api/health/ready`: HTTP 200.

## 2. Config staging

Resultado: FAIL parcial por variable build-time faltante

Runtime confirmado sin imprimir secretos:

| Variable | Resultado |
| --- | --- |
| `USE_DB_CUSTOMERS` | PASS, presente y `true` |
| `USE_DB_PLANS` | PASS, presente y `true` |
| `USE_DB_BILLING` | PASS, presente y `true` |
| `AUTH_TRUST_HEADERS` | PASS, presente y `false` |

Build-time confirmado sin imprimir secretos:

| Variable | Resultado |
| --- | --- |
| `VITE_SUPABASE_URL` | PASS, configurado y marcado build-time |
| `VITE_SUPABASE_ANON_KEY` | PASS, configurado y marcado build-time; es publica, no se imprimio completa |
| `VITE_ENABLE_QUICK_LOGIN` | FAIL, no esta presente en Coolify/envs y no se muestra el panel de quick login en login |

Impacto: el hardening de no-bypass funciona, pero no se puede aprobar el requisito de quick login seguro porque el feature flag esperado no esta habilitado en staging.

## 3. No-bypass login

Resultado: PASS

Validaciones:

- Landing publica carga correctamente.
- Boton `Demo Admin (1-Clic)` no entra directo al dashboard; lleva al login real.
- Tarjetas/instancias demo de landing no crean sesion mock; llevan al login real.
- Sin password correcto no se inicia sesion.
- Login invalido con usuario/password incorrectos permanece en login y muestra error controlado: `Invalid login credentials`.
- El codigo de landing documenta el cambio: los accesos rapidos enrutan a `onEnterLogin()` y no hacen bypass.

## 4. Quick login seguro

Resultado: FAIL

Validaciones:

- El bundle desplegado contiene los emails de staging esperados:
  - `billing@staging.nugacore.local`
  - `readonly@staging.nugacore.local`
- El bundle no contiene emails demo `@nugacorp.com`.
- El bundle no contiene la password demo historica.
- La pantalla de login desplegada no muestra el panel `Acceso Rapido Staging (solo email)` porque falta `VITE_ENABLE_QUICK_LOGIN=true` como build-time variable en staging.
- Por lo tanto no se pudo validar el flujo esperado de hacer clic en quick login -> rellenar email -> dejar password vacio -> login via Supabase tras escribir password real.

Conclusion: la implementacion de codigo parece preparada para quick login seguro, pero la configuracion de staging no cumple el requisito pedido.

## 5. Secret scan del bundle publicado

Resultado: PASS con nota

Asset activo desde HTML:

- `/assets/index-Ds5Rn4ZG.js`

Patrones revisados:

| Patron | Resultado |
| --- | --- |
| `nugacorp_secure_pwd2026` | 0 coincidencias |
| `@nugacorp.com` | 0 coincidencias |
| password staging real | 0 coincidencias |
| `service_role` | 0 coincidencias |
| `SUPABASE_SERVICE_ROLE_KEY` | 0 coincidencias |
| `MIKROTIK_CREDENTIALS_KEY` | 0 coincidencias |

Nota: el literal `Bearer ` aparece dentro de codigo de libreria/headers para construir Authorization, pero no hay token embebido ni bearer value. `VITE_SUPABASE_ANON_KEY` aparece como esperado por ser llave publica de cliente; no se imprimio completa.

## 6. Cache busting

Resultado: PASS

HTML:

- `curl -I /`: HTTP 200.
- `Cache-Control: no-cache, no-store, must-revalidate`.

Asset JS activo:

- `/assets/index-Ds5Rn4ZG.js`
- HTTP 200.
- `Cache-Control: public, max-age=31536000, immutable`.
- `Content-Type: application/javascript; charset=UTF-8`.

## 7. Billing sin regresion - Cobranza

Resultado: PASS

Usuario validado via Supabase/API:

- `billing@staging.nugacore.local`
- `/api/auth/me`: HTTP 200
- rol: `cobranza`
- source: `supabase-jwt`

Flujo validado:

| Paso | Resultado |
| --- | --- |
| Billing API visible/listable | PASS, HTTP 200 |
| KPIs/account-summary | PASS, HTTP 200 |
| Crear factura temporal `c-1` monto `299` | PASS, HTTP 201, factura `fac-101` |
| Factura aparece en lista | PASS |
| Pago parcial `100` | PASS, factura sigue `unpaid`, `paidAmount=100`, `pendingAmount=199`, `allocations=1` |
| Pago completo `199` | PASS, factura `paid`, `paidAmount=299`, `pendingAmount=0`, `allocations=2` |
| CFDI UUID generado | PASS |
| account-state | PASS, HTTP 200 |
| revenue-report | PASS, `byMethod` y `topPendingInvoices` presentes |
| Persistencia tras lectura fresca/F5 equivalente | PASS, factura seguia `paid` con 2 allocations antes de limpieza |

## 8. Billing sin regresion - Solo lectura/RBAC

Resultado: PASS backend; PASS visual por inspeccion de RBAC; no se completo UI quick-login por flag faltante

Usuario validado via Supabase/API:

- `readonly@staging.nugacore.local`
- `/api/auth/me`: HTTP 200
- rol: `solo lectura`
- source: `supabase-jwt`

Validaciones API:

| Accion | Resultado |
| --- | --- |
| Listar facturas | PASS, HTTP 200 |
| Ver revenue report | PASS, HTTP 200 |
| Crear factura forzado | PASS, HTTP 403 |
| Registrar pago forzado | PASS, HTTP 403 |
| Editar factura forzado | PASS, HTTP 403 |

Validacion visual por codigo desplegado:

- `canManageBilling()` solo permite `Super Admin`, `Administrador` y `Cobranza`.
- `BillingModule` renderiza crear/pagar/editar/cancelar bajo `canManage`.
- Por lo tanto `Solo lectura` no debe ver botones de crear/pagar/editar/cancelar.

## 9. Limpieza

Resultado: PASS

Datos temporales creados:

- invoice: `fac-101`
- invoice_items asociados
- payments asociados
- payment_applications asociadas

Limpieza ejecutada:

| Tabla | Antes para factura temporal | Despues para factura temporal |
| --- | ---: | ---: |
| `invoices` | 1 | 0 |
| `invoice_items` | 1 | 0 |
| `payment_applications` | 2 | 0 |
| `payments` | 2 | 0 |

Conteos finales de tablas relevantes:

| Tabla | Conteo final |
| --- | ---: |
| `clients` | 3 |
| `plans` | 5 |
| `invoices` | 0 |
| `payments` | 0 |
| `payment_applications` | 0 |
| `service_subscriptions` | 1 |

No quedaron datos de prueba activos.

## 10. Resultado final

Resultado final: NO APROBADA

Motivo:

- PASS en deploy, healthchecks, no-bypass login, secret scan, cache busting, Billing Cobranza, RBAC Solo lectura y limpieza.
- FAIL en requisito explicito de quick login seguro porque `VITE_ENABLE_QUICK_LOGIN=true` no esta configurado como build-time variable en staging; el panel de quick login no aparece y no se puede validar prefill de email/password vacio para `billing` y `readonly`.

## Recomendacion siguiente

No avanzar a Fase 4.4 todavia.

Corregir configuracion de Coolify/staging:

1. Agregar `VITE_ENABLE_QUICK_LOGIN=true` como build-time variable para la app staging.
2. Redeployar commit `f70ba78` o superior.
3. Repetir solo la validacion de quick login seguro y una smoke test Billing/RBAC corta.

Si el quick login seguro pasa despues de esa correccion, la Fase 4.3 puede aprobarse.
