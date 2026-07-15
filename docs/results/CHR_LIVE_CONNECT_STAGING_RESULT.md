# RESULT — Conexión web → CHR por WireGuard (lectura live)

Fecha: 2026-07-15  
Commit: `a0b54ad`  
Ambiente: staging

## Qué se activó

| Flag | Valor |
| --- | --- |
| `MIKROTIK_WORKER_LIVE` | `true` (solo lectura API) |
| `MIKROTIK_WORKER_COMMIT` | `false` (sin escrituras) |

## Diagnóstico previo

- Túnel WG host↔CHR (`10.70.0.2`): OK (ping + handshake).
- TCP `8728` desde host y desde contenedor app: abierto.
- Inventario `mkt-8` / enrollment `enr-mrld2nry-i320ng`: **sin password API** (`admin` + pass vacío) → el worker no podía hacer live aunque el flag estuviera ON.

## Fix en código

- `/download` regenera y persiste credenciales `nugacore_*` si faltan.
- Upsert de `mikrotik_routers` no pisa credenciales con vacío.
- Deploy staging deja `MIKROTIK_WORKER_LIVE=true`.

## Estado tras deploy

- `LIVE=true`, `COMMIT=false` confirmados en contenedor.
- Download enrollment → HTTP 200; inventario ahora con `nugacore_*` + password cifrado.
- `check-online` respondió `snapshotSource=simulated` con mensaje *live falló con fallback* → **esperado**: el CHR aún no tiene el user API nuevo (falta re-importar `.rsc`).

## Acción pendiente del operador (CHR)

En el CHR (consola Winbox/SSH del admin):

1. En NugaCore staging: **MikroTik → Routers → Dar de alta** (o lista de enrollments) → **descargar** de nuevo `nc-wg.rsc` del enrollment de `chr-12`.
2. Subir/importar en el router:
   ```
   /import file-name=nc-wg.rsc
   ```
3. En la web: **Verificar online** → debe quedar `snapshotSource=live`, enrollment `online`, inventario Online.

Sin ese import, la web ya tiene LIVE y credenciales en DB, pero el login API al CHR falla porque el usuario aún no existe en RouterOS.

## Guardrails

- No se activó commit/write.
- No se documentan passwords ni claves.
- Para apagar live en un deploy: `FORCE_MIKROTIK_WORKER_LIVE=false`.
