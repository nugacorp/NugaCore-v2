# WireGuard Auto Enrollment — Staging Validation Result

Fecha: 2026-06-12T19:23:14Z

Commit validado: `b683867 fix(router-enrollment): prevent orphan routers and preserve routeros version`

Resultado final: **NO APROBADO**

> Validación ejecutada en staging. No se importaron scripts en MikroTik real, no se activó commit mode, no se ejecutaron suspensiones reales y no se cambió configuración de red. No se documentan secretos ni scripts completos.

## 1. Actualización de staging

Comandos ejecutados en `/opt/nugacore-staging`:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Confirmado en `git log --oneline -10`:

```text
b683867 fix(router-enrollment): prevent orphan routers and preserve routeros version
84f6439 feat(router-enrollment): add WireGuard auto enrollment workflow
4d5e648 docs(routeros): approve templates library phase 4.6.3
cee74d0 docs(routeros): approve templates library phase 4.6.3
8157005 fix(routeros): close templates staging blockers
60e2e26 docs(routeros): update templates staging validation
6681aaa docs(routeros): validate templates library staging
f067a49 feat(routeros): add RouterOS Templates Library (Fase 4.6.3)
13c23f6 feat(routeros): integrate WireGuard Manager into resource generator
5ffa76a feat(routeros): add resource generator and base WISP WireGuard template
```

## 2. Redeploy Coolify y healthchecks

Redeploy ejecutado en Coolify.

Contenedor desplegado:

```text
zmjc5lnl0wj3kh0uj14s2p4i:b683867eac9ffb70b5c44f3b604a7e38d5240cae ... Up ... (healthy)
```

Healthchecks:

| Endpoint | Resultado |
| --- | --- |
| `GET /api/health` | HTTP 200 |
| `GET /api/health/live` | HTTP 200 |
| `GET /api/health/ready` | HTTP 200 |

## 3. Tests

Comandos ejecutados:

```bash
npm run typecheck
npm test
npm run build
```

Resultado:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS |
| `npm run build` | PASS |

## 4. Seguridad operacional previa

Se verificó que `MIKROTIK_WORKER_LIVE=false` en el contenedor antes de validar `check-online`.

No se importó ningún `.rsc` en RouterOS real.
No se activó modo live.
No se ejecutaron comandos destructivos contra routers reales.

## 5. RBAC API

### Roles permitidos para start/list/get/download/check-online

| Rol | Resultado |
| --- | --- |
| Super Admin | PASS |
| Admin | PASS en endpoints validables; una re-prueba aislada falló por estado/artefacto de prueba, no por RBAC |
| Técnico | PASS para start/list/get/check-online; revoke devolvió 403 como esperado |

Nota: para `download`, el endpoint es de un solo uso condicionado por estado del enrollment; una ejecución posterior sobre el mismo enrollment puede devolver 400/404 si ya fue descargado/revocado/limpiado. Con enrollment fresco, `GET /api/router-enrollment/:id/download` devolvió HTTP 200.

### Roles bloqueados

| Rol | start | list | get | download | check-online | revoke |
| --- | --- | --- | --- | --- | --- | --- |
| Cobranza | 403 | 403 | 403 | 403 | 403 | 403 |
| Soporte | 403 | 403 | 403 | 403 | 403 | 403 |
| Solo lectura | 403 | 403 | 403 | 403 | 403 | 403 |

## 6. Servidor WireGuard test

Se creó/reutilizó un servidor WireGuard de staging para la validación con estos parámetros no sensibles:

```json
{
  "name": "WG Enrollment Staging Test",
  "endpointHost": "vpn-staging.nugacore.test",
  "endpointPort": 13231,
  "vpnCidr": "10.70.0.0/16"
}
```

No se imprimió la `serverPrivateKey`.

Después de la limpieza final y redeploy, los servidores WireGuard test en memoria quedaron en 0.

## 7. Start enrollment RouterOS 7

Endpoint:

```http
POST /api/router-enrollment/start
```

Body no sensible usado:

```json
{
  "routerName": "Hermes Enrollment ROS7 Test",
  "routerType": "chr",
  "wgServerId": "<serverId>",
  "templateId": "router_base_wireguard",
  "routerosVersion": "7",
  "lanCidr": "192.168.77.0/24",
  "lanGateway": "192.168.77.1",
  "wanInterface": "ether1",
  "lanInterfaces": ["ether2", "ether3"],
  "notes": "staging validation only"
}
```

Resultado HTTP: 201.

Validaciones PASS:

- `enrollmentId` presente, vía `enrollment.id`.
- `routerId` presente.
- `peerId` presente, vía `wgPeerId`.
- `assignedIp` presente, vía `wgAssignedIp`.
- `scriptHash` presente.
- `scriptFilename` termina en `.rsc`.
- `securityWarning` presente.
- `script` presente solo en respuesta inicial.
- Primera línea del script: `# NugaCore`.
- Script contiene `NugaCoreWG`.
- Script contiene `WireGuard`.
- Script contiene la IP asignada.
- Script contiene endpoint host/port.
- Script no contiene strings legacy: `livaur`, `wisphub`, `uisp`, `sgcm`, `whmcs`.

Validación FAIL:

- La respuesta no incluye `scriptPreview`.
- La respuesta usa nombres `enrollment.id`, `wgPeerId`, `wgAssignedIp`, `scriptFilename`, `securityWarning`; el contrato solicitado esperaba campos exactos `enrollmentId`, `peerId`, `assignedIp`, `filename`, `securityNotice`.

## 8. Download enrollment

Endpoint:

```http
GET /api/router-enrollment/:id/download
```

Resultado con enrollment fresco: HTTP 200.

Validaciones PASS:

- `Content-Type` contiene `text/plain`.
- `Content-Disposition` contiene `attachment`.
- `Cache-Control` contiene `no-store`.
- Primera línea exacta: `# NugaCore`.
- Contiene `NugaCoreWG`.
- Contiene la misma IP asignada.
- `scriptDownloadedAt` queda marcado en `GET /api/router-enrollment/:id`.

No se imprimió el script completo ni claves privadas.

## 9. Preservación de routerosVersion

### RouterOS 6

- `POST /api/router-enrollment/start`: HTTP 201.
- `GET /api/router-enrollment/:id` devuelve `routerosVersion="6"`.
- Download devuelve script con header/marker compatible con v6.
- No descarga script hardcodeado v7.

Resultado: PASS.

### RouterOS 7

- `POST /api/router-enrollment/start`: HTTP 201.
- `GET /api/router-enrollment/:id` devuelve `routerosVersion="7"`.
- Download devuelve script v7.

Resultado: PASS.

## 10. Fix router huérfano

Caso probado:

```http
POST /api/router-enrollment/start
```

con `wgServerId` inexistente.

Resultado observado:

- HTTP 500.
- Conteo de routers sin cambios.
- Conteo de enrollments sin cambios.
- Conteo de peers sin cambios.

Resultado: **FAIL parcial**.

El fix evita artefactos huérfanos, pero el contrato esperado pedía HTTP 400/404 controlado. El endpoint devuelve 500.

Acción correctiva recomendada: capturar el error de servidor WireGuard inexistente en `router-enrollment`/`wireguard` y mapearlo a `BadRequestError` o `NotFoundError` para devolver HTTP 400/404 sin stack/error genérico.

## 11. Check online read-only

Endpoint:

```http
POST /api/router-enrollment/:id/check-online
```

Con `MIKROTIK_WORKER_LIVE=false`.

Resultado observado:

- HTTP 200.
- `checkOnlineAttempts` incrementó.
- No hubo HTTP 500.
- No se tocaron routers reales.
- `snapshotSource="simulated"`.
- El enrollment pasó a `status="online"` con `isOnline=true` desde fuente simulada.

Resultado: **FAIL**.

Esperado: con live mode OFF, debía quedar `waiting_for_router` o equivalente, no confirmado como online desde fuente simulada.

Acción correctiva recomendada: en `enrollmentService.checkOnline`, no tratar snapshots simulados como confirmación real de online. Solo confirmar `online` si `snapshot.source` indica lectura real/live, o si existe una señal explícita de importación/heartbeat válida.

## 12. Revoke

### Técnico

```http
POST /api/router-enrollment/:id/revoke
```

Resultado: HTTP 403.

PASS.

### Admin

```http
POST /api/router-enrollment/:id/revoke
```

Resultado:

- HTTP 200.
- `status="revoked"`.
- `revokedAt` presente.
- Peer WireGuard pasa a `revoked`.

PASS.

### Doble revoke

Resultado: HTTP 400 controlado.

PASS.

## 13. Secret hygiene

### API list/get

Endpoints validados:

```http
GET /api/router-enrollment
GET /api/router-enrollment/:id
```

Resultado:

- No contienen `script` como campo de primer nivel.
- No contienen `privateKey`.
- No contienen `presharedKey`.
- No contienen `serverPrivateKey`.
- No contienen `passwords`.
- No contienen `tokens`.

PASS.

### Logs recientes

Se revisaron logs recientes del contenedor sin imprimir líneas sensibles.

Patrones buscados:

- `privateKey`
- `presharedKey`
- `serverPrivateKey`
- `service_role`
- `MIKROTIK_CREDENTIALS_KEY`
- JWT-like tokens
- script RouterOS completo / `NugaCoreWG`
- `password`

Resultado:

```text
recent_log_lines=108
forbidden_pattern_match_count=0
```

PASS.

## 14. UI Wizard

No fue posible ejecutar validación browser interactiva porque la herramienta browser local falló al iniciar (`agent-browser` no disponible en el entorno Hermes).

Validación estática realizada sobre bundle desplegado y código fuente:

- Bundle desplegado contiene `Enrollment WireGuard Auto`.
- Bundle desplegado contiene `Nuevo Enrollment WireGuard`.
- Bundle desplegado contiene `Verificar online`.
- Bundle desplegado contiene `Revocar`.
- Bundle desplegado contiene rutas `router-enrollment`.
- Código fuente define flujo de 7 pasos:
  - Paso 1: Datos del router.
  - Paso 2: Servidor WireGuard.
  - Paso 3: Configuración LAN.
  - Paso 4: Generar script.
  - Paso 5: Descargar script.
  - Paso 6: Instrucciones de importación.
  - Paso 7: Confirmar online.
- `src/lib/rbac.ts` permite módulo `router-enrollment` para Super Admin, Administrador y Técnico.
- `src/lib/rbac.ts` no lo habilita para Cobranza, Soporte ni Solo lectura.
- `src/lib/enrollmentRbac.ts` permite iniciar enrollment para Super Admin, Administrador y Técnico.
- `src/lib/enrollmentRbac.ts` permite revoke solo para Super Admin y Administrador.

Resultado: PASS estático, pero **no sustituye** una validación E2E visual real por navegador.

## 15. Limpieza

Acciones ejecutadas:

- Enrollments test revocados o ya revocados.
- Routers test eliminados o ya inexistentes.
- Redeploy final para limpiar stores en memoria.

Confirmación posterior al redeploy:

| Recurso | Conteo | Matches Hermes test |
| --- | ---: | ---: |
| `/api/router-enrollment` | 0 | 0 |
| `/api/wireguard/servers` | 0 | 0 |
| `/api/wireguard/peers` | 0 | 0 |
| `/api/mikrotik/routers` | 3 | 0 |

PASS.

## 16. Bloqueadores

La fase no se aprueba por estos bloqueadores:

1. `POST /api/router-enrollment/start` no devuelve `scriptPreview`.
   - Endpoint: `POST /api/router-enrollment/start`.
   - Error exacto: `scriptPreview_present=false`.
   - Acción correctiva: incluir preview saneado del script en la respuesta inicial, sin claves privadas ni secretos.

2. Contrato de respuesta inicial difiere de lo solicitado.
   - Endpoint: `POST /api/router-enrollment/start`.
   - Error exacto: campos exactos esperados no están en top-level (`enrollmentId`, `peerId`, `assignedIp`, `filename`, `securityNotice`). La API devuelve equivalentes `enrollment.id`, `wgPeerId`, `wgAssignedIp`, `scriptFilename`, `securityWarning`.
   - Acción correctiva: exponer alias top-level compatibles o ajustar contrato/documentación si esta forma es intencional.

3. `wgServerId` inexistente devuelve 500.
   - Endpoint: `POST /api/router-enrollment/start`.
   - Error exacto: HTTP 500; esperado 400/404 controlado.
   - Acción correctiva: mapear servidor WireGuard inexistente a `BadRequestError`/`NotFoundError`.

4. `check-online` confirma online usando fuente simulada con live mode OFF.
   - Endpoint: `POST /api/router-enrollment/:id/check-online`.
   - Error exacto: `status_after="online"`, `isOnline=true`, `snapshotSource="simulated"`.
   - Acción correctiva: no confirmar online desde snapshot simulado; mantener `waiting_for_router` con `MIKROTIK_WORKER_LIVE=false`.

## Resultado final

❌ FASE 4.7 NO APROBADA
