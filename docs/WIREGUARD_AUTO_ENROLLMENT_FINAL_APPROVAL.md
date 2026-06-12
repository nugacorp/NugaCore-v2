# WireGuard Auto Enrollment — Validación Final Fase 4.7

Fecha UTC: 2026-06-12T20:46:45Z

Commit solicitado: `65c1359 fix(router-enrollment): use default WireGuard server and complete start contract`

Commit desplegado/validado en staging: `65c135993dbb6c6a361a0b660190d15554e1654a`

Resultado final: **NO APROBADO**

> Alcance: validación exclusiva en staging. No se importaron scripts en MikroTik, no se ejecutaron scripts, no se activó commit mode, no se activó `MIKROTIK_WORKER_LIVE`, no se tocaron routers reales y no se documentan secretos ni scripts completos.

## Resumen ejecutivo

La validación confirma que la arquitectura de **Single WireGuard Server**, el uso de **Default WireGuard Server**, la persistencia de `router.vpnIp`, el manejo de `wgServerId` inexistente, `check-online` con modo live apagado y la revocación funcionan en staging.

Sin embargo, la Fase 4.7 **no se aprueba** porque el bloqueador 1 no cumple literalmente el contrato solicitado para `scriptPreview`: el preview está saneado con `[REDACTED]`, pero todavía contiene los nombres de asignación `private-key=` y `password=`. El criterio solicitado decía confirmar que `scriptPreview` **NO contiene** esos patrones.

## 1. Staging

Repositorio local `/opt/nugacore-staging` actualizado a `main`.

Validaciones:

| Criterio | Resultado |
| --- | --- |
| `main` contiene `65c1359` | PASS |
| HEAD local | `65c135993dbb6c6a361a0b660190d15554e1654a` |
| Contenedor staging | healthy |
| Imagen activa | `zmjc5lnl0wj3kh0uj14s2p4i:65c135993dbb6c6a361a0b660190d15554e1654a` |
| `MIKROTIK_WORKER_LIVE` | `false` |
| `NODE_ENV` | `staging` |

Healthchecks:

| Endpoint | HTTP |
| --- | --- |
| `GET /api/health` | 200 |
| `GET /api/health/live` | 200 |
| `GET /api/health/ready` | 200 |

Checks locales ejecutados antes de API staging:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 40 archivos PASS, 583 tests PASS, 6 archivos/34 tests skipped |
| `npm run build` | PASS |

## 2. Bloqueador 1 — `scriptPreview`

Endpoint:

```http
POST /api/router-enrollment/start
```

RouterOS: `7`.

Resultado HTTP: `201`.

Validaciones:

| Criterio | Resultado |
| --- | --- |
| `scriptPreview` presente | PASS |
| contiene `[REDACTED]` | PASS |
| `public-key` permanece visible | PASS |
| no contiene `preshared-key=` | PASS |
| no contiene `private-key=` | **FAIL** |
| no contiene `password=` | **FAIL** |

Observación segura: el preview no expuso valores de secretos; los valores sensibles aparecieron redactados como `[REDACTED]`. El fallo es contractual/literal: el string `private-key=` y el string `password=` siguen presentes dentro del preview.

Resultado bloqueador 1: **FAIL**.

## 3. Bloqueador 2 — aliases top-level

Endpoint:

```http
POST /api/router-enrollment/start
```

Resultado HTTP: `201`.

Campos top-level requeridos:

| Campo | Resultado |
| --- | --- |
| `enrollmentId` | PASS |
| `peerId` | PASS |
| `assignedIp` | PASS |
| `filename` | PASS |
| `scriptHash` | PASS |
| `scriptPreview` | PASS |
| `securityNotice` | PASS |

Compatibilidad confirmada:

| Campo compatible | Resultado |
| --- | --- |
| `enrollment.id` | PASS |
| `wgPeerId` | PASS |
| `wgAssignedIp` | PASS |
| `scriptFilename` | PASS |
| `securityWarning` | PASS |

Resultado bloqueador 2: **PASS**.

## 4. Bloqueador 3 — `wgServerId` inexistente

Endpoint:

```http
POST /api/router-enrollment/start
```

Caso: `wgServerId` inexistente.

Resultado observado:

| Criterio | Resultado |
| --- | --- |
| HTTP 400/404 controlado | PASS — HTTP 404 |
| no HTTP 500 | PASS |
| no router creado | PASS |
| no enrollment creado | PASS |
| no peer creado | PASS |

Resultado bloqueador 3: **PASS**.

## 5. Bloqueador 4 — `check-online` simulated

Condición verificada en contenedor:

```text
MIKROTIK_WORKER_LIVE=false
```

Endpoint:

```http
POST /api/router-enrollment/:id/check-online
```

Resultado observado:

| Criterio | Resultado |
| --- | --- |
| HTTP 200 | PASS |
| `snapshotSource=simulated` | PASS |
| `isOnline=false` | PASS |
| `status=waiting_for_router` | PASS |
| no cambia a `online` | PASS |

Resultado bloqueador 4: **PASS**.

## 6. Default WireGuard Server

Se creó en staging un servidor WireGuard default ficticio para la validación segura.

Resultado:

| Criterio | Resultado |
| --- | --- |
| exactamente un servidor `isDefault=true` activo | PASS |
| enrollment sin `wgServerId` creado | PASS |
| peer creado | PASS |
| servidor default reutilizado | PASS |
| no se creó servidor adicional al omitir `wgServerId` | PASS |

Resultado: **PASS**.

## 7. Single Server Architecture

Se crearon enrollments ficticios de prueba en staging.

Resultado intermedio antes de limpieza:

| Métrica | Valor |
| --- | --- |
| servidores WireGuard | 1 |
| enrollments creados en la prueba | 6 |
| peers creados en la prueba | 6 |
| routers ficticios creados en la prueba | 6 |
| `vpnIp` distintas observadas | >= 5 |

Validaciones:

| Criterio | Resultado |
| --- | --- |
| un solo servidor WireGuard | PASS |
| mínimo 5 peers | PASS |
| mínimo 5 `vpnIp` distintas | PASS |
| no se crean servidores adicionales | PASS |

Resultado: **PASS**.

## 8. VPN IP

Validación sobre router ficticio creado por enrollment:

| Criterio | Resultado |
| --- | --- |
| `router.vpnIp` almacenada | PASS |
| `router.vpnIp = assignedIp` | PASS |

Resultado: **PASS**.

## 9. Revocación

Endpoint:

```http
POST /api/router-enrollment/:id/revoke
```

Resultado observado:

| Criterio | Resultado |
| --- | --- |
| HTTP 200 | PASS |
| enrollment revocado | PASS |
| peer revocado | PASS |
| servidor WG permanece | PASS |
| servidor default sigue activo | PASS |

Resultado: **PASS**.

## 10. Limpieza

Limpieza API best-effort:

| Artefacto | Resultado |
| --- | --- |
| routers ficticios creados | eliminados por `DELETE /api/mikrotik/routers/:id` |
| peers ficticios activos | revocados; activos restantes = 0 |
| enrollments ficticios | revocados; no existe endpoint público de delete |

Como los enrollments y servidores WireGuard de esta fase usan store en memoria en staging, se reinició el contenedor staging para limpiar los artefactos no eliminables por API pública.

Conteos finales post-reinicio:

| Recurso | Conteo final |
| --- | --- |
| WireGuard servers | 0 |
| WireGuard peers | 0 |
| router enrollments | 0 |
| routers de prueba Fase 4.7 | 0 |

Healthchecks post-limpieza:

| Endpoint | HTTP |
| --- | --- |
| `GET /api/health` | 200 |
| `GET /api/health/live` | 200 |
| `GET /api/health/ready` | 200 |

## Resultado final

| Requisito | Estado |
| --- | --- |
| 4 bloqueadores originales pasan | **FAIL** — bloqueador 1 falla por contrato literal de `scriptPreview` |
| Single WireGuard Server validado | PASS |
| Default WireGuard Server validado | PASS |
| VPN IP persistida | PASS |
| Revocación correcta | PASS |
| Healthchecks OK | PASS |
| Sin routers reales | PASS |
| Sin scripts ejecutados | PASS |
| Sin secretos expuestos | PASS |
| Limpieza staging | PASS |

## Decisión

❌ **FASE 4.7 NO APROBADA**

Acción correctiva recomendada:

- Ajustar `scriptPreview` para que no incluya literalmente los patrones `private-key=`, `preshared-key=` ni `password=`. Una opción segura es reemplazar la línea/fragmento completo por un comentario o marcador que no conserve el nombre del parámetro sensible, manteniendo visible únicamente información no secreta como `public-key`.
