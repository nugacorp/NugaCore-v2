# WireGuard Auto Enrollment — Auditoría de Diseño (Fase 4.7)

**Fecha:** 2026-06-12  
**Autor:** NugaCore Engineering  
**Estado:** Diseño aprobado para implementación

---

## 1. Objetivo

Crear un flujo completo y automatizado para incorporar routers MikroTik a NugaCore a
través de WireGuard, eliminando la configuración manual y los errores humanos:

```
Admin inicia enrollment
  → Router creado en registry (pending)
  → Peer WireGuard asignado (IPAM + keypair)
  → Script .rsc generado (credenciales incrustadas, nunca persistidas)
  → Técnico descarga e importa el script en el MikroTik físico
  → Router se conecta por WireGuard
  → NugaCore lee el router via Worker read-only
  → Enrollment marcado online
```

---

## 2. Estados del enrollment

```
draft (no usado actualmente; reservado para futura fase de pre-registro)
  │
  ▼
script_generated   ← POST /start genera el script y lo devuelve UNA vez
  │
  ▼
script_downloaded  ← GET /:id/download actualiza downloaded_at
  │
  ▼
waiting_for_router ← estado mientras el técnico importa el script
  │
  ├─► online        ← POST /:id/check-online confirma router activo
  │
  ├─► failed        ← > 10 intentos check-online fallidos
  │
  └─► revoked       ← POST /:id/revoke (SA / Admin) + revoca peer WG
```

---

## 3. Decisiones de diseño

### 3.1 Seguridad de secretos

| Secreto | Generación | Persistencia | Transmisión |
|---------|-----------|--------------|-------------|
| WireGuard private key | `generateWgKeyPair()` (Curve25519) | `encryptedPrivateKey` cifrado AES-256-GCM | Solo en el script `.rsc` (UNA vez) |
| WireGuard preshared key | `generatePresharedKey()` (32 bytes) | `encryptedPresharedKey` cifrado AES-256-GCM | Solo en el script `.rsc` (UNA vez) |
| API password del router | `generateStrongPassword()` | `encryptedPassword` cifrado AES-256-GCM | Solo en el script `.rsc` (UNA vez) |

**Regla cardinal:** el script completo NUNCA se persiste. Solo se almacena `scriptHash`
(SHA-256 hex) para auditoría.

### 3.2 Re-descarga del script

El endpoint `GET /:id/download` puede llamarse múltiples veces. El script se
**re-genera** en cada descarga usando `getPeerConfigForRouter()` que descifra y
reutiliza las mismas claves del peer activo. Las claves son estables hasta que se
rote o revoque el peer.

Esto permite que un técnico descargue el script en más de un intento sin comprometer
la seguridad (las claves no cambian).

### 3.3 Integración con dominios existentes

- **WireGuard Manager**: `wgService.getPeerConfigForRouter(routerId, serverId)` —
  reutiliza peer activo o lo crea. Retorna `PeerCreatedOnce` con secretos en claro.
- **RouterOS Templates**: `generateFromTemplate({ templateId: 'router_base_wireguard', ...params })` —
  genera script idempotente con WG pre-configurado.
- **MikroTik Worker**: `readRouterSnapshot(routerId)` — lectura read-only para confirmar
  que el router está online tras importar el script.
- **Store en memoria**: `store.getUniqueMikrotikRouterId()` + push a `MIKROTIK_ROUTERS`.

### 3.4 RBAC

| Acción | Roles permitidos |
|--------|-----------------|
| Iniciar enrollment | Super Admin, Administrador, Técnico |
| Listar / ver enrollments | Super Admin, Administrador, Técnico |
| Descargar script | Super Admin, Administrador, Técnico |
| Check online | Super Admin, Administrador, Técnico |
| Revocar enrollment | Super Admin, Administrador |

### 3.5 Restricciones críticas

- NO commit mode: sin envío de comandos reales al router
- NO ejecución de comandos RouterOS desde el backend
- NO suspensiones ni cortes reales
- NO modificar WireGuard Manager, Auth, Billing, Suspension Engine
- Worker se usa solo para lectura (`readRouterSnapshot`), sin escribir
- El script generado usa el mismo validador de seguridad que Templates Library
  (`assertNoBrandViolation`, `assertNoForbiddenPolicies`, `assertNoForbiddenKeywords`)

---

## 4. Endpoints REST

```
POST  /api/router-enrollment/start          → crea router + peer + script
GET   /api/router-enrollment                → lista enrollments
GET   /api/router-enrollment/:id            → detalle
GET   /api/router-enrollment/:id/download   → descarga script .rsc
POST  /api/router-enrollment/:id/check-online → lectura read-only Worker
POST  /api/router-enrollment/:id/revoke     → revoca peer WG + enrollment
```

---

## 5. Modelo de datos

```typescript
interface RouterEnrollmentRecord {
  id: string;                    // 'enr-1', 'enr-2' ...
  routerId: string;              // referencia a MikrotikRouterRegistryItem
  wgServerId: string;
  wgPeerId: string;
  enrolledBy: string;            // userId del actor
  status: EnrollmentStatus;
  scriptHash?: string;           // SHA-256 del script (sin secretos en el campo)
  scriptDownloadedAt?: string;
  checkOnlineAttempts: number;
  lastCheckAt?: string;
  onlineConfirmedAt?: string;
  failureReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 6. Flujo nominal paso a paso

1. **Admin abre el wizard** en NugaCore → paso 1: datos del router
2. **Rellena**: nombre, IP opcional, torre, versión RouterOS, parámetros LAN opcionales
3. **Selecciona servidor WireGuard** del pool (paso 2)
4. **Hace clic en "Generar script"** → `POST /api/router-enrollment/start`
   - NugaCore crea el router en registry (`provisioningStatus: 'pending'`)
   - NugaCore asigna un peer WireGuard (nueva IP del pool)
   - NugaCore genera el script `.rsc` con todos los parámetros incrustados
   - Respuesta incluye script en claro (única vez)
5. **Paso 5 del wizard**: muestra script sanitizado (sin secretos)
6. **Admin descarga** → `GET /:id/download` → archivo `.rsc`
7. **Técnico importa** en el MikroTik: `/import file-name=<archivo.rsc>`
8. **Router se conecta** por WireGuard (proceso automático)
9. **Admin hace clic en "Verificar online"** → `POST /:id/check-online`
   - Worker lee router: `/system/resource/print`, `/interface/print`, etc.
   - Si responde: enrollment → `online`, router → `connected`
   - Si no: incrementa intentos, queda en `waiting_for_router`
10. **Enrollment completado** → router listo para gestión NugaCore

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Script filtrado en logs | Nunca se pasa a `logger.info(script)`. Solo se loguea el hash. |
| Re-uso de IP WireGuard | IPAM garantiza unicidad; `nextFreeIp()` salta IPs usadas. |
| Enrollment doble por mismo router | Enrollments anteriores quedan en history; se puede revocar. |
| Router no llega a online | `checkOnlineAttempts > 10` → estado `failed` + razón de fallo. |
| Peer WG no revocado al cancelar | `POST /:id/revoke` siempre revoca peer WG en el Manager. |
