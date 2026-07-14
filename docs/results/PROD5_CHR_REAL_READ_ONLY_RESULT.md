# PROD-5 — CHR Real Read-Only Integration (resultado)

> Fase **exclusivamente READ-ONLY**. El RouterOS Read-Only Lab puede leer datos
> REALES desde un **CHR de laboratorio** (no producción) cuando se configura el
> flag y las credenciales; si algo falla, cae a mock sin romper la UI.
>
> NO escribe, NO ejecuta comandos, NO crea queues/peers, NO modifica interfaces/
> rutas/WireGuard/usuarios/firewall/address-lists. Solo `print` (GET REST).
>
> Última actualización: 2026-06-22. Rama: `main`.

## Objetivo

Reemplazar los datos mock por datos reales del CHR de laboratorio en el RouterOS
Read-Only Lab, manteniendo el fallback seguro a mock. Pasar de `source=mock` a
`source=routeros` contra un CHR de **lab** (nunca contra RB5009 de producción).

## Arquitectura

```text
GET /api/routeros/{identity|system|interfaces|routes|wireguard}
        │
        ▼
  service.ts ── readWithFallback(primary, mock) ──► mappers ──► JSON
        │
        ├─ primary = resolveProvider(env)
        │     ├─ flag=mock (default) ............................ provider mock
        │     └─ flag=routeros
        │           ├─ con ROUTEROS_HOST/USERNAME/PASSWORD ...... cliente REST REAL
        │           └─ sin credenciales ....................... cliente no configurado
        │
        └─ fallback = provider mock (siempre)
```

- `providers/routeros-client.ts` (**nuevo**): cliente REST read-only. Cada
  `print(command)` valida la allowlist, mapea el comando a su ruta REST de
  lectura y hace `GET` HTTPS con Basic Auth y timeout. Normaliza la respuesta a
  filas estilo `print` (Record<string,string>).
- `providers/routeros-provider.ts` (PROD-4, sin cambios de contrato): envuelve el
  cliente, aplica la allowlist y un timeout por lectura.
- `providers/index.ts` (`resolveProvider`): cablea el cliente real cuando el flag
  es `routeros` y hay credenciales; si no, usa el cliente no configurado → mock.
- `providers/fallback.ts`: fallback seguro + logs de evento (`routeros_read_success`,
  `routeros_read_fallback`) sin secretos.

## Allowlist estricta (solo lectura)

Únicamente se permiten estos comandos `print`, mapeados a su ruta REST de lectura
(`GET`). Cualquier otro comando lanza `RouterOsReadError('ROUTEROS_COMMAND_NOT_ALLOWED')`
**antes** de tocar la red y se registra el fallback:

| Comando (`print`)                     | Ruta REST (GET)                      |
| ------------------------------------- | ------------------------------------ |
| `/system/identity/print`              | `/rest/system/identity`              |
| `/system/resource/print`              | `/rest/system/resource`              |
| `/interface/print`                    | `/rest/interface`                    |
| `/ip/route/print`                     | `/rest/ip/route`                     |
| `/interface/wireguard/print`          | `/rest/interface/wireguard`          |
| `/interface/wireguard/peers/print`    | `/rest/interface/wireguard/peers`    |

Verbos PROHIBIDOS y nunca emitidos por el cliente: `add`, `set`, `remove`,
`disable`, `enable`, `execute`, `tool`, `fetch`, `import`, `export`, `write`. A
nivel HTTP el cliente **solo** usa `GET` (la escritura en REST requeriría
POST/PUT/PATCH/DELETE, que no se emiten). Un test estático falla si aparecen
`.add(`, `.set(`, `.remove(`, `.execute(`, `/ip firewall add`, `/ip route add`,
`/queue simple add`, `/ppp secret add` en el dominio.

## Configuración (variables de entorno; nunca hardcode)

| Variable                           | Default | Descripción                                        |
| ---------------------------------- | ------- | -------------------------------------------------- |
| `ROUTEROS_READONLY_PROVIDER`       | `mock`  | `routeros` activa el cliente real.                 |
| `ROUTEROS_HOST`                    | —       | Host del CHR de lab. Vacío → fuerza mock.          |
| `ROUTEROS_PORT`                    | `443`   | Puerto REST/HTTPS.                                 |
| `ROUTEROS_USERNAME`                | —       | Usuario read-only del CHR de lab.                  |
| `ROUTEROS_PASSWORD`                | —       | Password (solo en entorno, nunca en repo/tests).   |
| `ROUTEROS_TIMEOUT_MS`              | `4000`  | Timeout por lectura.                               |
| `ROUTEROS_TLS_REJECT_UNAUTHORIZED` | `false` | `true` exige CA válida (CHR lab suele self-signed).|

Si faltan `ROUTEROS_HOST`/`ROUTEROS_USERNAME`/`ROUTEROS_PASSWORD`, el cliente no
se construye y el provider cae a mock. Las credenciales no aparecen en el repo,
ni en tests, ni en esta documentación.

## Fallback seguro

Ante `timeout`, `auth failed`, `router unreachable` o `api error`, la lectura cae
a mock: la API responde **200** con `source=mock` y la UI nunca se rompe. Nunca se
responde 500 por una caída del router. Si primario y fallback comparten `source`,
se re-lanza el error (evita bucles).

## Logs (seguros)

- `routeros_read_success` (info): lectura real OK (`source=routeros`).
- `routeros_read_fallback` (warn): se cayó a mock; incluye `reason` = `code`/`name`
  del error.

Nunca se registran `password`, `token`, `credentials` ni `jwt`. El cliente REST no
importa ni usa el logger (imposible filtrar secretos desde ahí); el `Authorization:
Basic` solo viaja en la petición, jamás se loguea.

## UI

Sin rediseño (mismos colores, tipografía, layout y sidebar). Solo se agregó un
indicador de **Fuente: MOCK | ROUTEROS** en el encabezado del RouterOS Read-Only
Lab, derivado del `source` efectivo de la respuesta.

## Endpoints afectados

Sin cambios de contrato. Siguen siendo **GET** y solo cambia el `source` efectivo
de la respuesta cuando hay CHR de lab conectado:

- `GET /api/routeros/identity`
- `GET /api/routeros/system`
- `GET /api/routeros/interfaces`
- `GET /api/routeros/routes`
- `GET /api/routeros/wireguard`

## Tests

- `tests/unit/routeros.client.test.ts` (**nuevo**): config por env (presente/ausente/
  defaults), allowlist → ruta REST, rechazo de comandos no permitidos antes de la
  red, error de red mapeado (loopback ECONNREFUSED) y safety estático (sin verbos
  de escritura, solo GET, sin logging de secretos).
- `tests/unit/routeros.provider.integration.test.ts` (**nuevo**): wiring por env,
  `source=routeros` con CHR fake, fallback a mock ante auth/unreachable/timeout y
  emisión de `routeros_read_success` / `routeros_read_fallback` sin secretos.
- Siguen pasando `routeros.readonly.{providers,security,service,ui,contract}`.

## Seguridad — garantías

- Físicamente incapaz de escribir: solo `GET` REST sobre rutas de lectura.
- Allowlist estricta validada en cliente y provider; lo no permitido se rechaza
  antes de la red.
- Sin secretos en logs ni en el repositorio.
- Fallback seguro: una caída del CHR nunca rompe la API ni la UI.
- Producción permanece en `mock` (ver `.env.production.example`). Solo CHR de lab.

## Qué NO incluye (gated)

No avanza a PROD-6, Inventory Sync, Worker Live ni RouterOS Write. No toca RB5009
de producción ni routers reales.

## Validación

- `npm run typecheck` — PASS
- `npm test` — PASS
- `npm run build` — PASS

## Siguiente fase

Validación en staging por Hermes con un CHR de lab real (credenciales fuera del
repo). Solo tras su aprobación se consideraría PROD-6.
