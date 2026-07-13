# NugaCore — Runbook VPS para SNMP Live + WireGuard

**VPS documentado:** `5.180.151.109`  
**Staging URL:** `https://nugacore-staging.5.180.151.109.sslip.io`

## Auditoría SSH (2026-07-13)

Intentos desde el entorno del agente Cloud:

```bash
ssh -o BatchMode=yes root@5.180.151.109 'wg show'
SSH_AUTH_SOCK=/tmp/ssh-*/agent.* ssh -o BatchMode=yes root@5.180.151.109 'wg show'
```

**Resultado:** `Permission denied (publickey,password)` — no hay claves privadas en `~/.ssh/` ni identidades cargadas en el agente (`ssh-add -l` → *The agent has no identities*). Solo existe `known_hosts` (huella del host ya conocida).

**Para habilitar auditoría automática desde Cloud Agent:** cargar la llave privada en los secretos del entorno Cursor (o `~/.ssh/id_ed25519` en el pod) con acceso a `root@<VPS>`. Sin eso, el operador debe ejecutar los pasos de este runbook directamente en el VPS.

**Acción:** el operador (Hermes) ejecuta los pasos siguientes en el VPS hasta que la llave esté disponible en el agente.

---

## 1. Preflight

```bash
cd /opt/NugaCore-v2   # o ruta del clone en el VPS
git checkout main && git pull
bash scripts/vps/preflight.sh
```

Esperado: `RESULTADO: OK` (revisar WARN).

---

## 2. WireGuard host (`wg0`)

NugaCore gestiona peers en la app; el **daemon WireGuard en el host** es trabajo del operador.

```bash
# Verificar
wg show wg0
ss -ulnp | grep 13231

# Si no existe wg0: crear servidor desde la API NugaCore
# POST /api/wireguard/servers (con JWT admin)
# Guardar serverPrivateKey UNA vez en /etc/wireguard/wg0.conf
```

Plantilla mínima `/etc/wireguard/wg0.conf` (sin pegar claves en issues):

```ini
[Interface]
Address = 10.70.0.1/16
ListenPort = 13231
PrivateKey = <SERVER_PRIVATE_KEY>

# [Peer] blocks se añaden por cada router enrolado
```

```bash
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0
```

---

## 3. Firewall host

| Puerto | Proto | Dirección | Uso |
|--------|-------|-----------|-----|
| 13231 | UDP | Inbound | WireGuard |
| 443 | TCP | Inbound | HTTPS (Coolify) |
| 8728/8729 | TCP | Outbound → VPN | RouterOS API |
| 161 | UDP | Outbound → VPN | SNMP poll |

La API y SNMP **no** deben quedar expuestas a internet; solo desde la red VPN (`10.70.0.0/16`).

---

## 4. Variables Coolify (runtime)

```env
NODE_ENV=production
PUBLIC_DEPLOYMENT=true
AUTH_TRUST_HEADERS=false
MIKROTIK_CREDENTIALS_KEY=<secret>

# VPN
MIKROTIK_VPN_HOST=5.180.151.109
MIKROTIK_VPN_CIDR=10.70.0.0/16
MIKROTIK_MGMT_CIDR=10.0.0.0/24

# Live (solo tras piloto autorizado)
MIKROTIK_WORKER_LIVE=false
MIKROTIK_WORKER_API_TLS=true
NOC_POLLER_ENABLED=false
SNMP_POLLER_ENABLED=false
SNMP_POLLER_INTERVAL_MS=120000
```

Activar live **solo** tras CHR lab o router de prueba validado.

---

## 5. Validación post-deploy

```bash
APP_URL=https://nugacore-staging.5.180.151.109.sslip.io bash scripts/vps/validate-staging.sh
bash scripts/vps/validate-snmp-live.sh "$APP_URL"   # tras flags live
```

Con JWT:

```bash
AUTH_BEARER=<jwt> APP_URL=<staging> bash scripts/vps/validate-snmp-live.sh
```

---

## 6. Piloto CHR (orden recomendado)

1. Reset CHR de laboratorio
2. Wizard NugaCore → plantilla `nugacore_factory_onboarding`
3. Importar `.rsc` en CHR
4. Verificar túnel: `ping 10.70.0.1` desde CHR
5. `POST /api/router-enrollment/:id/check-online` → `source=live`
6. Activar `SNMP_POLLER_ENABLED=true` y verificar `GET /api/snmp/health`

---

## 7. Rollback

1. Coolify → rollback al deployment anterior
2. `MIKROTIK_WORKER_LIVE=false`, `SNMP_POLLER_ENABLED=false`, `NOC_POLLER_ENABLED=false`
3. Revocar peer WG del router de prueba
4. `validate-staging.sh` → PASS
