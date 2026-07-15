# WireGuard Auto Enrollment — Guía de Uso (Fase 4.7)

**Módulo:** Enrollment WireGuard Auto  
**Roles:** Super Admin, Administrador (inicio + revocación), Técnico (inicio + descarga)

**UI (julio 2026):** MikroTik → **Routers** → botón **Dar de alta** (no hay ítem
separado “Alta de Router” en el sidebar). Ver
[`docs/frontend/ROUTERS_MODULE_UX.md`](../frontend/ROUTERS_MODULE_UX.md).

**Host WG:** al crear el peer, NugaCore aplica automáticamente en `wg0` del VPS.
Ver [`WIREGUARD_HOST_APPLY.md`](./WIREGUARD_HOST_APPLY.md).

**Handoff completo del sprint:**
[`docs/reports/SPRINT_HANDOFF_2026-07-15.md`](../reports/SPRINT_HANDOFF_2026-07-15.md).

---

## ¿Qué hace este módulo?

Automatiza la incorporación de routers MikroTik a la red de gestión de NugaCore
a través de WireGuard. El proceso completo se realiza sin ejecutar ningún comando
directamente en el router — el técnico importa el script generado manualmente.

---

## Flujo paso a paso

### 1. Iniciar enrollment (POST /api/router-enrollment/start)

El wizard recopila los datos del router, el servidor WireGuard y la configuración
LAN opcional, luego llama a este endpoint.

**Lo que hace NugaCore internamente:**
1. Crea el router en el registry (`provisioningStatus: 'pending'`)
2. Llama a `WireGuard Manager.getPeerConfigForRouter()` — asigna IP del pool y genera keypair
3. **Aplica el peer en el VPS (`wg0`) vía host-apply automático** — sin sync manual
4. Genera el script `.rsc` con `router_base_wireguard` (todas las claves incrustadas)
5. Crea el registro de enrollment (`status: 'script_generated'`)
6. Devuelve el script **UNA sola vez** — nunca se persiste

**Campos de respuesta:**
```json
{
  "enrollment": { "id": "enr-1", "status": "script_generated", ... },
  "routerId": "mkt-4",
  "wgPeerId": "wgp-1",
  "wgAssignedIp": "10.70.0.2",
  "wgServerPublicKey": "BASE64==",
  "script": "# NugaCore\n# ...",
  "scriptFilename": "nugacore-tpl-router_base_wireguard-torre-norte-20260612.rsc",
  "scriptHash": "a1b2c3...64chars",
  "securityWarning": "Este script contiene claves privadas..."
}
```

> **Seguridad:** el campo `script` solo se devuelve aquí. Guárdalo con cuidado.

---

### 2. Descargar script (GET /api/router-enrollment/:id/download)

Descarga el script como archivo `.rsc`. Puede llamarse más de una vez — el script
se re-genera usando las mismas claves cifradas del peer WireGuard.

- Actualiza `scriptDownloadedAt` y avanza a `status: 'script_downloaded'`
- Cabeceras: `Content-Disposition: attachment; filename=...`, `Cache-Control: no-store`

---

### 3. Importar en el MikroTik (manual)

```
# En Winbox / Terminal del router:

# 1. Backup previo
/system backup save name=pre-nugacore-enrollment

# 2. Subir el archivo (drag & drop en Winbox Files)

# 3. Importar
/import file-name=nugacore-tpl-router_base_wireguard-....rsc

# 4. Limpiar (opcional, el script lo hace automáticamente)
/file remove [find name~"nugacore-tpl-"]
```

El script configura:
- Interfaz WireGuard `NugaCoreWG` con la private key pre-configurada
- IP del peer (`10.70.x.x/32`) en la interfaz WireGuard
- Peer hacia el servidor WireGuard de NugaCore
- Ruta de gestión hacia la red de administración
- Watchdog WireGuard (cada 5 minutos)
- Usuario API NugaCore con permisos mínimos (`read,write,api,test`)
- Bridge LAN, DHCP, NAT y firewall básico

---

### 4. Confirmar online (POST /api/router-enrollment/:id/check-online)

NugaCore llama al Worker MikroTik en modo **read-only** para verificar que el router
responde. No ejecuta ningún comando de escritura.

**Comandos de lectura ejecutados:**
- `/system/resource/print`
- `/interface/print`
- `/queue/simple/print`
- `/ip/address/print`

**Transiciones de estado:**
- Router responde → `online` + `onlineConfirmedAt` + router `connected`
- Sin respuesta, intentos < 10 → `waiting_for_router`
- Sin respuesta, intentos ≥ 10 → `failed` + `failureReason`

---

### 5. Revocar (POST /api/router-enrollment/:id/revoke)

Solo Super Admin y Administrador. Revoca el peer WireGuard en el Manager
y marca el enrollment como `revoked`. El router pierde acceso a la VPN de gestión.

---

## Estados del enrollment

| Estado | Descripción |
|--------|-------------|
| `script_generated` | Script generado, pendiente de descarga |
| `script_downloaded` | Script descargado al menos una vez |
| `waiting_for_router` | Esperando que el router se conecte |
| `online` | Router confirmado online |
| `failed` | Más de 10 intentos fallidos |
| `revoked` | Peer WG revocado, enrollment cancelado |

---

## RBAC

| Acción | Super Admin | Administrador | Técnico | Otros |
|--------|:-----------:|:-------------:|:-------:|:-----:|
| Iniciar | ✓ | ✓ | ✓ | ✗ |
| Listar / ver | ✓ | ✓ | ✓ | ✗ |
| Descargar script | ✓ | ✓ | ✓ | ✗ |
| Check online | ✓ | ✓ | ✓ | ✗ |
| Revocar | ✓ | ✓ | ✗ | ✗ |

---

## Seguridad

- **Script nunca persistido**: solo `scriptHash` (SHA-256) en la base de datos
- **Claves WireGuard cifradas**: AES-256-GCM en el repositorio, descifradas solo para generar el script
- **Cache-Control: no-store**: los browsers no cachean el script descargado
- **Secretos nunca en logs**: el servicio solo loguea `enrollmentId`, `routerId`, `scriptHash`
- **Validadores de seguridad**: el script pasa por `assertNoBrandViolation`, `assertNoForbiddenPolicies`, `assertNoForbiddenKeywords` (igual que Templates Library)
- **Revocación**: al revocar, el peer WG se revoca en el Manager y la IP se libera al pool IPAM

---

## API Reference

```
POST  /api/router-enrollment/start
GET   /api/router-enrollment
GET   /api/router-enrollment/:id
GET   /api/router-enrollment/:id/download
POST  /api/router-enrollment/:id/check-online
POST  /api/router-enrollment/:id/revoke
```

### POST /start — body

```typescript
{
  routerName: string;        // requerido
  wgServerId: string;        // requerido
  routerosVersion: '6'|'7'; // requerido
  ipAddress?: string;
  apiPort?: number;
  linkedTowerId?: string;
  lanBridgeName?: string;
  lanCidr?: string;
  lanGateway?: string;
  wanInterface?: string;
  notes?: string;
}
```
