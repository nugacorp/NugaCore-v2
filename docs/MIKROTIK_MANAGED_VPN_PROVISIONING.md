# MIKROTIK MANAGED VPN PROVISIONING — Fase 4.6.0

Fecha: 2026-06-05
Objetivo: NugaCore genera, desde la web, un script RouterOS para que cualquier
MikroTik se conecte a un **túnel administrado por NugaCore** y exponga su API
**solo** dentro de la VPN. Sin Tailscale como arquitectura principal.

Auditoría: [MIKROTIK_VPN_ARCHITECTURE_AUDIT.md](MIKROTIK_VPN_ARCHITECTURE_AUDIT.md).

## 1. Arquitectura recomendada

```
                 Internet
   MikroTik WISP ───────────►  NugaCore VPN Server (VPS)
   (NugaCoreWG /  túnel WG/SSTP    │  red VPN 10.10.0.0/24
    NugaCoreVPN)  saliente         │  red gestión 10.0.0.0/24
        │  API 8728 solo en VPN    ▼
        └──────────────────►  Worker NugaCore (read-only + dry-run)
```

- El **router inicia** la conexión saliente al servidor de NugaCore → funciona detrás de **NAT/CGNAT**, sin exponer la API a internet.
- La API MikroTik queda **limitada a la red VPN** (`/ip service set api address=<vpn_cidr>`).
- Usuario API con **permisos mínimos** (read-only u operator).

## 2. Modos

| Modo | Rol | RouterOS | Cuándo |
|---|---|---|---|
| **wireguard_managed** | **Principal (recomendado)** | v7 | Operación normal. Mejor rendimiento, NAT-friendly. |
| **sstp_managed** | **Fallback** | v6/v7 | WG no disponible, UDP bloqueado, CGNAT difícil. |
| **tailscale_lab** | Laboratorio | cualquiera | Solo pruebas/soporte. API limitada a `100.64.0.0/10`. |
| **direct_lab** | Laboratorio | cualquiera | Redes controladas. API limitada a un CIDR de gestión. |

### Por qué WireGuard principal
Cifrado moderno, ligero, reconexión rápida, NAT traversal con `persistent-keepalive`,
y NugaCore controla el direccionamiento (`vpn_network_cidr`, `router_vpn_ip`). Es
autosuficiente: no depende de terceros.

### Por qué SSTP fallback
TLS sobre 443 atraviesa firewalls restrictivos y funciona en RouterOS v6 donde
WireGuard no existe.

### Por qué Tailscale solo laboratorio
Depende de un tercero (plano de control/DERP), identidad y ACLs externas, soporte
heterogéneo en RouterOS, y —como vio Hermes— el ping puede pasar pero la API dar
`connection refused`. No es estandarizable "para cualquier WISP".

## 3. Modelo de túnel

`connection_type` (modo): `wireguard_managed | sstp_managed | tailscale_lab | direct_lab`.
Campos (`server` en el body o env): `vpn_server_host`, `vpn_server_port`,
`vpn_network_cidr`, `router_vpn_ip`, `server_vpn_ip`, `allowed_api_cidr`, `api_port`,
`api_mode` (`read_only`/`operator`), `routeros_version_hint`.

El registro del router guarda el `connectionType` base (`wireguard`/`sstp`/`tailscale`/`direct`);
el **modo** se elige al generar el script.

## 4. Cómo generar el script

1. Módulo MikroTik → **Routers MikroTik**.
2. Registrar router (nombre, IP de administración, modo).
3. (Opcional) "Configuración del servidor VPN (avanzado)" para `server host/port`, `VPN CIDR`, `router/server tunnel IP`, `allowed API CIDR`, `management CIDR`.
4. En la tarjeta del router elegir el modo y **Generar Script**.
5. Modal con advertencia, usuario API, token (un solo uso), hash y **script**. **Copiar y guardar**: no se vuelve a mostrar.

## 5. Ejemplo — WireGuard administrado (secretos REDACTED)

```routeros
# NugaCore — Provisioning Script (WireGuard administrado) nugacore-1.0
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/ip route remove [find where comment~"NugaCore"]
/ip address remove [find where comment~"NugaCore"]
/interface wireguard peers remove [find where comment~"NugaCore"]
/interface wireguard remove [find where name~"NugaCore"]
/user group add name=nugacore policy="read,write,api,test" comment="NugaCore WireGuard group"
/user add name="nugacore_ab12cd" password="****REDACTED****" group=nugacore comment="NugaCore API user (WireGuard)"
/interface wireguard add name=NugaCoreWG listen-port=13231 comment="NugaCore WireGuard"
/ip address add address=10.10.0.5/32 interface=NugaCoreWG comment="NugaCore WG address"
/interface wireguard peers add interface=NugaCoreWG public-key="<SERVER_PUBLIC_KEY>" endpoint-address=vpn.nugacore.local endpoint-port=13231 allowed-address=10.0.0.0/24 persistent-keepalive=25s comment="NugaCore WG server peer"
/ip route add dst-address="10.0.0.0/24" gateway=NugaCoreWG comment="NugaCore management route"
/ip service set api port=8728 address="10.10.0.0/24" disabled=no
/ip service set api-ssl address="10.10.0.0/24"
/system scheduler add name=NugaCore-WG-Watchdog interval=00:05:00 comment="NugaCore WG watchdog" on-event="/interface wireguard print where name=NugaCoreWG"
```

## 6. Ejemplo — SSTP administrado (secretos REDACTED)

```routeros
# NugaCore — Provisioning Script (SSTP administrado) nugacore-1.0
/user group add name=nugacore policy="read,write,api,test" comment="NugaCore SSTP group"
/user add name="nugacore_ab12cd" password="****REDACTED****" group=nugacore comment="NugaCore API user (SSTP)"
/ppp profile add name=nugacore-profile comment="NugaCore VPN profile"
/interface sstp-client add name="NugaCoreVPN" connect-to="vpn.nugacore.local" user="nugacore_vpn34" password="****REDACTED****" profile="nugacore-profile" comment="NugaCore VPN" add-default-route=no disabled=no
/ip route add dst-address="10.0.0.0/24" gateway=NugaCoreVPN comment="NugaCore management route"
/ip service set api port=8728 address="10.10.0.0/24" disabled=no
/ip service set api-ssl address="10.10.0.0/24"
/system scheduler add name=NugaCore-VPN-Watchdog interval=00:01:00 comment="NugaCore VPN reconnect watchdog" on-event="..."
```

## 7. Ejemplo — Tailscale/Direct LAB (secretos REDACTED)

```routeros
# NugaCore — Provisioning Script (Tailscale LAB) nugacore-1.0
# AVISO: Modo LABORATORIO/soporte. NO crea VPN, NO rutas, NO cambia la red.
/user remove [find where name~"nugacore_"]
/user group remove [find where name~"nugacore"]
/user group add name=nugacore policy="read,api,test" comment="NugaCore Tailscale LAB group"
/user add name="nugacore_ab12cd" password="****REDACTED****" group=nugacore comment="NugaCore API user (Tailscale LAB)"
/ip service set api port=8728 address="100.64.0.0/10" disabled=no
/ip service set api-ssl address="100.64.0.0/10"
```

## 8. Preparar el VPS para WireGuard server (resumen)

1. VPS con IP pública (o detrás de un LB que exponga el puerto WG/UDP).
2. Instalar WireGuard; crear interfaz `wg0` con `vpn_network_cidr` (p.ej. `10.10.0.1/24`).
3. Generar par de claves del servidor; publicar la **public key** (`MIKROTIK_WG_SERVER_PUBKEY`) y el endpoint (`MIKROTIK_VPN_HOST:MIKROTIK_VPN_SERVER_PORT`).
4. Por cada router: asignar `router_vpn_ip` y registrar su **public key** (la que imprime el watchdog) como peer en el servidor.
5. Enrutar la red de gestión (`MIKROTIK_MGMT_CIDR`) hacia los routers por la VPN.
6. Firewall: permitir API 8728 **solo** desde la red VPN; nunca desde internet.

(SSTP: servidor SSTP/PPP en 443 con certificado; usuarios PPP por túnel.)

## 9. Seguridad

- Script visible **una sola vez**; se persiste solo el **hash** + metadata.
- Passwords **solo** dentro del script; nunca en campos sueltos de la respuesta ni en logs (redactados).
- API limitada a la red VPN/lab; **nunca** expuesta a internet.
- Usuario API con permisos mínimos; lab por defecto `read_only`.
- Rotación de credenciales invalida la anterior y genera un script nuevo (hash distinto).

## 10. Pendiente para Fase 4.6.1 (live read-only) y posteriores

- Servidor WireGuard de NugaCore operativo + registro automático de peers (intercambio de la public key del router).
- Worker live read-only sobre la VPN (`MIKROTIK_WORKER_LIVE=true`) validado contra el CHR.
- Más adelante: worker **commit mode** (ejecución real del corte/reactivación). **No** en esta fase.
