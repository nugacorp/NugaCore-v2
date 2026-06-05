# MIKROTIK VPN ARCHITECTURE AUDIT — Fase 4.6.0

Fecha: 2026-06-05
Disparador: Hermes intentó validar un CHR de laboratorio por Tailscale
(`100.105.27.6`): ping PASS, pero API 8728 `connection refused`. Conclusión:
Tailscale sirve para laboratorio, **no** como arquitectura principal.

## 1. Qué existe hoy

| Pieza | Estado |
|---|---|
| `provisioning/script-generator.ts` | Genera script RouterOS para `wireguard` y `sstp`. Idempotente, prefijo NugaCore, permisos mínimos, API limitada a la red VPN. |
| `provisioning/credentials.ts` | Usuario `nugacore_<id>`, password fuerte cifrado, token de un solo uso. |
| `routes.ts` (`/provisioning-script`) | Acepta `connectionType: 'wireguard'|'sstp'`; genera credenciales + script; devuelve script una vez + hash. |
| Registro de router | `connectionType: 'wireguard'|'sstp'|'direct'|'zerotier'|'tailscale'`; `managementIp`, `vpnIp`, `apiPort`, `apiSslPort`. |
| Worker 4.6 | Lecturas read-only (sim/live) + dry-run de órdenes. Sobre la **VPN**. |
| UI | `MikrotikRoutersPanel` (crear/generar script WG/SSTP), `MikrotikWorkerPanel`. |
| `.env` | `MIKROTIK_VPN_HOST`, `MIKROTIK_VPN_CIDR`, `MIKROTIK_MGMT_CIDR`, `MIKROTIK_WG_SERVER_PUBKEY`, `MIKROTIK_WG_ENDPOINT`, `MIKROTIK_WORKER_LIVE`. |

## 2. Qué falta

- Modos de provisioning **nombrados** y explícitos: `wireguard_managed`, `sstp_managed`, `tailscale_lab`, `direct_lab`.
- Modelo de túnel más completo: `vpn_server_host/port`, `vpn_network_cidr`, `router_vpn_ip`, `server_vpn_ip`, `allowed_api_cidr`, `api_mode`, `provisioning_mode`, `routeros_version_hint`.
- Generador **lab** (tailscale/direct): solo usuario read-only + API restringida, sin VPN ni rutas.
- UI con selector de modos + explicación + campos por modo.
- API que acepte los 4 modos y devuelva `routerVpnIp`/`apiUsername`/`vpnUsername`.

## 3. Rol de cada modo

| Modo | Rol | RouterOS | Notas |
|---|---|---|---|
| **wireguard_managed** | **PRINCIPAL** (recomendado) | v7 | Túnel WG administrado por NugaCore. Opera detrás de NAT/CGNAT (el router inicia la conexión saliente). API solo en la red VPN. |
| **sstp_managed** | **FALLBACK** | v6/v7 | Túnel SSTP (TLS/443) administrado por NugaCore. Útil cuando WG no está disponible o el firewall/CGNAT bloquea UDP. |
| **tailscale_lab** | Laboratorio/soporte | cualquiera | Sin VPN propia; API restringida a `100.64.0.0/10`. No recomendado para clientes. |
| **direct_lab** | Laboratorio/soporte | cualquiera | Sin VPN; API restringida a un CIDR de gestión elegido. Solo redes controladas. |

## 4. Riesgos de usar Tailscale como arquitectura principal

- **Dependencia de un tercero** (Tailscale/DERP): el plano de control y NAT-traversal no son de NugaCore.
- **API `connection refused`**: aunque el ping pase (Tailscale), el servicio API del router puede no estar escuchando en la IP/itf de Tailscale o el `/ip service` no la incluye. Difícil de estandarizar por WISP.
- **No autosuficiente**: NugaCore no controla altas/bajas, claves ni direccionamiento. No escalable a "cualquier MikroTik de cualquier WISP".
- **Modelo de identidad ajeno**: cuentas Tailscale, ACLs externas, sin integración con el provisioning de NugaCore.
- **Soporte heterogéneo**: instalar Tailscale en RouterOS v6/dispositivos limitados no siempre es viable.

## 5. Decisión final recomendada

1. **WireGuard administrado por NugaCore** = arquitectura **principal**. El router crea una interfaz `NugaCoreWG` y un peer hacia el **servidor WireGuard de NugaCore** (VPS propio). Funciona tras NAT/CGNAT, no expone la API a internet, NugaCore controla el direccionamiento (`vpn_network_cidr`, `router_vpn_ip`).
2. **SSTP administrado por NugaCore** = **fallback** (v6 / UDP bloqueado).
3. **Tailscale/Direct** = **solo laboratorio/soporte**, claramente etiquetados como "no recomendado para producción".

En todos los modos: API MikroTik **limitada a la red VPN/lab**, **nunca** expuesta a internet; usuario API con **permisos mínimos**; script visible una sola vez; solo se persiste el hash.

## 6. Plan (Tareas 2–10)

- Extender modelo/typing con `ProvisioningMode` + campos de túnel + `api_mode` (`read_only`/`operator`).
- Generadores: WireGuard managed (mejorado), SSTP managed (mejorado), Lab (tailscale/direct).
- API `/provisioning-script` acepta los 4 modos; mapea a `connectionType` base para el registro; devuelve `routerVpnIp`.
- UI con selector + explicaciones + campos por modo.
- Tests + docs + ejemplos con secretos REDACTED.
- **Sin** ejecución real, **sin** commit mode, **sin** romper el provisioning actual.
