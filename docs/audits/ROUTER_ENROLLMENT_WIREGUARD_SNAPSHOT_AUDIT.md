# Auditoría — dependencia de WireGuard store en download()

Fase 4.9.2 hotfix · 2026-06-17.

## ¿Por qué download necesita WireGuard store?

`download()` regenera el `.rsc` llamando a `buildScript()`, que antes **siempre**
ejecutaba `wgService.getPeerConfigForRouter(routerId, wgServerId, actorId)` para
obtener la config del peer WireGuard de management. Esa búsqueda:

1. Lista peers activos del router en el WG store.
2. Si no hay peer → `createPeer()` → `getServer(serverId)` → lanza
   `NotFoundError("Servidor WireGuard '<id>' no encontrado.")` si el servidor no
   existe.

Con `USE_DB_WIREGUARD=false`, el WG store vive en memoria. Tras un restart del
contenedor el servidor y el peer desaparecen, así que `download()` fallaba con
404 "Servidor WireGuard 'wgs-1' no encontrado" — aunque el enrollment, el
`router_snapshot` y los `template_parameters` ya persistían en Supabase.

## ¿Qué plantillas necesitan datos de WireGuard?

Solo las que **incrustan** un túnel WireGuard en el script
(`WG_TEMPLATES` = `enrollmentTemplateNeedsWireguard`):

| Plantilla | ¿Incrusta WireGuard en el script? |
|---|---|
| `router_base_wireguard` | **Sí** (peer privada + datos del servidor) |
| `tower_wisp` | **Sí** |
| `pcc_2wan … pcc_5wan` | No |
| `pppoe_server`, `noc_ready`, `monitoring_agent` | No |

### ¿pcc_5wan necesita WireGuard?
**No.** El script PCC no contiene `NugaCoreWG`; se regenera solo con
`templateParameters` + `routerSnapshot`. La llamada al WG store era innecesaria y
era la causa del 404 tras restart. **Fix:** en `download`, las plantillas no-WG
ya **no** consultan el WG store.

### ¿router_base_wireguard necesita peerPrivateKey?
**Sí.** El `.rsc` incrusta `private-key=` del peer para levantar el túnel. Tras
restart esa clave no está en memoria. **Fix:** se persiste cifrada en el
`wireguard_snapshot` y se descifra al regenerar.

## ¿Qué datos pueden persistirse sin secreto?

Públicos (en claro en el snapshot): `wgServerId`, `wgPeerId`, `serverPublicKey`,
`endpointHost`, `endpointPort`, `assignedIp`, `allowedCidr`/`allowedIps`,
`persistentKeepalive`, `hasEncryptedSecrets`.

## ¿Qué datos deben cifrarse o no persistirse?

- **Cifrados** (nunca en claro, nunca expuestos por API): `peerPrivateKey` y
  `presharedKey` → `encryptedPeerPrivateKey`, `encryptedPresharedKey`, usando el
  mecanismo existente `encryptSecret`/`decryptSecret` (AES-256-GCM con
  `MIKROTIK_CREDENTIALS_KEY`), el mismo que ya usa WireGuard Manager.
- **Nunca persistidos:** `serverPrivateKey`, tokens, el script completo.

## Decisión

**Opción B** (cifrar secretos reutilizando el cifrado existente), porque el
mecanismo ya es maduro y se usa en WireGuard Manager. Esto permite re-download de
plantillas WireGuard tras restart sin activar `USE_DB_WIREGUARD`. Además, las
plantillas no-WG (lo que Hermes prueba: `pcc_5wan`) dejan de depender del WG store.

## Riesgos

- **Secretos en DB:** el `wireguard_snapshot` guarda claves del peer **cifradas**
  (RLS deny-by-default + nunca expuestas por API/View/logs). Si se rota
  `MIKROTIK_CREDENTIALS_KEY`, los snapshots viejos no se podrán descifrar → el
  re-download de esos WG enrollments devolverá `WIREGUARD_SNAPSHOT_MISSING` (no
  rompe; se re-inicia el enrollment).
- **Enrollments legacy** sin `wireguard_snapshot`: para plantillas WG, tras
  restart devuelven `WIREGUARD_SNAPSHOT_MISSING` (404 controlado). Para no-WG
  funcionan sin problema.
- **Compatibilidad:** no se toca WireGuard Manager ni se activa `USE_DB_WIREGUARD`.
