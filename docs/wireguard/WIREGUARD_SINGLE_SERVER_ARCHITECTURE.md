# NugaCore — Arquitectura Single WireGuard Server

> Última actualización: 2026-06-12
> Relacionado: [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) · [BILLING_ROADMAP.md](../planning/BILLING_ROADMAP.md)

---

## Principio

NugaCore opera con **UN solo servidor WireGuard** permanente en el VPS.

Cada MikroTik que se incorpora a la red se convierte en un **peer** de ese servidor.
NugaCore accede a todos los routers por su **IP VPN asignada**.

```
NugaCore VPS (servidor WireGuard)
  vpnCidr: 10.70.0.0/16
  serverVpnIp: 10.70.0.1
  endpoint: <IP_PÚBLICA_VPS>:13231
          │
          ├── Peer 1: MikroTik "Torre Norte"   vpnIp: 10.70.0.2
          ├── Peer 2: MikroTik "Torre Sur"     vpnIp: 10.70.0.3
          ├── Peer 3: MikroTik "Oficina Central" vpnIp: 10.70.0.4
          └── Peer N: MikroTik "..."            vpnIp: 10.70.0.N
```

**NO se crea un servidor WireGuard por router.** Solo se crea un peer por router.

---

## Por qué funciona detrás de NAT/CGNAT

WireGuard en modo server-initiated:

1. El VPS tiene IP pública y escucha en `UDP 13231` (configurable).
2. El MikroTik tiene el VPS como `endpoint` con `persistent-keepalive=25s`.
3. Aunque el MikroTik esté detrás de CGNAT, el keepalive mantiene el hole-punch activo.
4. El VPS puede iniciar paquetes hacia la IP VPN del router (`10.70.0.N`) en cualquier momento.
5. No se requiere IP pública ni port forwarding en el MikroTik.

```
MikroTik (detrás de CGNAT)
  ──── UDP keepalive cada 25s ────► VPS:13231
  ◄─── tráfico de gestión ──────── 10.70.0.N
```

---

## Por qué NugaCore accede por vpnIp

Una vez que el tunnel WireGuard está establecido, el MikroTik tiene la IP `10.70.0.N` en la
interfaz `NugaCoreWG`. El backend de NugaCore conecta a `10.70.0.N:8728` (API RouterOS) en lugar
de usar la IP pública o privada del cliente, lo que:

- Elimina la dependencia de port forwarding
- Funciona desde cualquier topología de red del cliente
- El tráfico de gestión viaja cifrado dentro del tunnel WireGuard
- NugaCore no necesita saber la IP real del sitio

El campo `vpnIp` del `MikrotikRouterRegistryItem` se establece durante el enrollment
y el worker lo usa como `resolveHost()` de primer candidato.

---

## Cómo se crea el servidor default

El servidor WireGuard se crea una sola vez, en el setup inicial del VPS:

```bash
POST /api/wireguard/servers
{
  "name": "NugaCore VPS WireGuard",
  "endpointHost": "<IP_PÚBLICA_VPS>",
  "endpointPort": 13231,
  "vpnCidr": "10.70.0.0/16",
  "isDefault": true
}
```

La respuesta incluye `serverPrivateKey` — **se muestra una sola vez**.
Configurar esa clave en el proceso de WireGuard del VPS (`/etc/wireguard/wg0.conf`).

Reglas:
- Solo puede existir un servidor con `isDefault: true` activo.
- Si se crea uno nuevo con `isDefault: true`, el anterior pierde el flag automáticamente.
- Si no existe servidor default, el enrollment falla con 400 (error controlado, no 500).

---

## Cómo se agregan routers nuevos

1. Operador abre el Wizard de Enrollment en NugaCore.
2. Ingresa el nombre del router, versión RouterOS y datos opcionales (LAN CIDR, etc.).
3. `POST /api/router-enrollment/start` — NugaCore:
   a. Resuelve el servidor WireGuard default (o el explícito si se pasa `wgServerId`).
   b. Genera o reutiliza el peer WireGuard del router en ese servidor.
   c. Asigna la siguiente IP libre del pool IPAM (`10.70.0.N`).
   d. Genera el script `.rsc` con las claves incrustadas.
   e. Registra el router en el store con `vpnIp = 10.70.0.N`.
   f. Devuelve el script (UNA vez), el `scriptPreview` saneado y los aliases top-level.
4. Operador descarga el script y lo importa en el MikroTik (`/import <filename>.rsc`).
5. El MikroTik levanta `NugaCoreWG`, establece el tunnel y empieza los keepalives.
6. Operador pulsa "Verificar online" en el Wizard → `POST /:id/check-online`.
7. El worker lee el MikroTik via `10.70.0.N:8728` (lectura live).
8. Si la lectura confirma (`source=live`), el enrollment pasa a `online`.

---

## Contrato de respuesta de POST /start

La respuesta incluye:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `enrollmentId` | string | ID del enrollment creado |
| `peerId` | string | ID del peer WireGuard asignado |
| `assignedIp` | string | IP VPN asignada al router (sin máscara) |
| `filename` | string | Nombre del archivo `.rsc` |
| `scriptPreview` | string | Script saneado: `private-key=[REDACTED]`, sin preshared key |
| `securityNotice` | string | Advertencia de seguridad |
| `script` | string | Script completo con secretos (descargar, no almacenar) |
| `scriptHash` | string | SHA-256 (32 chars) del script para auditoría |
| `enrollment` | object | Vista del enrollment (sin secretos) |

---

## Reglas de check-online

| Condición | Resultado |
|-----------|-----------|
| `snapshot.source === 'live'` y reads ok | `status = online`, `isOnline = true` |
| `snapshot.source === 'simulated'` | `isOnline = false`, `status = waiting_for_router` |
| Sin snapshot (router no en store) | `isOnline = false`, `status = waiting_for_router` |
| `attempts > 10` (sin live) | `status = failed` |

`MIKROTIK_WORKER_LIVE=false` (default en dev/test): todas las lecturas son simuladas.
Solo con `MIKROTIK_WORKER_LIVE=true` y router accesible por `vpnIp` se obtiene `source=live`.

---

## IPAM

- Pool por defecto: `10.70.0.0/16`
- `.1` reservado para el servidor VPS
- Peers se asignan desde `.2` en adelante
- IPs liberadas al revocar un peer se reutilizan
- Pool configurable via `vpnCidr` al crear el servidor

---

## Seguridad

- La `private key` del **servidor** se devuelve UNA sola vez al crear el servidor. NugaCore solo conserva la versión cifrada (AES-256-GCM).
- La `private key` y `preshared key` de cada **peer** se devuelven UNA sola vez en `/start`. El `scriptPreview` las redacta.
- El script `.rsc` completo **nunca se persiste** en base de datos. Solo el `scriptHash` (SHA-256, 32 chars) queda en `router_enrollment`.
- La IP VPN (`vpnIp`) se almacena en el registro del router para que el worker la use como host de conexión.
