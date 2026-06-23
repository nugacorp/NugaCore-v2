# PROD-5.1 — CHR Lab Validation (datos reales read-only) — resultado

> Validación CONTROLADA del provider RouterOS read-only (PROD-4/PROD-5). Solo
> lectura (`print`). No se modificó RouterOS, no se ejecutó add/set/remove/
> disable/enable/execute/tool/fetch/import/export. No se avanzó a PROD-6,
> Inventory Sync, Worker Live ni RouterOS Write. No se tocó RB5009 de producción,
> torres reales ni clientes reales.
>
> Última actualización: 2026-06-23. Rama: `main`.

## Alcance y honestidad del entorno

Este entorno de desarrollo **no tiene un CHR de laboratorio físico accesible**
(sin host/credenciales de lab y sin ruta de red a un CHR). Por eso:

- El **mecanismo completo** (provider → service → mappers → fallback, allowlist,
  RBAC, write-protection, ausencia de secretos, UI) se validó de forma
  **hermética y reproducible** con un CHR **emulado a nivel de cliente** (filas
  crudas estilo `print`) y con un **socket real cerrado** para el fallback.
- La **observación final** `source=routeros` contra el CHR de lab **real** (con
  credenciales fuera del repo) la ejecuta Hermes con el **runbook** de la última
  sección. El software ya está listo para ello (flag + variables de entorno).

`CHR conectado a un dispositivo físico desde este entorno: NO (no disponible).`
`Mecanismo source=routeros validado de extremo a extremo (CHR emulado): SÍ.`

## FASE A — Auditoría del provider

`backend/domains/routeros-readonly/providers/`: `routeros-client.ts`,
`routeros-provider.ts`, `fallback.ts`, `provider-interface.ts`,
`mock-provider.ts`, `index.ts`.

- Allowlist (`READ_ONLY_COMMANDS`) contiene únicamente comandos `print`:
  `/system/identity/print`, `/system/resource/print`, `/interface/print`,
  `/ip/route/print`, `/interface/wireguard/print` (+ `/interface/wireguard/peers/print`
  para el detalle de peers del mismo recurso WireGuard).
- Búsqueda de verbos de escritura (`.add(`, `.set(`, `.remove(`, `.execute(`,
  `/tool fetch`, `/ip firewall add`, `/ip route add`) en el dominio (fuera de
  tests): **0 coincidencias**.
- El cliente real solo emite `GET` HTTP; la escritura REST requeriría
  POST/PUT/PATCH/DELETE, que nunca se usan.

Resultado FASE A: **PASS**.

## FASE B — Configuración (sin secretos en el repo)

Variables: `ROUTEROS_READONLY_PROVIDER`, `ROUTEROS_HOST`, `ROUTEROS_PORT`,
`ROUTEROS_USERNAME`, `ROUTEROS_PASSWORD`, `ROUTEROS_TIMEOUT_MS`
(+ `ROUTEROS_TLS_REJECT_UNAUTHORIZED`).

- No hardcodeadas: el cliente las lee de `process.env`.
- No en repo: `.env.example` / `.env.production.example` solo traen los **nombres**
  con valores **vacíos** (prod fijada en `mock`).
- No en tests: los tests usan **placeholders obvios** (`lab-readonly`,
  `placeholder-not-a-secret`), nunca credenciales reales.
- No en documentación: aquí solo se nombran las variables, sin valores.

Resultado FASE B: **PASS**.

## FASE C — CHR Lab

No se usó RB5009, producción ni torres reales. La activación de
`ROUTEROS_READONLY_PROVIDER=routeros` apunta **exclusivamente** a un CHR de lab
(ver runbook). En este repo el default permanece en `mock`.

## FASE D — Lectura real (source=routeros)

Validado de extremo a extremo con un CHR **emulado a nivel de cliente** (datos
distintos del mock para distinguir el origen), recorriendo el camino real
provider → service → mappers:

| Endpoint / getter        | Resultado                                             |
| ------------------------ | ----------------------------------------------------- |
| `GET /api/routeros/identity`   | `source=routeros`, `name=chr-lab-edge-real`     |
| `GET /api/routeros/system`     | `source=routeros`, versión RouterOS del CHR     |
| `GET /api/routeros/interfaces` | datos del CHR (`ether-chr-lab`), no del mock    |
| `GET /api/routeros/routes`     | datos del CHR (`gateway 203.0.113.1`), no mock  |
| `GET /api/routeros/wireguard`  | `source=routeros`, interfaz/peer del CHR        |

Cobertura: `tests/unit/routeros.lab-validation.test.ts` (FASE D) +
`tests/unit/routeros.provider.integration.test.ts`.

Resultado FASE D (mecanismo): **PASS**. Observación contra CHR físico: **pendiente
Hermes (runbook)**.

## FASE E — Fallback

- **Host inalcanzable real**: cliente real apuntado a un puerto de loopback
  **cerrado** (conexión rechazada determinista) → `source=mock`, sin 500, sin
  crash.
- **Auth failure** y **timeout** (clientes fake) → `source=mock`.
- La API siempre responde 200 y la UI nunca se rompe.

Cobertura: `routeros.lab-validation.test.ts` (FASE E),
`routeros.client.test.ts`, `routeros.provider.integration.test.ts`.

Resultado FASE E: **PASS**.

## FASE F — RBAC (JWT/headers)

`tests/contract/routeros.readonly.contract.test.ts`:

- Super Admin, Administrador, Técnico, Soporte, Solo lectura → **200** en los 5
  endpoints.
- Cobranza → **403** en los 5 endpoints.

Resultado FASE F: **PASS**.

## FASE G — Write protection

Para los 5 endpoints `/api/routeros/*`, los métodos `POST/PUT/PATCH/DELETE`
devuelven `403/404/405` (nunca `200`, nunca modificación). Solo hay rutas `GET`
registradas en el dominio.

Cobertura: `routeros.readonly.contract.test.ts` + `routeros.readonly.security.test.ts`.

Resultado FASE G: **PASS**.

## FASE H — Seguridad (sin secretos)

- Respuestas de los endpoints sin `password`, `token`, `jwt`, `private key` ni
  `preshared key` (el modelo WireGuard expone solo metadatos no sensibles).
- Logs seguros: `routeros_read_success` / `routeros_read_fallback` (evento +
  `source` + `code`); nunca credenciales. El cliente real no usa logger ni
  console (no puede filtrar secretos), y el `Authorization: Basic` solo viaja en
  la petición.

Cobertura: `routeros.lab-validation.test.ts` (FASE H) +
`routeros.readonly.contract.test.ts` + `routeros.provider.integration.test.ts`.

Resultado FASE H: **PASS**.

## FASE I — UI (Laboratorio MikroTik)

`src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx`:

- Badge **READ ONLY LAB** presente.
- Indicador **Fuente: MOCK | ROUTEROS** (derivado del `source` efectivo).
- Muestra Identidad, CPU & RAM, Sistema, Interfaces, Rutas y WireGuard.
- Sin botones de escritura: no hay `add/edit/delete/execute` ni `onClick` de
  acción; la vista solo carga datos read-only.

Resultado FASE I: **PASS**.

## FASE J — Checks

- `npm run typecheck` — **PASS**.
- `npm test` — **PASS** (1390 passed, 46 skipped opt-in DB/auth).
- `npm run build` — **PASS**.

## Runbook para Hermes — observación contra el CHR de lab real

Ejecutar en staging/lab, con credenciales **fuera del repo** (variables de
entorno o secrets del orquestador). No usar RB5009 ni routers de producción.

1. Definir variables (solo lab):
   - `ROUTEROS_READONLY_PROVIDER=routeros`
   - `ROUTEROS_HOST=<host del CHR de lab>`
   - `ROUTEROS_PORT=<443 u 8443 según el service www-ssl del CHR>`
   - `ROUTEROS_USERNAME=<usuario read-only del CHR>`
   - `ROUTEROS_PASSWORD=<password del CHR>` (nunca en el repo)
   - `ROUTEROS_TIMEOUT_MS=4000`
   - `ROUTEROS_TLS_REJECT_UNAUTHORIZED=false` (CHR lab self-signed) o `true` con CA propia.
   - Requisito en el CHR: REST API habilitada (`/ip service` → `www-ssl` activo) y
     un usuario con grupo de **solo lectura**.
2. Reiniciar el backend para tomar las variables.
3. Con un JWT válido (rol permitido), consultar y verificar `source=routeros`:
   - `GET /api/routeros/identity`
   - `GET /api/routeros/system`
   - `GET /api/routeros/interfaces`
   - `GET /api/routeros/routes`
   - `GET /api/routeros/wireguard`
4. Verificar en la UI (Laboratorio MikroTik) el indicador **Fuente: ROUTEROS** y
   los datos reales del CHR.
5. Prueba de fallback: detener el CHR o usar credenciales inválidas → los
   endpoints deben responder 200 con `source=mock` (sin 500).
6. Revisar logs: deben aparecer `routeros_read_success` / `routeros_read_fallback`
   sin secretos.
7. Al terminar, volver a `ROUTEROS_READONLY_PROVIDER=mock` salvo que se mantenga
   el lab.

## Resumen

| Fase | Resultado |
| ---- | --------- |
| A — Auditoría provider        | PASS |
| B — Config sin secretos       | PASS |
| C — CHR Lab (no producción)   | OK (default mock; flag apunta solo a lab) |
| D — source=routeros (mecanismo) | PASS (observación física pendiente Hermes) |
| E — Fallback a mock           | PASS |
| F — RBAC                      | PASS |
| G — Write protection          | PASS |
| H — Seguridad (sin secretos)  | PASS |
| I — UI                        | PASS |
| J — typecheck/test/build      | PASS |

No se avanzó a PROD-6, Inventory Sync, Worker Live ni RouterOS Write. No se tocó
producción ni routers reales.
