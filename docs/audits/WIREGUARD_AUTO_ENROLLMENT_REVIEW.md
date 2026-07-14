# Auditoría Arquitectónica — Fase 4.7: WireGuard Auto Enrollment
**Commit auditado:** `84f6439`  
**Fecha:** 2026-06-12  
**Auditor:** Claude Code (rol: arquitecto principal NugaCore)  
**Alcance:** dominio `router-enrollment`, integraciones WG Manager / RouterOS Templates / Worker, RBAC backend+frontend, seguridad de secretos, persistencia, riesgos operativos.

---

## Resumen ejecutivo

La implementación de Fase 4.7 es **funcionalmente correcta** para el flujo feliz y cumple las restricciones críticas del mandato (sin commit mode, sin ejecución real de comandos, script jamás persistido, Worker solo lectura). Sin embargo se identificaron **2 bugs altos** que producirían comportamientos incorrectos en operación real y que deben corregirse antes de Hermes.

---

## 1. Hallazgos críticos

*No se encontraron hallazgos que causen pérdida de datos, exposición de secretos en logs, bypass de RBAC, o ejecución de comandos en routers reales.*

---

## 2. Hallazgos altos

### H-1 — Router huérfano cuando `buildScript` falla (sin rollback)

**Archivo:** [backend/domains/router-enrollment/service.ts](backend/domains/router-enrollment/service.ts#L124-L144)

El método `start()` empuja el router al store **antes** del `await buildScript(...)`:

```typescript
// Línea 124-141: el push es síncrono
store.MIKROTIK_ROUTERS.push({ id: routerId, ..., provisioningStatus: 'pending' });

// Línea 143-144: este await puede fallar
const { script, ... } = await buildScript(routerId, input, actorId);
```

Si `buildScript` lanza una excepción (pool IPAM agotado, servidor WG no encontrado, error de cifrado), el router queda en `store.MIKROTIK_ROUTERS` con `provisioningStatus: 'pending'` pero sin enrollment asociado. **No existe rollback.** El router huérfano ocupa un ID (`mkt-N`) y confunde el estado del inventario.

**Impacto:** En memoria (Fase 0) el efecto es cosmético. En producción con Supabase, el router quedaría en la tabla de routers sin posibilidad de enrollment (el mismo `routerId` no puede ser re-usado por el IPAM del store).

**Corrección mínima:**
```typescript
// Mover el push DESPUÉS del await exitoso
const { script, ... } = await buildScript(routerId, input, actorId);
store.MIKROTIK_ROUTERS.push({ id: routerId, ... });  // solo si buildScript tuvo éxito
```

---

### H-2 — `routerosVersion` hardcodeada como `'7'` en `download()`

**Archivo:** [backend/domains/router-enrollment/service.ts](backend/domains/router-enrollment/service.ts#L205-L214)

El método `download()` re-genera el script reconstruyendo el input desde el store, pero usa `routerosVersion: '7'` literalmente:

```typescript
const input: StartEnrollmentInput = {
  routerName: router.name,
  routerosVersion: '7',          // ← BUG: hardcoded
  wgServerId: rec.wgServerId,
  // ...
};
```

`routerosVersion` no se persiste en `RouterEnrollmentRecord` ni en `MikrotikRouterRegistryItem`. Si el técnico enrolló con RouterOS 6, la re-descarga genera un script con sintaxis de RouterOS 7 → **script incompatible con el equipo real**.

**Impacto:** Cualquier router MikroTik con RouterOS 6 que re-descargue el script recibirá un archivo con comandos incompatibles, sin advertencia.

**Corrección mínima:** Añadir `routerosVersion: '6' | '7'` al `RouterEnrollmentRecord` y persistirlo en `start()`.

---

### H-3 — `vpnIp` del router no se actualiza al crear el enrollment

**Archivo:** [backend/domains/router-enrollment/service.ts](backend/domains/router-enrollment/service.ts#L125-L141)

`MikrotikRouterRegistryItem` tiene el campo opcional `vpnIp?: string`, pero en `start()` no se rellena:

```typescript
store.MIKROTIK_ROUTERS.push({
  id: routerId,
  connectionType: 'wireguard',
  // vpnIp no se asigna aquí
});
```

La IP VPN asignada por IPAM (`wgAssignedIp`) se devuelve al cliente pero no se persiste en el registro del router. Si otro módulo consulta el router por ID y necesita su VPN IP, no la encontrará.

**Corrección:** Añadir `vpnIp: routerIpWithoutMask` en el push, antes o después del await (ver H-1).

---

## 3. Hallazgos medios

### M-1 — Estado `draft` es código muerto en el flujo

**Archivos:** [backend/domains/router-enrollment/types.ts](backend/domains/router-enrollment/types.ts#L8), [supabase/migrations/20260612000000_router_enrollment.sql](supabase/migrations/20260612000000_router_enrollment.sql#L26)

El estado `draft` existe en `EnrollmentStatus`, en `ENROLLMENT_STATUS_LABELS` y en el `CHECK` de SQL, pero el servicio crea enrollments directamente en `script_generated`. No hay ruta para llegar a `draft`.

**Impacto:** Técnico menor: el tipo union y la migración incluyen un estado que nunca ocurre. Si en una fase futura se añade un flujo "guardar borrador", no hay problema. Si no, es ruido.

---

### M-2 — Sin límite de frecuencia en `POST /:id/check-online`

**Archivo:** [backend/domains/router-enrollment/routes.ts](backend/domains/router-enrollment/routes.ts#L80-L88)

No hay rate-limiting por enrollment ID. Un cliente que llame al endpoint 11 veces en 1 segundo transitará el enrollment a `failed` sin dar al técnico tiempo real de importar el script. En staging el Worker devuelve `null` (sin router real), así que cada llamada incrementa `checkOnlineAttempts`.

**Impacto:** En staging/demo puede agotar los intentos accidentalmente. En producción, un poll agresivo desde el frontend puede marcar un enrollment como fallido cuando el router sí fue importado pero el Worker aún no tiene conectividad.

**Recomendación:** Añadir un cooldown mínimo de 30s entre intentos (en servicio, no en middleware).

---

### M-3 — `revokedBy` no aparece en `RouterEnrollmentView`

**Archivos:** [backend/domains/router-enrollment/types.ts](backend/domains/router-enrollment/types.ts#L47-L66)

`RouterEnrollmentRecord` tiene `revokedBy?: string`, pero `RouterEnrollmentView` no lo expone:

```typescript
export interface RouterEnrollmentView {
  // ...
  revokedAt?: string;
  // revokedBy: ausente
}
```

El endpoint `POST /:id/revoke` devuelve `toView(updated!)`. El actor de la revocación no es visible vía API sin leer el record interno.

**Recomendación:** Añadir `revokedBy?: string` a `RouterEnrollmentView` y a `toView()`.

---

### M-4 — `apiUsername` del script no se incluye en la respuesta del enrollment

**Archivo:** [backend/domains/routeros-templates/generator.ts](backend/domains/routeros-templates/generator.ts#L287-L315)

La plantilla `router_base_wireguard` genera credenciales API (`generateApiCredential(routerName)`) e incrusta el usuario y password en el script. El `apiUsername` se devuelve en `TemplateGeneratedResource` pero el servicio de enrollment no lo expone en `StartEnrollmentResult`.

El administrador que quiera conectarse vía API al router recién enrolado no sabe el nombre del usuario API creado, a menos que descargue y lea el script.

---

### M-5 — Sin paginación en `GET /api/router-enrollment`

**Archivo:** [backend/domains/router-enrollment/routes.ts](backend/domains/router-enrollment/routes.ts#L39-L45)

`enrollmentService.list()` devuelve todos los registros. En un WISP con cientos de routers enrolados (activos + fallidos + revocados), la respuesta puede ser muy grande.

**Recomendación:** Añadir `?limit=50&offset=0` como parámetros opcionales con valor por defecto.

---

## 4. Hallazgos bajos

### B-1 — `wgManagementCidr` y `wgVpnCidr` son el mismo valor en `buildScript`

```typescript
wgManagementCidr: peerConfig.allowedCidr,
wgVpnCidr: peerConfig.allowedCidr,
```

El generador tiene campos separados para ambos CIDRs, pero el enrollment los pasa iguales. Puede ser correcto para el caso de uso inicial (la red de gestión es la VPN), pero no está documentado como decisión de diseño.

---

### B-2 — Inconsistencia entre `requireRoles` (401) y el comportamiento observado (403)

**Archivo:** [backend/common/rbac.ts](backend/common/rbac.ts#L21-L37)

`requireRoles` devuelve **401** si no hay `authContext` y **403** si el rol no tiene permiso. En dev con trusted-headers, una request sin `x-user-role` recibe `DEFAULT_ROLE = 'solo lectura'`, que existe en el authContext, así que el middleware devuelve 403. Pero si `allowTrustedHeaders = false` (staging con Supabase parcialmente configurado), el comportamiento cambiaría a 401.

Los tests de contrato esperan 403 para "sin role header", lo cual es correcto en dev pero podría fallar en ciertos entornos de staging.

---

### B-3 — `nextId()` del repositorio no es estrictamente secuencial bajo concurrencia

**Archivo:** [backend/domains/router-enrollment/repository.ts](backend/domains/router-enrollment/repository.ts#L12-L18)

`nextId()` incrementa `_counter` y luego llama a `enrollmentRepository.nextId()` fuera del `create()`. Si dos requests hacen `nextId()` antes de que alguna haga `create()`, ambas pueden obtener el mismo ID. Dado que Node.js es single-threaded y el `await` está entre `nextId()` y `create()` en el servicio, este escenario es teóricamente posible bajo carga concurrente alta.

**Impacto:** Bajo en Fase 0 (probabilidad muy baja). En Supabase con clave primaria única, uno de los dos inserts fallaría con error de base de datos.

---

### B-4 — Limpieza del script en el router borra el archivo antes de confirmar éxito

**Archivo:** [backend/domains/routeros-templates/generator.ts](backend/domains/routeros-templates/generator.ts#L169-L173)

`sectionFileCleanup()` genera:
```routeros
:delay 2
/file remove [find name~"nugacore-tpl-"]
```

Si el script se interrumpe antes de llegar a la sección de limpieza (error de sintaxis en el router, importación parcial), el archivo NO se elimina. Si llega a la limpieza pero la configuración fue incompleta, el archivo desaparece sin que el técnico pueda re-importarlo. Debe volver a descargar.

**Impacto:** Molestia operativa; no compromete seguridad porque el técnico puede re-descargar via API.

---

## 5. Riesgos para producción

| # | Riesgo | Prob. | Impacto | Vector |
|---|--------|-------|---------|--------|
| R-1 | Router huérfano en store/DB si buildScript falla | Media | Medio | Pool IPAM agotado o WG server deleted |
| R-2 | Script de re-descarga incompatible con RouterOS 6 | Alta (si hay ROS6) | Alto | routerosVersion hardcodeada |
| R-3 | Enrollment agotado en attempts por poll agresivo | Media | Medio | UI con polling automático sin cooldown |
| R-4 | Pool IPAM de WG se agota sin alerta | Baja | Alto | createPeer lanza `throw new Error('WireGuard IP pool exhausted')` — propagado como 500, no como 400 |
| R-5 | Dos enrollments activos para el mismo router físico | Media | Medio | No hay validación de unicidad por routerName/IP |
| R-6 | Peer WG revocado pero enrollment queda en otro estado si revokePeer falla silenciosamente | Baja | Medio | `revokePeer` devuelve `false` si peer no existe; enrollment se marca revocado de igual forma (correcto) |

---

## 6. Cambios obligatorios antes de Hermes

### FIX-1 — Mover el `store.push()` después del `await buildScript()` *(H-1)*

**Archivo:** [backend/domains/router-enrollment/service.ts](backend/domains/router-enrollment/service.ts)

```typescript
// ANTES (línea 124-144):
const routerId = store.getUniqueMikrotikRouterId();
store.MIKROTIK_ROUTERS.push({ id: routerId, ... });   // push antes del await
const { script, ... } = await buildScript(...);        // puede fallar

// DESPUÉS:
const routerId = store.getUniqueMikrotikRouterId();
const { script, ... } = await buildScript(routerId, input, actorId); // await primero
store.MIKROTIK_ROUTERS.push({                          // push solo si éxito
  id: routerId,
  vpnIp: wgAssignedIp,                                // también resuelve H-3
  ...
});
```

**Precaución:** `buildScript` necesita `routerId` para crear el peer WG (`getPeerConfigForRouter(routerId, ...)`). El `routerId` se puede pre-calcular igual; solo el `push` al store debe ser posterior.

---

### FIX-2 — Persistir `routerosVersion` en el enrollment record *(H-2)*

**Paso 1 — Añadir campo al tipo:**
```typescript
// types.ts - RouterEnrollmentRecord
routerosVersion: '6' | '7';
```

**Paso 2 — Persistir en `start()`:**
```typescript
const rec: RouterEnrollmentRecord = {
  ...
  routerosVersion: input.routerosVersion,  // añadir
};
```

**Paso 3 — Usar en `download()`:**
```typescript
const input: StartEnrollmentInput = {
  routerName: router.name,
  routerosVersion: rec.routerosVersion,   // en lugar de '7'
  ...
};
```

**Paso 4 — Añadir al `RouterEnrollmentView` si se quiere exponer:**
```typescript
routerosVersion: '6' | '7';
```

---

## 7. Cambios recomendados

### REC-1 — Añadir `vpnIp` al push del store

Ya cubierto parcialmente por FIX-1. Añadir `vpnIp: wgAssignedIp` al objeto del router en el store para que otros módulos puedan consultar la IP VPN del router por su ID.

---

### REC-2 — Exponer `revokedBy` en `RouterEnrollmentView` *(M-3)*

```typescript
// types.ts - RouterEnrollmentView
revokedAt?: string;
revokedBy?: string;    // añadir

// service.ts - toView()
revokedAt: rec.revokedAt,
revokedBy: rec.revokedBy,    // añadir
```

---

### REC-3 — Cooldown mínimo entre check-online attempts *(M-2)*

En `checkOnline()`, antes de llamar al Worker, verificar si `lastCheckAt` fue hace menos de N segundos:

```typescript
const COOLDOWN_SECONDS = 30;
if (rec.lastCheckAt) {
  const elapsed = (Date.now() - new Date(rec.lastCheckAt).getTime()) / 1000;
  if (elapsed < COOLDOWN_SECONDS) {
    return { enrollment: toView(rec), isOnline: false,
             message: `Esperar ${Math.ceil(COOLDOWN_SECONDS - elapsed)}s antes del próximo intento.` };
  }
}
```

---

### REC-4 — Retornar `apiUsername` en `StartEnrollmentResult` *(M-4)*

El generador ya devuelve `apiUsername`. Propagarlo:
```typescript
// service.ts - buildScript return
apiUsername: resource.apiUsername,

// types.ts - StartEnrollmentResult
apiUsername?: string;   // usuario API creado en el router
```

---

### REC-5 — Validar unicidad de enrollment activo por `routerName` + `wgServerId`

En `start()`, antes de crear el router, verificar si ya existe un enrollment activo (no revocado, no fallido) para el mismo nombre de router + servidor WG. Si existe, advertir al actor:

```typescript
const existing = enrollmentRepository.list().find(
  r => r.wgServerId === input.wgServerId &&
       r.status !== 'revoked' && r.status !== 'failed'
);
// Logear advertencia, no bloquear (el admin puede querer un segundo enrollment)
```

---

### REC-6 — Eliminar estado `draft` o implementarlo *(M-1)*

Si no hay plan de uso para `draft`, eliminar del tipo union, del `ENROLLMENT_STATUS_LABELS` y del `CHECK` SQL en la migración para evitar confusión. Si se planea usar en una fase futura, documentarlo en el audit doc.

---

## 8. Verificación de dependencias circulares

```
router-enrollment/service.ts
  → wireguard/service.ts              ✓ (dominio independiente)
  → routeros-templates/generator.ts   ✓ (dominio independiente)
  → mikrotik/worker/worker.ts         ✓ (dominio independiente, solo readRouterSnapshot)
  → state/store.ts                    ✓ (singleton global, sin back-reference)
  → router-enrollment/repository.ts   ✓ (sin imports de service)
  → common/errors.ts                  ✓

router-enrollment/routes.ts
  → router-enrollment/service.ts      ✓
  → common/errors.ts                  ✓
  → common/rbac.ts                    ✓
```

**No se detectaron dependencias circulares.**

---

## 9. Verificación de fugas de secretos

| Punto | Verificación | Estado |
|-------|-------------|--------|
| `logger.info` en `buildScript` | Solo loguea `routerId`, `peerId`, `scriptHash`, `filename` | ✓ Seguro |
| `logger.info` en `start()` | Solo loguea `enrollmentId`, `routerId`, `wgPeerId` | ✓ Seguro |
| `logger.info` en `download()` | Solo loguea `enrollmentId` | ✓ Seguro |
| `logger.info` en `revoke()` | Solo loguea `enrollmentId`, `routerId`, `wgPeerId`, `revokedBy` | ✓ Seguro |
| `RouterEnrollmentView` | Sin campos `script`, `privateKey`, `presharedKey` | ✓ Seguro |
| `toView()` | No copia ningún campo de secretos del record | ✓ Seguro |
| Respuesta de `GET /` y `GET /:id` | Devuelven `RouterEnrollmentView` | ✓ Seguro |
| Respuesta de `GET /:id/download` | Envía el script como `text/plain` con `Cache-Control: no-store` | ✓ Seguro |
| `peerConfig.privateKey` | Solo llega hasta `generateFromTemplate()`, nunca a los logs | ✓ Seguro |
| WireGuard Manager `getPeerConfigForRouter` | Descifra AES-256-GCM in-memory, no loguea claves | ✓ Seguro |

---

## 10. Verificación de RBAC

### Backend

| Endpoint | Roles permitidos | Roles bloqueados | Código correcto |
|----------|-----------------|-----------------|-----------------|
| POST /start | super admin, administrador, tecnico | cobranza, soporte, solo lectura | ✓ |
| GET / | super admin, administrador, tecnico | cobranza, soporte, solo lectura | ✓ |
| GET /:id | super admin, administrador, tecnico | cobranza, soporte, solo lectura | ✓ |
| GET /:id/download | super admin, administrador, tecnico | cobranza, soporte, solo lectura | ✓ |
| POST /:id/check-online | super admin, administrador, tecnico | cobranza, soporte, solo lectura | ✓ |
| POST /:id/revoke | super admin, administrador | tecnico, cobranza, soporte, solo lectura | ✓ |

### Frontend

| Rol | Acceso a `router-enrollment` | Acceso a `routeros-templates` |
|-----|------------------------------|-------------------------------|
| Super Admin | ✓ | ✓ |
| Administrador | ✓ | ✓ |
| Técnico | ✓ | ✓ |
| Cobranza | ✗ | ✗ |
| Soporte | ✗ | ✗ |
| Solo lectura | ✗ | ✗ |

RBAC consistente entre backend y frontend.

---

## 11. Verificación de IPAM WireGuard

La función `nextFreeIp()` en [backend/domains/wireguard/ipam.ts](backend/domains/wireguard/ipam.ts) es pura, determinística y correctamente auditada en Fase 4.6.1. Comportamiento bajo enrollment:

- IP `10.70.0.1` reservada para el servidor → nunca asignada a peer.
- Asignación secuencial desde `10.70.0.2` en adelante.
- Al revocar: `updateAllocation(allocId, { status: 'released' })` → IP disponible para reutilización.
- Al re-enrollment: `getPeerConfigForRouter` con mismo `routerId + serverId` reutiliza el peer existente (si está `active`); si fue revocado, crea un nuevo peer con nueva IP.

**Sin problemas de IPAM detectados** en el flujo implementado.

---

## 12. Verificación de concurrencia

Node.js es single-threaded con event loop. Las secciones síncronas son atómicas entre requests. Los riesgos de concurrencia son solo en las brechas entre `await`:

| Sección | ¿Hay brecha de await? | Riesgo |
|---------|----------------------|--------|
| `getUniqueMikrotikRouterId()` + `push()` | No — ambos síncronos consecutivos | ✓ Sin riesgo |
| `nextId()` + `create()` | Sí — `await buildScript()` entre ambos | Teórico: dos requests podrían obtener el mismo `enr-N` |
| `getById()` + `update()` en checkOnline | Sí — `await readRouterSnapshot()` entre ambos | Teórico: doble actualización concurrent |

El riesgo en `nextId() → await → create()` está catalogado en B-3. En la práctica, la probabilidad de que dos técnicos enrollen exactamente al mismo millisegundo es despreciable en Fase 0.

---

## 13. Cobertura de tests

| Escenario | Test unitario | Test contrato |
|-----------|---------------|---------------|
| RBAC: roles permitidos/bloqueados | `enrollmentRbac.test` | `router.enrollment.contract.test` |
| POST /start → 201, sin secretos en view | — | ✓ |
| Script primera línea `# NugaCore` | — | ✓ |
| scriptHash 32 chars hex | — | ✓ |
| Download: cabeceras Cache-Control, Content-Disposition | — | ✓ |
| check-online incrementa attempts | — | ✓ |
| Revoke: Técnico 403, Admin 200 | — | ✓ |
| Revoke doble → 400 | — | ✓ |
| Download post-revoke → 400 | — | ✓ |
| routerosVersion hardcoded (BUG H-2) | ✗ No cubierto | ✗ No cubierto |
| Router huérfano si buildScript falla | ✗ No cubierto | ✗ No cubierto |

Los dos bugs altos (H-1, H-2) no tienen cobertura de tests, lo que explica por qué pasaron los 35 tests de contrato.

---

## 14. Veredicto

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   REQUIERE CORRECCIONES (2 bloqueantes)                         │
│                                                                 │
│   Corrección obligatoria antes de validación Hermes:           │
│                                                                 │
│   FIX-1: Mover store.push() DESPUÉS del await buildScript()    │
│           → elimina router huérfano                            │
│                                                                 │
│   FIX-2: Persistir routerosVersion en EnrollmentRecord         │
│           → corrige script incorrecto en re-descarga para ROS6 │
│                                                                 │
│   Una vez aplicados FIX-1 y FIX-2, la implementación puede     │
│   proceder a validación Hermes. Las correcciones REC-1 a REC-6  │
│   son recomendadas pero no bloquean staging.                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Fortalezas confirmadas

- Restricciones críticas del mandato: 100% cumplidas (sin commit mode, sin comandos reales, script jamás persistido, Worker read-only).
- Seguridad de secretos: sin fugas detectadas en logs ni en respuestas API.
- RBAC backend y frontend: consistentes y correctamente implementados.
- IPAM WireGuard: correcto, con reutilización de IPs liberadas.
- Tests: 57 tests nuevos cubren el flujo feliz y los casos de error principales.
- Integración con WG Manager y RouterOS Templates: sin modificar sus internos.
- Dependencias circulares: ninguna.

---

*Documento generado por auditoría arquitectónica automatizada. Verificar hallazgos en el contexto del plan de release antes de aplicar correcciones.*
