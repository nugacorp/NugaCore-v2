# Router Enrollment — `wireguard_snapshot` (Fase 4.9.2 hotfix)

## Por qué existe

`download()` regenera el `.rsc`. Para plantillas que **incrustan WireGuard**
(`router_base_wireguard`, `tower_wisp`) necesita la config del peer (clave del
peer + datos del servidor), que vive en WireGuard Manager. Con
`USE_DB_WIREGUARD=false` ese store es en memoria y se pierde en un restart, por lo
que `download` fallaba con `404 "Servidor WireGuard 'wgs-1' no encontrado"`.

`wireguard_snapshot` (JSONB en `router_enrollment`) persiste lo necesario para
regenerar el script de plantillas WireGuard sin depender del store.

## Qué contiene

Públicos (en claro): `wgServerId`, `wgPeerId`, `serverPublicKey`, `endpointHost`,
`endpointPort`, `assignedIp`, `allowedCidr` / `allowedIps`, `persistentKeepalive`,
`hasEncryptedSecrets`.

Secretos (**cifrados**, nunca en claro): `encryptedPeerPrivateKey`,
`encryptedPresharedKey` — con `encryptSecret`/`decryptSecret` (AES-256-GCM,
`MIKROTIK_CREDENTIALS_KEY`), el mismo cifrado de WireGuard Manager.

## Qué NO contiene / NO expone

- Nunca en claro: `peerPrivateKey`, `presharedKey`, `serverPrivateKey`, tokens,
  script completo.
- La **View/API** (`GET /:id`) expone el snapshot **saneado**: se eliminan
  `encryptedPeerPrivateKey` y `encryptedPresharedKey` (garantía de tipo:
  `RouterEnrollmentWireGuardSnapshotView = Omit<…, campos cifrados>`). Permitido en
  la view: `wgServerId`, `wgPeerId`, `endpointHost`, `endpointPort`, `assignedIp`,
  `serverPublicKey`, `hasEncryptedSecrets`.

## Qué plantillas lo usan

Solo las que incrustan WireGuard (`enrollmentTemplateNeedsWireguard`):
`router_base_wireguard`, `tower_wisp`. Las demás (`pcc_*`, `pppoe_server`,
`noc_ready`, `monitoring_agent`) **no** usan WireGuard en `download` y por tanto no
consultan el WG store tras restart.

## Política de re-download de plantillas WireGuard

`download()` resuelve WireGuard así:

1. **Plantilla no-WG** → no se consulta WireGuard. Regenera con
   `templateParameters` + `routerSnapshot`.
2. **Plantilla WG** → `resolveWgForDownload`:
   - Si hay `wireguard_snapshot` con secretos cifrados → se descifra y regenera
     (claves originales, determinista, sin tocar el store).
   - Si no → fallback al WG store (por si sigue en memoria).
   - Si tampoco → `404 { code: "WIREGUARD_SNAPSHOT_MISSING" }` (no NOT_FOUND
     genérico). Se debe reiniciar el enrollment.

## Riesgos

- Rotar `MIKROTIK_CREDENTIALS_KEY` invalida los secretos cifrados de snapshots
  previos → esos WG enrollments devuelven `WIREGUARD_SNAPSHOT_MISSING` al
  re-descargar (no se rompe nada; se re-inicia).
- Enrollments legacy sin snapshot: no-WG funcionan; WG → `WIREGUARD_SNAPSHOT_MISSING`.

## Relación con `USE_DB_WIREGUARD` futuro

Esta solución **no** activa `USE_DB_WIREGUARD`. El snapshot es dato propio del
enrollment para regeneración determinista. Si en el futuro WireGuard Manager
persiste en DB, `download` podría leer el peer desde ahí; el snapshot seguiría
sirviendo como fuente self-contained del enrollment. Ver también
`docs/ROUTER_ENROLLMENT_ROUTER_SNAPSHOT.md` (snapshot del router, no sensible).
