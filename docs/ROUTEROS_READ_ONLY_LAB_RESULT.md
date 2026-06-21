# PROD-3 — RouterOS Read-Only Lab Foundation — Result

> Implementación **local** (pendiente de validación Hermes en staging).
> Estrictamente READ-ONLY y en modo **mock**: sin conexión real, sin RouterOS
> real, sin worker live, sin commit mode, sin escritura, sin DB/migraciones,
> sin tocar routers reales. Fecha: 2026-06-21.

## 1. Qué se implementó

NugaCore ahora sabe **representar** datos RouterOS de laboratorio en modo mock,
detrás de RBAC y sin ninguna capacidad de escritura. Es la base segura previa a
PROD-4 (CHR real read-only), que queda como TODO gated.

- Dominio backend `backend/domains/routeros-readonly/` sobre un provider mock
  estable en memoria.
- 5 endpoints **solo GET** bajo `/api/routeros/*`.
- Módulo frontend read-only `RouterOS Read-Only Lab` (badge `READ ONLY LAB`).
- Prueba de seguridad estática que hace al dominio **físicamente incapaz de
  escribir** (falla si aparece cualquier token de escritura RouterOS).

## 2. Endpoints

Todos `GET`. No existen `POST/PUT/PATCH/DELETE` (devuelven 404).

| Endpoint | Comando RouterOS equivalente (futuro) | Devuelve |
|---|---|---|
| `GET /api/routeros/identity` | `/system identity print` | name, routerId, source=`mock`, readOnly=true |
| `GET /api/routeros/system` | `/system resource print` | versión, uptime, cpuLoad, memoryTotal/Free, board, arch, source=`mock` |
| `GET /api/routeros/interfaces` | `/interface print` | array: name, type, running, disabled, mtu, macAddress?, rxBytes, txBytes |
| `GET /api/routeros/routes` | `/ip route print` | array: dstAddress, gateway, distance, active, routingTable |
| `GET /api/routeros/wireguard` | `/interface wireguard print` | interfaces[], peers[], source=`mock` |

En esta fase **no se ejecuta ningún comando**: los datos provienen del provider
mock. Los nombres de comando arriba describen el mapeo previsto para PROD-4.

## 3. Provider mock

- `backend/domains/routeros-readonly/mock-provider.ts` entrega filas "crudas"
  (estilo `print`) ESTABLES, en memoria, sin red ni conexión.
- `mappers.ts` normaliza esas filas al modelo de dominio camelCase. Así el
  camino de parseo queda listo para PROD-4 (CHR real) **sin cambiar contratos**.
- `service.ts` orquesta lectura: pide al provider y normaliza. Ningún método
  abre conexiones, ejecuta RouterOS ni escribe.

La salida **no incluye secretos**: sin claves privadas, sin preshared keys, sin
passwords. Los peers WireGuard exponen solo metadatos no sensibles
(allowedAddress, endpoint, last-handshake, rx/tx, enabled).

## 4. RBAC

| Rol | Acceso |
|---|---|
| Super Admin | permitido |
| Administrador | permitido |
| Técnico | permitido |
| Soporte | permitido |
| Solo lectura | permitido |
| Cobranza | **403** |

Mismo criterio que el resto de módulos SAFE/read-only. El backend devuelve 403 a
Cobranza aunque el frontend ya oculta el módulo.

## 5. UI

- `src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx`.
- Nombre visible: **RouterOS Read-Only Lab**. Badge: **READ ONLY LAB**.
- Banner obligatorio: **"Esta vista no ejecuta cambios ni comandos RouterOS."**
- Muestra: identidad, sistema, CPU, RAM, interfaces, rutas, WireGuard summary,
  más estados seguros de vacío y error.
- **Sin** botones de escritura, **sin** acción de ejecución (`execute`).
- Cableado en `src/App.tsx`, `src/components/Sidebar.tsx` y `src/lib/rbac.ts`
  (tab `routeros-readonly`, visible para los 5 roles, Cobranza oculto).

## 6. Tests

- `tests/contract/routeros-readonly.contract.test.ts` (14): los 5 endpoints GET,
  payloads estables, ausencia de secretos, RBAC 5 roles, Cobranza 403, métodos de
  escritura → 404/403/405.
- `tests/unit/routeros-readonly.service.test.ts` (10): service + mappers
  (normalización de tipos, mac opcional, enabled derivado, sin claves).
- `tests/unit/routeros-readonly.ui.test.ts` (10): badge, banner, secciones,
  ausencia de `execute`/escritura, integración App/Sidebar/RBAC.
- `tests/unit/routeros-readonly.static-safety.test.ts` (11): escanea
  `backend/domains/routeros-readonly/**` y falla si aparece cualquier API,
  método o patrón de escritura RouterOS prohibido. La lista exacta vive en el
  test para evitar documentar scripts write completos en GitHub.

## 7. Validación local

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 80 test files passed.
  - 7 test files skipped.
  - 1279 tests passed.
  - 46 tests skipped.
- `npm run build`: PASS.

(Resultados completos en el reporte de la tarea; sin secretos en logs.)

## 8. Restricciones respetadas

- Sin activar `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE`,
  `MIKROTIK_COMMIT_MODE`, `MIKROTIK_WRITE_ENABLED`.
- Sin RouterOS real, sin routers reales, sin producción, sin provisioning real.
- Sin ejecutar comandos RouterOS, sin migraciones, sin borrar datos.
- Sin `git commit --amend`, sin `git push --force`.

## 9. Limitaciones (de esta fase)

- Datos **mock**: no reflejan ningún router real.
- No hay conectividad RouterOS ni allowlist de ejecución (eso es PROD-4).
- No alimenta todavía el NOC/telemetría con datos reales (sigue detrás del gate
  `MIKROTIK_WORKER_LIVE`, apagado).

## 10. Qué debe validar Hermes

1. `npm run typecheck`, `npm test`, `npm run build` en staging → PASS.
2. Los 5 endpoints GET responden 200 con payload estable y `source=mock`.
3. RBAC: 5 roles permitidos = 200; Cobranza = 403 en los 5 endpoints.
4. `POST/PUT/PATCH/DELETE` sobre `/api/routeros/*` = 404/403/405 (no escritura).
5. Respuestas y logs sin secretos / claves privadas / preshared keys.
6. UI: badge `READ ONLY LAB`, banner obligatorio, sin botones de escritura ni
   `execute`.
7. Flags `USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/commit mode
   sin activar.

## 11. Siguiente fase

**PROD-4 — CHR Real Read-Only Integration** (TODO, gated). Conexión solo lectura
a un MikroTik CHR de laboratorio con allowlist estricta de comandos `print`,
credenciales de lab fuera del repo y aprobación Hermes antes de ejecutar. Ver
`docs/ROUTEROS_READ_ONLY_API_PLAN.md` y `docs/CHR_LAB_PREP_RUNBOOK.md`.
