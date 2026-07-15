# RESULT — CHR ping WG OK pero UI offline (auth API)

Fecha: 2026-07-15  
Ambiente: staging

## Causa raíz

| Check | Resultado |
| --- | --- |
| WG handshake `10.70.0.2` | OK |
| Ping host/contenedor → CHR | OK |
| TCP `10.70.0.2:8728` | OPEN |
| Login API con user DB `nugacore_chr127711` | **FAIL** `invalid user name or password` |
| `chr1111` / `10.70.0.3` | Fantasma (`EHOSTUNREACH`) |

El ping al servidor WG (`10.70.0.1`) solo prueba el túnel. **Online en NugaCore/NOC** requiere lectura live RouterOS API con las credenciales guardadas en inventário.

## Limpieza hecha en staging

- Eliminado `mikrotik_routers` / enrollment de `mkt-2` (`chr1111`).
- Revocados peers WG huérfanos `10.70.0.3` y `10.70.0.4` (DB + `wg0`).
- Queda peer activo: `10.70.0.2` (`chr-12`).

## Fix de producto

- Botón **Reparar API** → descarga `nc-api.rsc` (solo usuario/grupo API; no toca WireGuard).
- **Verificar** reporta TCP/auth y hint operativo.
- Inventario/NOC releen Supabase en cada GET (evita fantasmas en memoria).

## Acción del operador (CHR)

1. Staging → **Sistema → Routers** → `chr-12` → **Reparar API**.
2. En MikroTik: `/import file-name=nc-api.rsc`
3. **Verificar** → debe quedar `online` / `connected` y alimentar el NOC.
