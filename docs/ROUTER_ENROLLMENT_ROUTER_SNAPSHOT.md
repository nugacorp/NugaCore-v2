# Router Enrollment — `router_snapshot` (Fase 4.9.2 hotfix)

## Por qué existe

`download()` regenera el script `.rsc` de un enrollment a partir de los datos del
router. Esos datos vivían **solo** en `store.MIKROTIK_ROUTERS`, un store en
memoria. Con `USE_DB_ROUTER_ENROLLMENT=true` el enrollment persiste en Supabase y
sobrevive a un restart del contenedor, **pero el router del store se pierde**.
Resultado tras restart:

```
GET /api/router-enrollment/:id            → 200  (enrollment en DB)
GET /api/router-enrollment/:id/download   → 404  {"error":"Router no encontrado.","code":"NOT_FOUND"}
```

Para que `download()` no dependa del store volátil, el enrollment guarda un
**snapshot mínimo y no sensible del router** en la columna JSONB
`router_enrollment.router_snapshot`.

## Qué contiene

Solo datos **no sensibles** necesarios para regenerar el script:

| Campo | Origen |
|---|---|
| `routerName` | nombre del router (también el filename del `.rsc`) |
| `managementIp` | IP de administración (`ipAddress` del wizard) |
| `vpnIp` | IP asignada en la VPN WireGuard |
| `apiPort` | puerto API |
| `apiSslPort` | puerto API SSL (si se conoce) |
| `linkedTowerId` | torre asociada |
| `siteName` / `routerType` / `model` | opcionales (metadata futura) |
| `notes` | notas del wizard |

## Qué NO contiene

Nunca: **passwords**, **private keys**, **preshared keys**, **scripts completos**
ni **tokens**. Las claves WireGuard las gestiona WireGuard Manager (cifradas); el
script solo persiste su `script_hash`. La vista de la API expone el snapshot tal
cual porque es no-sensible por diseño (un test verifica la ausencia de secretos).

## Cómo permite download después de restart

`download()` resuelve los datos del router con prioridad **store → snapshot**:

1. Busca el enrollment (en DB si el flag está activo).
2. Busca el router en `store.MIKROTIK_ROUTERS`.
3. Si el router **no** está (p.ej. tras restart), usa `enrollment.routerSnapshot`.
4. Si no hay router **ni** snapshot con `routerName`, responde
   `404 { code: "ROUTER_SNAPSHOT_MISSING" }` (no "Router no encontrado").

La regeneración usa, además del snapshot: `templateId`, `routerosVersion` y
`templateParameters` (todos ya persistidos en el enrollment). El peer WireGuard se
reutiliza vía WireGuard Manager por `routerId` (no depende del store de routers).

## Por qué NO activa `USE_DB_MIKROTIK`

El snapshot es un dato **propio del enrollment**, no del dominio MikroTik. Resuelve
el caso de regeneración sin migrar todo el modelo de routers a DB. `USE_DB_MIKROTIK`
sigue en `false`: el provisioning de routers continúa en el store. Esto mantiene el
cambio acotado a Router Enrollment, sin tocar WireGuard, Payment ni Suspension.

## Compatibilidad

- Enrollments **nuevos** (creados con esta versión) siempre traen `router_snapshot`.
- Enrollments **legacy** sin snapshot: si el router sigue en el store, `download`
  funciona como antes; si no (tras restart), devuelve `ROUTER_SNAPSHOT_MISSING` y
  se debe reiniciar el enrollment. La columna tiene `DEFAULT '{}'::jsonb`.
