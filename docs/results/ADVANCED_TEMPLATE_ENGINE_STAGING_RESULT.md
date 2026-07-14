# Validación Staging — Fase 4.9.1 Advanced Router Template Engine

Fecha: 2026-06-13
Entorno: staging Coolify
Commit funcional aprobado: `ce65bda882b2eff498f5b0a8c36e8e1167338079`
Resultado final: **APROBADA**

## Alcance

Revalidación final del último bloqueador de Fase 4.9.1: el Router Onboarding Wizard debe conservar la plantilla seleccionada y enviar el `templateId` correcto al backend.

También se ejecutó regresión rápida de los dos bloqueadores ya corregidos y de los flujos principales de Router Enrollment.

Restricciones respetadas:

- No se tocaron routers reales.
- No se importaron scripts `.rsc`.
- No se activó commit mode.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se ejecutó Worker real.
- No se ejecutaron comandos RouterOS.
- No se expusieron secretos ni scripts completos.

## 1. Actualización y redeploy limpio

Repositorio actualizado en `/opt/nugacore-staging` con fast-forward:

- `git fetch origin`
- `git checkout main`
- `git pull --ff-only origin main`

`git log --oneline -10` confirmó:

- `ce65bda fix(router-onboarding): preserve selected template in wizard payload`

Redeploy Coolify:

- Se forzó rebuild/redeploy limpio con commit `ce65bda882b2eff498f5b0a8c36e8e1167338079`.
- Deployment finalizó en estado `finished`.
- Imagen desplegada: `zmjc5lnl0wj3kh0uj14s2p4i:ce65bda882b2eff498f5b0a8c36e8e1167338079`.
- Contenedor: `healthy`.
- Asset JS observado después del redeploy: `assets/index--MYRhluB.js`.

Healthchecks tras deploy:

| Endpoint | Resultado |
| --- | --- |
| `GET /api/health` | 200 |
| `GET /api/health/live` | 200 |
| `GET /api/health/ready` | 200 |

Tras limpieza/restart final, los healthchecks siguieron en 200.

## 2. Tests

Ejecutado en `/opt/nugacore-staging`:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 47 files passed, 6 skipped; 868 tests passed, 34 skipped |
| `npm run build` | PASS |

El build generó asset local `dist/assets/index-DfAqZyyk.js`. El warning de chunk grande de Vite fue informativo y no bloqueante.

## 3. Wizard UI — PCC 5 WAN

Login UI:

- Usuario temporal Super Admin creado para la validación.
- Login exitoso en staging.
- Ruta: `MikroTik Core Control & Copilot` → `Agregar Router`.

Selección:

- Card seleccionada: `Balanceador PCC — 5 WAN`.
- `data-testid`: `template-card-pcc_5wan`.
- `aria-pressed` antes: `false`.
- `aria-pressed` después: `true`.
- La card quedó resaltada (`border-purple-500/50 bg-purple-500/5`).

Resumen en paso `Generar`:

- `Plantilla: Balanceador PCC — 5 WAN`.

Payload capturado en navegador al generar configuración:

- `templateId = "pcc_5wan"`.
- `notes` incluyó `Plantilla: pcc_5wan`.

Respuesta backend:

- HTTP 201.
- `response.templateId = "pcc_5wan"`.
- `response.templateName = "Balanceo PCC — 5 WAN"`.
- `response.generatorVersion = "nugacore-templates-1.0"`.
- Filename: `nugacore-tpl-pcc-5wan-...rsc`.
- El script empieza con `# NugaCore`.
- El script contiene PCC.
- El script no contiene `NugaCoreWG`.

Conclusión Wizard PCC 5 WAN: **PASS**.

## 4. Wizard UI — Default sin selección manual

Flujo:

- Nuevo wizard.
- No se cambió plantilla manualmente.

Validación:

- Card default: `template-card-router_base_wireguard`.
- `aria-pressed = true`.
- Resumen: `Plantilla: Router Base + WireGuard`.
- Payload: `templateId = "router_base_wireguard"`.
- Respuesta: `response.templateId = "router_base_wireguard"`.
- Filename: `nugacore-tpl-router-base-wireguard-...rsc`.
- Script contiene `NugaCoreWG`.

Conclusión default: **PASS**.

## 5. Wizard UI — NOC Ready

Selección:

- Card: `NOC Ready`.
- `data-testid`: `template-card-noc_ready`.
- `aria-pressed` antes: `false`.
- `aria-pressed` después: `true`.

Validación:

- Resumen: `Plantilla: NOC Ready`.
- Payload: `templateId = "noc_ready"`.
- Respuesta: `response.templateId = "noc_ready"`.
- `response.templateName = "NOC Ready"`.
- Filename: `nugacore-tpl-noc-ready-...rsc`.
- Script contiene señales NOC/monitoring.
- Script no contiene `NugaCoreWG`.

Conclusión NOC Ready: **PASS**.

## 6. Wizard UI — PPPoE Server

Selección:

- Card: `Servidor PPPoE`.
- `data-testid`: `template-card-pppoe_server`.
- `aria-pressed` antes: `false`.
- `aria-pressed` después: `true`.

Validación:

- Resumen: `Plantilla: Servidor PPPoE`.
- Payload: `templateId = "pppoe_server"`.
- Respuesta: `response.templateId = "pppoe_server"`.
- `response.templateName = "Servidor PPPoE"`.
- Filename: `nugacore-tpl-pppoe-server-...rsc`.
- Script contiene PPPoE/PPP.
- Script no contiene `NugaCoreWG`.

Conclusión PPPoE Server: **PASS**.

## 7. Regresión rápida

Validaciones ejecutadas después de la UI:

| Caso | Resultado |
| --- | --- |
| `templateId` inválido no crea peer huérfano | PASS |
| `GET /api/router-enrollment/:id` incluye `templateName` y `generatorVersion` | PASS |
| `GET /api/router-enrollment` incluye `templateName` y `generatorVersion` | PASS |
| `pcc_5wan` vía API genera PCC real | PASS |
| Download conserva template PCC | PASS |
| `check-online` sin live no marca online | PASS (`isOnline=false`, source simulada) |
| `revoke` funciona | PASS |
| RBAC sin cambios | PASS |

Regresión template inválido:

- Request con `templateId = "no_existe"`.
- HTTP 400.
- `code = "TEMPLATE_NOT_FOUND"`.
- Conteos antes: `enrollments=4`, `peers=4`, `routers=7`.
- Conteos después: `enrollments=4`, `peers=4`, `routers=7`.

RBAC observado:

| Rol | List | Start |
| --- | ---: | ---: |
| Super Admin | 200 | 201 |
| Administrador | 200 | 201 |
| Técnico | 200 | 201 |
| Cobranza | 403 | 403 |
| Soporte | 403 | 403 |
| Solo lectura | 403 | 403 |

## 8. Seguridad

Se revisaron logs recientes del contenedor staging. No se detectaron:

- `privateKey`
- `presharedKey`
- `password=`
- JWT con forma `eyJ...`
- `service_role`
- `MIKROTIK_CREDENTIALS_KEY`
- scripts completos
- marcador `/interface wireguard`
- encabezados raw de scripts `# NugaCore` en logs

Conclusión seguridad: **PASS**.

## 9. Limpieza

Acciones ejecutadas:

- Enrollments de prueba UI/API revocados por endpoint público.
- Usuarios temporales eliminados de Supabase Auth/Profile/Roles.
- El servidor WireGuard usado fue temporal, porque staging no tenía servidor WireGuard al inicio (`existingWgServers=0`).
- Se reinició el contenedor staging para limpiar artefactos en memoria: enrollments, peers, routers y servidor WG temporal.
- Healthchecks posteriores al restart: 200 / 200 / 200.

No se borró ningún servidor WireGuard default oficial.

## Resultado final

**FASE 4.9.1 APROBADA**.

Los tres bloqueadores quedan cerrados:

1. Template inválido no crea peer huérfano: **PASS**.
2. Detail/list incluyen `templateName` y `generatorVersion` sin secretos: **PASS**.
3. Wizard UI conserva selección y envía `templateId` correcto para PCC 5 WAN, default, NOC Ready y PPPoE Server: **PASS**.
