# MikroTik Provisioning - Staging Validation Result

Fecha: 2026-06-04T20:42:35Z
URL staging: https://nugacore-staging.5.180.151.109.sslip.io
Commit validado: 0819657 feat(mikrotik): add router provisioning script generator

## Alcance y restricciones

- No se modifico codigo fuente.
- No se tocaron routers reales ni routers de produccion.
- No se pego ningun script en RouterOS.
- No se activo Worker MikroTik.
- No se ejecutaron comandos reales sobre MikroTik.
- No se tocaron Billing, Suspensiones, Inventory ni Tickets.
- No se imprimen passwords, tokens completos, JWTs ni scripts completos en esta documentacion.

## 1. Actualizacion staging y deploy

Resultado: PASS

Evidencia:

- `/opt/nugacore-staging` actualizado por fast-forward a `main`.
- `git log --oneline -5` contiene `0819657` como HEAD.
- Redeploy Coolify ejecutado con force rebuild.
- Build OK.
- Rolling update OK.
- Contenedor healthy.
- Imagen activa corresponde al commit validado `0819657`.

## 2. Healthcheck

Resultado: PASS

| Endpoint | Resultado |
| --- | --- |
| `/api/health` | HTTP 200 |
| `/api/health/live` | HTTP 200 |
| `/api/health/ready` | HTTP 200 |

## 3. RBAC API

Resultado: PASS con nota de alcance para Tecnico.

| Rol | Validacion | Resultado |
| --- | --- | --- |
| Cobranza | `GET /api/mikrotik/routers` | PASS, HTTP 403 |
| Solo lectura | `GET /api/mikrotik/routers` | PASS, HTTP 200 |
| Solo lectura | `POST /api/mikrotik/routers` | PASS, HTTP 403 |
| Solo lectura | `POST /api/mikrotik/routers/:id/provisioning-script` | PASS, HTTP 403 |
| Tecnico | `GET /api/mikrotik/routers` | PASS, HTTP 200 |
| Tecnico | `POST /api/mikrotik/routers` | HTTP 403, consistente con RBAC actual: crear/editar solo Admin/SuperAdmin |
| Tecnico | `POST /api/mikrotik/routers/:id/provisioning-script` | PASS, HTTP 201 |
| Tecnico | `POST /api/mikrotik/routers/:id/test-connection` | PASS, validado en flujo dry-run |
| Soporte | `GET /api/mikrotik/routers` | PASS, HTTP 200 |
| Soporte | `POST /api/mikrotik/routers/:id/provisioning-script` | PASS, HTTP 403 |
| Admin | `GET /api/mikrotik/routers` | PASS, HTTP 200 |
| SuperAdmin | `GET /api/mikrotik/routers` | PASS, HTTP 200 |

Nota: el frontend y backend actuales documentan que crear/editar routers esta limitado a Super Admin y Administrador. Tecnico puede generar scripts y probar dry-run sobre routers existentes, pero no crear routers.

## 4. Router ficticio creado

Resultado: PASS

Se creo por API con usuario Administrador, sin credenciales manuales y sin conectar a ningun router real.

| Campo | Valor validado |
| --- | --- |
| name | `Router Test Provisioning` |
| connection_type | `sstp` |
| management_ip | `10.10.0.2` |
| api_port | `8728` |
| notas | `Validacion staging, no router real.` |
| create status | HTTP 201 |
| id generado | `mkt-4` |
| status inicial | `pending` |
| hasCredentials inicial | `false` |

## 5. Script SSTP

Resultado: PASS

Generacion:

- `POST /api/mikrotik/routers/:id/provisioning-script`: HTTP 201.
- `connectionType`: `sstp`.
- Respuesta contiene `provisioningToken`.
- Respuesta contiene `scriptHash` sha256.
- Hash local del script coincide con `scriptHash` de respuesta.
- Respuesta contiene `credentials.apiUsername` y `credentials.vpnUsername`.
- No se devuelven campos sueltos tipo password fuera del script de una sola visualizacion.
- La vista saneada del router queda con credenciales presentes y estado provisionado.

Validaciones de contenido, sin imprimir el script completo:

| Requisito | Resultado |
| --- | --- |
| Contiene `NugaCore` | PASS |
| No contiene `wisphub` | PASS |
| Contiene `NugaCoreVPN` | PASS |
| Contiene grupo `nugacore` | PASS |
| Contiene usuario `nugacore_*` | PASS |
| API limitada a CIDR VPN/management | PASS |
| Contiene scheduler `NugaCore-VPN-Watchdog` | PASS |
| No contiene permiso `sniff` | PASS |
| No contiene permiso `sensitive` | PASS |
| No contiene `romon` | PASS |
| No contiene `reboot` | PASS |

Extracto saneado:

```routeros
# NugaCore - Provisioning Script (SSTP) nugacore-1.0
# Idempotente: elimina la configuracion NugaCore previa y la recrea.
# La API queda limitada a la red VPN de NugaCore.
/user group add name=nugacore policy="read,write,api,test" comment="NugaCore minimal API group"
/user add name="nugacore_[REDACTED]" password="[REDACTED]" group=nugacore comment="NugaCore API user"
/interface sstp-client add name="NugaCoreVPN" connect-to="vpn.nugacore.local" user="nugacore_[REDACTED]" password="[REDACTED]" add-default-route=no disabled=no
/ip route add dst-address="10.0.0.0/24" gateway=NugaCoreVPN comment="NugaCore management route"
/ip service set api port=8728 address="10.10.0.0/24" disabled=no
/system scheduler add name=NugaCore-VPN-Watchdog interval=00:01:00 comment="NugaCore VPN reconnect watchdog" on-event="[REDACTED]"
```

## 6. UI

Resultado: PASS con nota RBAC.

Validado con usuario Tecnico:

- Modulo `MikroTik Core Control & Copilot` visible.
- Panel `ROUTERS MIKROTIK` visible.
- Lista de routers visible.
- Selector WireGuard/SSTP visible.
- Se eligio SSTP en un router existente.
- Boton `Generar Script` visible para Tecnico.
- Modal/panel de script muestra advertencia de una sola visualizacion.
- Script visible una vez en el modal/panel.
- Boton `Copiar` visible.
- Al cerrar con `Ya lo guarde, cerrar`, el script no reaparece.
- Estado cambia a `PROVISIONADO`.
- Boton `Probar (dry-run)` visible.

Nota RBAC: en UI Tecnico no aparece formulario/boton para crear router. Esto coincide con `src/lib/mikrotikRbac.ts` y backend: crear/editar routers solo Super Admin/Administrador. La creacion del router ficticio se valido por API con Administrador.

## 7. Rotacion de credenciales

Resultado: PASS

Validado con Administrador:

| Paso | Resultado |
| --- | --- |
| Rotar sin `confirm:true` | PASS, HTTP 400 |
| Rotar con `confirm:true` | PASS, HTTP 201 |
| Script nuevo generado | PASS |
| `scriptHash` diferente | PASS |
| Credenciales anteriores no se devuelven como campos sueltos | PASS |
| Auditoria | Endpoint de auditoria disponible; no se observaron secretos en logs |

No se imprimieron passwords ni tokens completos.

## 8. Test connection dry-run

Resultado: PASS

`POST /api/mikrotik/routers/:id/test-connection`:

- HTTP 200.
- `dryRun: true`.
- `mode: dry-run`.
- Checklist presente:
  - `router_registered: true`
  - `credentials_present: true`
  - `connection_type_set: true`
  - `api_port_valid: true`
- Sin conexion real.
- Sin error destructivo.

## 9. Logs / higiene de secretos

Resultado: PASS

Se revisaron logs recientes del contenedor activo.

Patrones con 0 coincidencias:

- `password=`
- encabezados de script de provisioning completo
- provisioning tokens completos
- marcadores de llave de cifrado MikroTik
- marcadores de llave administrativa de Supabase
- JWTs (`eyJ...`)
- credenciales RouterOS visibles

## 10. Limpieza

Resultado: PASS

- Router ficticio `mkt-4` eliminado por API con Administrador.
- `GET /api/mikrotik/routers/mkt-4` despues de eliminar: HTTP 404.
- No se crearon routers reales.
- No se pego ningun script en MikroTik.
- No quedaron secrets visibles en API saneada.

Nota: la generacion UI sobre un router demo existente modifica solo el store en memoria del contenedor staging; no toca ningun router real y no persiste el script completo ni passwords en logs.

## Riesgos / observaciones

1. La UI muestra el script completo una sola vez, como fue disenado; debe evitarse capturarlo en reportes o logs operativos.
2. Tecnico no puede crear routers por RBAC actual; si producto requiere alta de routers por Tecnico, hay que cambiar RBAC en una fase posterior con aprobacion explicita.
3. La implementacion actual usa store en memoria para provisioning; el esquema Supabase existe en el repo, pero esta validacion no aplico migraciones ni activo Worker MikroTik.
4. El Worker MikroTik sigue pendiente y no debe activarse hasta tener aprobacion y pruebas de seguridad adicionales.

## Recomendacion siguiente

- Mantener Worker MikroTik desactivado.
- Antes de Fase Worker, decidir explicitamente si Tecnico debe poder crear routers o solo generar/probar sobre routers existentes.
- Agregar validacion automatizada de UI que capture solo extractos saneados para evitar fugas accidentales de scripts de una sola visualizacion.

## Resultado final

PASS
