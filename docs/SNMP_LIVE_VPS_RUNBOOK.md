# NugaCore — Runbook VPS para SNMP Live + WireGuard

**VPS documentado:** `5.180.151.109`  
**Staging URL:** `https://nugacore-staging.5.180.151.109.sslip.io`

## Auditoría operativa (2026-07-13 — post wg0 + deploy)

| Comprobación | Resultado |
|--------------|-----------|
| `wg0` host | **OK** — UDP `13231` escuchando |
| Servidor WG en NugaCore | Creado (`isDefault`, pool `10.70.0.0/16`) |
| Peers activos | `0` (pendiente enrollment CHR) |
| Coolify deploy | `629e25b` @ rama `cursor/snmp-live-mikrotik-wizard-cb99` — **finished** |
| `GET /api/snmp/health` (JWT) | `{"enabled":false,"intervalMs":120000}` |
| Env runtime | `SNMP_POLLER_ENABLED=false`, `MIKROTIK_VPN_*` configurados |
| `validate-staging.sh` | Health OK; `/api/clients` 401 sin JWT (esperado Fase 2) |

Scripts ejecutados en VPS:

```bash
bash scripts/vps/setup-wireguard-host.sh
bash scripts/vps/sync-wireguard-peers.sh          # tras cada enrollment
BRANCH=cursor/snmp-live-mikrotik-wizard-cb99 bash scripts/vps/deploy-coolify-staging.sh
```

---

## Auditoría SSH (2026-07-13)

**Estado:** SSH operativo desde Cloud Agent (`cloud-agent-nugacore-cb99`).

```bash
bash scripts/vps/bootstrap-ssh-access.sh    # conectar
bash scripts/vps/persist-ssh-key-for-environment.sh  # persistir VPS + preparar secret Cursor
ssh nugacore-vps 'hostname'                 # alias configurado
```

| Comprobación | Resultado |
|--------------|-----------|
| Auth SSH `root@5.180.151.109` | OK (`vmi2244281`) |
| Clave en `authorized_keys` | OK (idempotente en `/root/.ssh/authorized_keys.d/`) |
| WireGuard `wg0` | **No configurado** (`wg` no instalado en host) |
| UDP 13231 | No escuchando |
| Coolify app (staging) | Healthy (`zmjc5lnl0wj3kh0uj14s2p4i-*`) |
| `nugacore-web-1` (compose local) | Unhealthy — healthcheck Docker roto (OCI cwd); no bloquea staging Coolify |
| Repo VPS | `/root/work/NugaCore-v2` @ `main` (`59b607b`) |
| `MIKROTIK_WORKER_LIVE` | `false` |
| `SNMP_POLLER_ENABLED` | No desplegado aún (staging en commit previo al dominio snmp-poller) |
| `GET /api/snmp/health` | 404 en staging actual |
| `validate-staging.sh` | Health OK; `/api/clients` → 401 sin JWT (esperado) |
| `preflight.sh` en VPS | FAIL solo por `git ls-remote` HTTPS (remoto VPS usa SSH); resto OK |

**Persistencia futura:** añadir `VPS_SSH_PRIVATE_KEY` en Cursor Cloud Environment (ver `docs/CLOUD_AGENT_VPS_SSH.md`). `.cursor/environment.json` ejecuta bootstrap en `install`.

**Pendiente operador:** crear `wg0` en host (§2), desplegar rama con snmp-poller cuando se autorice piloto live.

---

## Auditoría SSH (2026-07-13 — intento inicial sin clave)

Intentos desde el entorno del agente Cloud antes de configurar clave:

```bash
ssh -o BatchMode=yes root@5.180.151.109 'wg show'
```

**Resultado:** `Permission denied (publickey,password)` — resuelto tras bootstrap + persist.

**Para habilitar auditoría automática desde Cloud Agent:** ver guía completa **`docs/CLOUD_AGENT_VPS_SSH.md`** (secretos `VPS_SSH_PRIVATE_KEY`, scripts `bootstrap-ssh-access.sh`, `persist-ssh-key-for-environment.sh`, `test-ssh-connection.sh`).

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
