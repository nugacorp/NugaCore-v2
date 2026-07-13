# Cloud Agent → VPS SSH (NugaCore)

Guía para que un **Cursor Cloud Agent** pueda entrar por SSH al VPS de staging/producción y ejecutar runbooks (`preflight.sh`, `wg show`, etc.).

**Host:** `5.180.151.109`  
**Usuario habitual:** `root` (o `ubuntu` si no usas root)  
**Staging:** `https://nugacore-staging.5.180.151.109.sslip.io`

> No pegues claves privadas en issues, PRs ni en este repo. Solo en secretos del entorno Cursor.

---

## Estado típico del agente (sin configurar)

```bash
ls ~/.ssh/
# → solo known_hosts (sin id_ed25519 / id_rsa)

ssh -o BatchMode=yes root@5.180.151.109 'echo ok'
# → Permission denied (publickey,password)
```

En una ejecución anterior (2026-07-08) el acceso funcionó con la clave **`cloud-agent-nugacore-2026-07-08`** montada en el pod. Esa clave **no persiste** entre runs del Cloud Agent salvo que la vuelvas a cargar en el entorno.

---

## Opción A — Recomendada: secreto en el entorno Cursor

### 1. En el VPS (una sola vez): autorizar la clave pública

Desde tu máquina (o consola del proveedor), con sesión ya autenticada al VPS:

```bash
# Si reutilizas la clave del agente anterior, solo asegúrate de que su .pub esté en authorized_keys.
# Si creas una clave nueva dedicada al agente:
ssh-keygen -t ed25519 -f ./cloud-agent-nugacore -C "cursor-cloud-agent" -N ""

# Instalar la pública en el VPS (ajusta usuario si no es root)
ssh-copy-id -i ./cloud-agent-nugacore.pub root@5.180.151.109
# o manualmente:
cat ./cloud-agent-nugacore.pub | ssh root@5.180.151.109 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Guarda la **privada** (`cloud-agent-nugacore`) en tu gestor de secretos. **No la subas al repo.**

### 2. En Cursor: cargar el secreto en el Cloud Environment

1. Abre **Cursor** → **Dashboard** → **Cloud** → **Environments** (o el entorno vinculado a este repo).
2. Edita el environment que usa NugaCore / Cloud Agents.
3. Añade un secreto de entorno, por ejemplo:

| Nombre | Valor |
|--------|--------|
| `VPS_SSH_PRIVATE_KEY` | Contenido completo del archivo privado PEM/OpenSSH (incluye líneas `-----BEGIN ... KEY-----`) |
| `VPS_SSH_HOST` | `5.180.151.109` |
| `VPS_SSH_USER` | `root` |

4. Guarda y **lanza un nuevo Cloud Agent** (los runs en curso no reciben secretos nuevos).

### 3. En el agente: materializar la llave y probar

Al iniciar el run, el agente (o tú en el primer comando) ejecuta:

```bash
bash scripts/vps/setup-ssh-from-secret.sh
bash scripts/vps/test-ssh-connection.sh
```

Si `test-ssh-connection.sh` imprime `RESULTADO: OK`, ya puedes usar SSH en el mismo run:

```bash
ssh -o BatchMode=yes root@5.180.151.109 'wg show wg0; ss -ulnp | grep 13231 || true'
ssh -o BatchMode=yes root@5.180.151.109 'bash -s' < scripts/vps/preflight.sh
```

---

## Opción B — Sesión manual en el terminal del Cloud Agent

Si el dashboard no expone secretos multilínea, puedes configurar **solo para un run** (menos seguro; no dejar la clave en el repo):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh

# Pegar la clave privada en un editor local del pod (NO commitear):
nano ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519

ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 root@5.180.151.109 'echo OK'
```

---

## Opción C — Tailscale / bastión

Si el VPS solo acepta SSH vía Tailscale u otra IP:

1. Documenta en secretos: `VPS_SSH_HOST=<IP tailscale del nodo>`
2. El Cloud Agent necesita salida de red al peer (egress allow-all en este entorno).
3. Misma llave y `setup-ssh-from-secret.sh`.

---

## Verificación rápida (checklist)

| Paso | Comando | Esperado |
|------|---------|----------|
| Red | `ping -c 2 5.180.151.109` | respuestas |
| Llave local | `test -f ~/.ssh/id_ed25519 && echo key-ok` | `key-ok` |
| Auth | `ssh-add -l` o `ssh -o BatchMode=yes … 'echo ok'` | identidad o `ok` |
| WG host | `ssh … 'wg show wg0'` | interfaz wg0 |
| UDP 13231 | `ssh … 'ss -ulnp \| grep 13231'` | wireguard escuchando |

Script todo-en-uno: `bash scripts/vps/test-ssh-connection.sh`

---

## Host key cambiada

Si SSH responde `REMOTE HOST IDENTIFICATION HAS CHANGED`:

```bash
ssh-keygen -R 5.180.151.109
ssh -o StrictHostKeyChecking=accept-new root@5.180.151.109 'echo ok'
```

Confirma el cambio por un canal de confianza antes de aceptar la nueva huella (ver `docs/UI_NAVIGATION_SIMPLIFICATION_STAGING_RESULT.md`).

---

## Seguridad

- Usa una clave **dedicada** al Cloud Agent (no tu llave personal).
- En el VPS: `command=""` o restricciones en `authorized_keys` si solo necesitas runbooks.
- Rota la clave si hubo exposición; revoca la entrada en `authorized_keys`.
- Nunca commits de `.pem`, `id_*` ni passwords en el repo.

---

## Referencias

- Runbook operativo VPS: `docs/SNMP_LIVE_VPS_RUNBOOK.md`
- Bitácora previa con SSH OK: `docs/VPS_5.180.151.109_EJECUCION_2026-07-08.md`
