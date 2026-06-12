# HOTFIX — Fase 4.7 WireGuard Auto Enrollment — Pre-Hermes
**Commit base auditado:** `84f6439`  
**Fecha del hotfix:** 2026-06-12  
**Bloqueadores corregidos:** FIX-1 (router huérfano) + FIX-2 (routerosVersion hardcodeada)

---

## FIX-1 — Router huérfano sin rollback

### Causa raíz

En `service.ts`, el método `start()` ejecutaba `store.MIKROTIK_ROUTERS.push()` **de forma síncrona y antes** del `await buildScript()`:

```typescript
// ANTES (código original — líneas 124-144):
const routerId = store.getUniqueMikrotikRouterId();
store.MIKROTIK_ROUTERS.push({ id: routerId, ... }); // push síncrono
const result = await buildScript(routerId, input, actorId); // podía fallar
```

Si `buildScript` lanzaba una excepción (IPAM agotado, servidor WG inexistente, fallo del generador), el router quedaba registrado en el store con `provisioningStatus: 'pending'` pero sin ningún enrollment asociado ni peer WG vinculado. El router era inaccesible vía enrollment y ocupaba un ID de forma permanente.

### Cambio aplicado

`buildScript` ahora se ejecuta **antes** del push. El push al store solo ocurre si `buildScript` termina exitosamente. Si falla, se intenta un rollback best-effort del peer WG (en caso de que `getPeerConfigForRouter` haya creado un peer antes de que fallara `generateFromTemplate`).

```typescript
// DESPUÉS (código corregido):
const routerId = store.getUniqueMikrotikRouterId();

let buildResult: Awaited<ReturnType<typeof buildScript>>;
try {
  buildResult = await buildScript(routerId, input, actorId);  // await primero
} catch (err) {
  // Best-effort: revocar peer WG si fue creado antes del fallo
  try {
    const wgSvc = getWireguardService();
    const orphans = await wgSvc.listPeers({ serverId: input.wgServerId, routerId, status: 'active' });
    if (orphans.length > 0) {
      await wgSvc.revokePeer(orphans[0].id);
      logger.warn('Enrollment: peer WG huérfano revocado en rollback', { routerId, peerId: orphans[0].id });
    }
  } catch (rollbackErr) {
    logger.warn('Enrollment: rollback de peer WG falló (best-effort)', { routerId, error: String(rollbackErr) });
  }
  throw err;
}

// Push al store SOLO tras buildScript exitoso
store.MIKROTIK_ROUTERS.push({ id: routerId, vpnIp: wgAssignedIp, ... });
```

### Efecto secundario positivo (H-3)

Al mover el push después del await, se aprovechó para añadir `vpnIp: wgAssignedIp` al registro del router, resolviendo también el hallazgo H-3 de la auditoría.

### Tests añadidos (FIX-1)

Archivo: `tests/contract/router.enrollment.contract.test.ts`

```
[+] start() con wgServerId inexistente devuelve error (≥400) y NO agrega router al store
[+] start() fallido NO crea enrollment huérfano
[+] start() fallido no incrementa el contador de routers
```

---

## FIX-2 — `routerosVersion` hardcodeada en `download()`

### Causa raíz

El método `download()` reconstruía el input para `buildScript` desde el registro del store pero usaba `routerosVersion: '7'` literalmente:

```typescript
// ANTES (código original — línea ~212):
const input: StartEnrollmentInput = {
  routerName: router.name,
  routerosVersion: '7',   // ← hardcoded, ignora versión real del enrollment
  wgServerId: rec.wgServerId,
  ...
};
```

`routerosVersion` no se persistía en `RouterEnrollmentRecord` ni en `MikrotikRouterRegistryItem`. Un router enrollado con RouterOS 6 recibiría en la re-descarga un script generado con sintaxis de RouterOS 7, potencialmente incompatible.

### Cambio aplicado

**1. Tipo `RouterEnrollmentRecord`** — campo nuevo:
```typescript
routerosVersion: '6' | '7';
```

**2. Tipo `RouterEnrollmentView`** — campo nuevo:
```typescript
routerosVersion: '6' | '7';
```

**3. `toView()`** — mapeado del campo:
```typescript
routerosVersion: rec.routerosVersion,
```

**4. `start()`** — persistencia en el record:
```typescript
const rec: RouterEnrollmentRecord = {
  ...
  routerosVersion: input.routerosVersion,   // persiste la versión real
  ...
};
```

**5. `download()`** — usa la versión persistida:
```typescript
const input: StartEnrollmentInput = {
  routerName: router.name,
  routerosVersion: rec.routerosVersion,   // versión del enrollment, no hardcoded
  ...
};
```

**6. Migración SQL** — columna nueva:
```sql
routeros_version TEXT NOT NULL DEFAULT '7' CHECK (routeros_version IN ('6', '7')),
```

### Tests añadidos (FIX-2)

Archivo: `tests/unit/router.enrollment.test.ts`
```
[+] routerosVersion acepta "6" y "7" (FIX-2)
```

Archivo: `tests/contract/router.enrollment.contract.test.ts`
```
[+] start() con routerosVersion="6" persiste "6" en el enrollment
[+] start() con routerosVersion="7" persiste "7" en el enrollment
[+] download() de enrollment con routerosVersion="6" genera script con header v6+ (no v7+)
[+] download() de enrollment con routerosVersion="7" genera script con header v7+ (no v6+)
[+] GET /:id muestra routerosVersion en el view
```

---

## Riesgos restantes

### H-3 vpnIp — RESUELTO como efecto secundario de FIX-1

Al mover el push al store después del await, se añadió `vpnIp: wgAssignedIp` en el mismo cambio. El registro del router ahora incluye la IP VPN asignada por el IPAM de WireGuard.

### Hallazgos que quedan para fase posterior

Los siguientes hallazgos de la auditoría NO se corrigen en este hotfix y se documentan para fases posteriores:

| ID | Severidad | Descripción | Estado |
|----|-----------|-------------|--------|
| M-1 | Medio | Estado `draft` es código muerto (nunca alcanzable) | Pendiente fase posterior |
| M-2 | Medio | Sin cooldown en `POST /:id/check-online` | Pendiente fase posterior |
| M-3 | Medio | `revokedBy` no expuesto en `RouterEnrollmentView` | Pendiente fase posterior |
| M-4 | Medio | `apiUsername` generado no incluido en `StartEnrollmentResult` | Pendiente fase posterior |
| M-5 | Medio | Sin paginación en `GET /api/router-enrollment` | Pendiente fase posterior |
| B-1 | Bajo | `wgManagementCidr` == `wgVpnCidr` no documentado | Pendiente fase posterior |
| B-2 | Bajo | Inconsistencia 401 vs 403 según entorno | Pendiente fase posterior |
| B-3 | Bajo | `nextId()` potencial colisión bajo concurrencia alta | Pendiente fase posterior |
| B-4 | Bajo | `sectionFileCleanup()` borra script antes de confirmar éxito | Pendiente fase posterior |

### Riesgo residual de peer WG huérfano

Si `getPeerConfigForRouter` **crea** un nuevo peer y luego `generateFromTemplate` falla:
- El rollback intenta revocar el peer → puede tener éxito o fallar (best-effort)
- Si el rollback falla: el peer queda activo con `routerId` apuntando a un router que no existe en el store
- Impacto: el peer ocupa una IP del pool IPAM hasta que se revoque manualmente
- Mitigación: en el siguiente intento de enrollment con el mismo `routerId`, `getPeerConfigForRouter` encontraría el peer activo y lo reutilizaría (no crea duplicado)
- Exposición real: muy baja; `generateFromTemplate` solo falla si el script viola políticas de seguridad (lo cual no debería ocurrir con parámetros válidos de WG)

---

## Resultado de validación

```
npx tsc --noEmit   → 0 errores
npm test           → 570 passed, 0 failed, 34 skipped (604 total)
npx vite build     → ✓ built in 2.35s
```

Tests nuevos en este hotfix: **9 tests** (1 unit + 3 contrato FIX-1 + 5 contrato FIX-2)
