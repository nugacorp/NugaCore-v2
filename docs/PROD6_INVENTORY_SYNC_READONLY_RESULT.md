# PROD-6 — Inventory Sync Read-Only (resultado)

> Primer Inventory Sync de NugaCore: compara el inventario NugaCore contra un
> snapshot **READ-ONLY** de RouterOS y reporta diferencias. **Solo lectura.**
>
> NO RouterOS Write, NO Worker Live, NO suspensión automática, NO provisioning,
> NO Safe Command Queue Execute, NO Inventory Write, NO cambios en routers, NO
> MikroTik DB Runtime, NO WireGuard Runtime. No se tocó producción ni routers
> reales.
>
> Última actualización: 2026-06-23. Rama: `main`.

## Objetivo

Comparar **NugaCore Inventory** vs **RouterOS Read-Only Data** y detectar
diferencias, sin modificar nada.

## Arquitectura (FASE A/B/C)

```text
GET /api/inventory-sync/{status|snapshot|differences}
      │
      ▼
  inventory-sync/service.ts
      ├─ getNugaInventory()           → inventario esperado (read-only, en memoria)
      ├─ buildRouterOsSnapshot()      → snapshot RouterOS read-only
      │      └─ routerOsReadOnlyService (mock | routeros, con fallback seguro)
      └─ compareInventory()           → diferencias (comparador puro)
```

Dominio `backend/domains/inventory-sync/`:

- `types.ts` — contratos (tipos de diferencia, snapshot, respuestas).
- `nuga-inventory.ts` — inventario esperado por NugaCore (read-only, en memoria).
- `snapshot.ts` — arma el snapshot normalizado desde el RouterOS Read-Only
  Service (Identity, Interfaces, Routes, WireGuard). **Nada más.**
- `comparator.ts` — comparación pura (sin I/O).
- `service.ts` — orquesta status/snapshot/differences (inyectable para tests).
- `routes.ts` — 3 endpoints **GET** con RBAC.

## Snapshot read-only (FASE B)

El snapshot solo usa el RouterOS Read-Only Service: identidad, interfaces, rutas
y peers WireGuard (solo `allowed-address`, sin claves privadas ni preshared
keys). El `source` proviene de la identidad (mock o routeros, tras fallback).

## Comparador (FASE C)

Detecta, emparejando por `routerId`:

| Tipo | Significado |
| ---- | ----------- |
| `ROUTER_MISSING`         | NugaCore tiene el router pero RouterOS no devolvió identidad. |
| `INTERFACE_MISSING`      | NugaCore espera la interfaz; el router no la tiene. |
| `INTERFACE_EXTRA`        | El router tiene una interfaz que NugaCore no inventaría. |
| `ROUTE_MISSING`          | NugaCore espera la ruta (destino+gateway); el router no la tiene. |
| `ROUTE_EXTRA`            | El router tiene una ruta que NugaCore no inventaría. |
| `WIREGUARD_PEER_MISSING` | NugaCore espera el peer (allowed-address); el router no lo tiene. |
| `WIREGUARD_PEER_EXTRA`   | El router tiene un peer que NugaCore no inventaría. |

## Endpoints (FASE A)

- `GET /api/inventory-sync/status` — última sync, source, estado general
  (`IN_SYNC`/`OUT_OF_SYNC`), total y conteo por tipo.
- `GET /api/inventory-sync/snapshot` — inventario NugaCore + snapshot RouterOS.
- `GET /api/inventory-sync/differences` — lista de diferencias + total.

Solo `GET`. No hay POST/PUT/PATCH/DELETE.

## UI (FASE D)

`src/modules/inventory-sync/InventorySyncModule.tsx` (tab `inventory-sync`, grupo
**MikroTik** del sidebar):

- Resumen: **Última sincronización**, **Diferencias** (cantidad), **Estado general**.
- Tabla: **Tipo · Router · Elemento · Estado**.
- Badge **READ ONLY** + indicador **Fuente: MOCK | ROUTEROS**.
- Banner: **"Esta funcionalidad no modifica routers."**
- Sin botones de escritura/ejecución; solo lectura por `GET`.

## RBAC (FASE E)

Permitidos (200): Super Admin, Administrador, Técnico, Soporte, Solo lectura.
**Cobranza → 403** en los 3 endpoints. Frontend: `inventory-sync` visible para
esos 5 roles, oculto para Cobranza.

## Seguridad (FASE F)

- Test estático `tests/unit/routeros.inventory-sync.static-safety.test.ts`:
  escanea el dominio y falla si aparecen `.add(`, `.set(`, `.remove(`,
  `.execute(`, `.disable(`, `.enable(`, `/tool fetch`, `/ip firewall add`,
  `/ip route add`, `/queue simple add`, `/ppp secret add`, `/interface add`.
  Verifica además que el dominio solo registra rutas `GET` y que el snapshot solo
  lee del RouterOS Read-Only Service.
- Sin secretos en respuestas (WireGuard solo expone `allowed-address`).

## Fallback (FASE G)

Si RouterOS falla (timeout/auth/host inalcanzable), el RouterOS Read-Only Service
cae a mock: `source=mock`, la UI sigue funcionando y la API responde 200 (nunca
500, nunca crash).

## Tests (FASE H)

- Contract: `tests/contract/inventory-sync.contract.test.ts` (RBAC, GET-only,
  payloads, source=mock, sin secretos).
- Service: `tests/unit/inventory-sync.service.test.ts` (IN_SYNC/OUT_OF_SYNC,
  conteos, propagación de source).
- Comparator: `tests/unit/inventory-sync.comparator.test.ts` (cada tipo de
  diferencia, in-sync, ROUTER_MISSING).
- UI/RBAC: `tests/unit/inventory-sync.ui.test.ts`.
- Security: `tests/unit/routeros.inventory-sync.static-safety.test.ts`.
- Navegación/RBAC frontend actualizados (`navigation.ui`, `rbac.frontend`).

## Validación (FASE J)

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build` — PASS

## Qué debe validar Hermes

1. Los 3 endpoints `GET` responden con `source=mock` por defecto y RBAC correcto
   (5 roles 200, Cobranza 403).
2. Las diferencias se detectan (el inventario NugaCore difiere a propósito del
   router mock para demostrar cada tipo).
3. Write-protection: POST/PUT/PATCH/DELETE → 403/404/405.
4. UI Inventory Sync: badge READ ONLY, banner, tabla y indicador de Fuente.
5. Con `ROUTEROS_READONLY_PROVIDER=routeros` + CHR de lab, el snapshot y las
   diferencias se calculan contra datos reales (`source=routeros`) — runbook en
   `docs/PROD51_CHR_LAB_VALIDATION_RESULT.md`.

## Siguiente fase

Solo Inventory Sync Read-Only. No se implementó Worker Live, RouterOS Write,
Provisioning, suspensión automática, MikroTik DB Runtime ni WireGuard Runtime.
