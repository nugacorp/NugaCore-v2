# PROD-4 — CHR Real Read-Only Integration — Result

> Implementación **local** (pendiente de validación Hermes en staging).
> **PREPARADO, NO CONECTADO.** Esta fase agrega la abstracción de providers para
> soportar un provider RouterOS real, pero **no conecta ningún CHR ni RB5009**,
> no activa worker live, no activa MikroTik DB runtime y no escribe nada.
> Comportamiento por defecto idéntico a PROD-3 (mock). Fecha: 2026-06-21.

## 1. Qué se implementó

Se introdujo una **abstracción de providers** en el dominio RouterOS Read-Only
para que la misma API/UI pueda servirse desde:

- `mock` → datos estables en memoria (PROD-3, default).
- `routeros` → CHR de lab vía API read-only (PROD-4, **preparado, no conectado**).

El contrato del provider pasó a ser **asíncrono** (necesario para I/O real) y el
campo `source` se amplió a `'mock' | 'routeros'` para reflejar qué provider sirvió
cada lectura. Los endpoints, RBAC, payloads y UI **no cambian**.

## 2. Arquitectura de providers

`backend/domains/routeros-readonly/providers/`:

- `provider-interface.ts` — contrato async común `RouterOsReadOnlyProvider`
  (`fetchIdentity/Resource/Interfaces/Routes/WireguardInterfaces/WireguardPeers`)
  + `RouterOsReadOnlyClient` (transporte de bajo nivel con **un solo método:
  `print`**; incapaz de escribir).
- `mock-provider.ts` — provider mock async (datos estables + `MOCK_ROUTER_ID`).
  Es además el **fallback** seguro.
- `routeros-provider.ts` — provider RouterOS real construido sobre un
  `RouterOsReadOnlyClient` **inyectable**. Usa una **allowlist** de comandos
  `print` y aplica timeout. Por defecto se construye con un cliente **no
  configurado** que falla siempre (sin credenciales, sin conexión real).
- `fallback.ts` — `readWithFallback(primary, fallback, read)`: intenta el
  primario y, ante cualquier fallo, cae al mock devolviendo el `source` efectivo.
- `index.ts` — `resolveProvider(env)` según el feature flag.

`service.ts` quedó async (`createRouterOsReadOnlyService(primary, fallback)`),
con default = provider resuelto por flag + fallback mock. `routes.ts` hace
`await` de cada getter; el contrato HTTP es idéntico.

Allowlist read-only (única ruta de comandos posibles):

```
/system/identity/print
/system/resource/print
/interface/print
/ip/route/print
/interface/wireguard/print
/interface/wireguard/peers/print
```

Cualquier comando fuera de la allowlist se rechaza **antes** de enviarse
(`ROUTEROS_COMMAND_NOT_ALLOWED`).

## 3. Feature flags

| Variable | Valores | Default | Efecto |
|---|---|---|---|
| `ROUTEROS_READONLY_PROVIDER` | `mock` \| `routeros` | `mock` | Selecciona el provider primario. Valor ausente o desconocido → `mock`. |

Con `routeros`, el provider se construye **sin cliente real** (no configurado), por
lo que cada lectura falla y cae a mock vía fallback: el comportamiento observable
sigue siendo el de PROD-3 hasta que una fase posterior (gated) inyecte un cliente
real con credenciales de lab.

Timeout configurable por construcción del provider (`timeoutMs`, default 4000 ms).

## 4. Fallback seguro

Ante **timeout, error de autenticación, host inalcanzable o cliente no
configurado**, el sistema:

- registra un `warn` **sin secretos** (solo `source` y un `reason` = `code`/`name`
  del error; nunca el mensaje crudo, host ni credenciales),
- cae automáticamente al provider mock,
- sigue respondiendo **200** con `source: 'mock'`,
- nunca rompe la UI.

Si primario y fallback comparten `source`, el error se re-lanza (evita bucles).

## 5. Seguridad

- El transporte (`RouterOsReadOnlyClient`) solo expone `print`: no hay
  `add/set/remove/execute`.
- Allowlist estricta de comandos `print`.
- Prueba de **seguridad estática** que escanea el dominio (incluido
  `providers/routeros-provider.ts`) y falla si aparece cualquier token de
  escritura (`.add(`, `.set(`, `.remove(`, `.execute(`, `/ip firewall add`,
  `/ip route add`, `/queue simple add`, `/ppp secret add`, `/interface add`,
  `/tool fetch`).
- Rutas del dominio: solo `GET` (sin `router.post/put/patch/delete`).
- Logs de fallback sin secretos.

## 6. Tests (`routeros.readonly.*`)

- `tests/contract/routeros.readonly.contract.test.ts`: 5 endpoints GET, RBAC,
  Cobranza 403, payload estable, write→404/403/405, sin secretos.
- `tests/unit/routeros.readonly.service.test.ts`: service async + mappers.
- `tests/unit/routeros.readonly.ui.test.ts`: badge, banner, secciones, sin
  escritura, integración App/Sidebar/RBAC.
- `tests/unit/routeros.readonly.providers.test.ts`: feature flag (mock/routeros/
  desconocido), mock provider, routeros provider (source=routeros, allowlist,
  timeout, no configurado), `readWithFallback` (auth/unreachable/timeout →
  source=mock; re-lanza si mismo source), service con providers inyectados
  (source=routeros y fallback a mock).
- `tests/unit/routeros.readonly.security.test.ts`: tokens de escritura
  prohibidos en todo el dominio + específicamente en `routeros-provider`, y rutas
  solo-GET.

## 7. Validación local

- `npm run typecheck`: PASS.
- `npm test`: PASS.
- `npm run build`: PASS.

## 8. Restricciones respetadas

- Sin activar `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE`,
  `MIKROTIK_COMMIT_MODE`, `MIKROTIK_WRITE_ENABLED`.
- Sin conectar CHR real, sin RB5009, sin torres reales, sin clientes reales.
- Sin escritura/provisioning/execute/commit RouterOS.
- Sin endpoints POST/PUT/PATCH/DELETE en el dominio.
- Comportamiento por defecto sin cambios (mock).

## 9. Limitaciones (de esta fase)

- El provider `routeros` está **preparado pero no conectado**: no hay cliente
  real, credenciales ni transporte de red implementado.
- Con el flag en `routeros`, todo cae a mock por fallback (esperado).
- No alimenta NOC/telemetría con datos reales (sigue detrás de gates apagados).

## 10. Qué debe validar Hermes

1. `npm run typecheck`, `npm test`, `npm run build` en staging → PASS.
2. Sin flag (o `ROUTEROS_READONLY_PROVIDER=mock`): los 5 endpoints responden 200
   con `source=mock`, payload estable (comportamiento PROD-3 intacto).
3. Con `ROUTEROS_READONLY_PROVIDER=routeros` (sin cliente real): los 5 endpoints
   siguen respondiendo 200 con `source=mock` por fallback; en logs aparece el
   `warn` de fallback **sin secretos**.
4. RBAC: 5 roles permitidos = 200; Cobranza = 403.
5. `POST/PUT/PATCH/DELETE` sobre `/api/routeros/*` = 404/403/405.
6. Respuestas y logs sin secretos / claves privadas / preshared keys.
7. Flags peligrosos (`USE_DB_MIKROTIK`/`USE_DB_WIREGUARD`/`MIKROTIK_WORKER_LIVE`/
   commit/write) sin activar.

## 11. Qué falta para conectar el CHR real (fase posterior, gated)

- Implementar un `RouterOsReadOnlyClient` real (API-SSL `8729` preferido) que
  ejecute solo `print` de la allowlist.
- Credenciales de lab fuera del repo (variables de entorno / gestor de secretos).
- Sanitización de salida cruda antes de loguear/persistir.
- Validación en CHR de lab aislado (ver `docs/CHR_LAB_PREP_RUNBOOK.md` y
  `docs/ROUTEROS_READ_ONLY_API_PLAN.md`).
- Aprobación explícita de Hermes/Ramiro antes de habilitar `routeros` con cliente
  real. Nunca contra RB5009/producción en esta etapa.

## 12. Siguiente fase

**PROD-5 — Safe Command Queue Dry-Run sobre CHR** (TODO, gated). Requiere primero
conectar el provider `routeros` real contra el CHR de lab (read-only validado por
Hermes) y mantener todos los gates de escritura apagados.
