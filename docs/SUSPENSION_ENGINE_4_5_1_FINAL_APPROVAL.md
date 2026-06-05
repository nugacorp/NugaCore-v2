# Validación final Fase 4.5.1 — Motor de Suspensiones

Fecha UTC: 2026-06-05

Resultado final: ❌ FASE 4.5 NO APROBADA

Commit validado:

- `1bd2bfe fix(suspension): preserve reactivation traceability`

Alcance validado:

- Staging redesplegado con commit `1bd2bfe`.
- API healthchecks.
- Contrato dashboard.
- Test-tools de staging.
- Escenario A: suspensión pendiente.
- Escenario B: reactivación pendiente.
- Trazabilidad de `invoiceId`.
- Idempotencia.
- RBAC.
- UI publicada.
- No ejecución real MikroTik.
- Limpieza de datos de prueba.
- Suite local: typecheck, tests y build.

Restricciones respetadas:

- No se avanzó a Worker MikroTik.
- No se avanzó a Fase 4.6.
- No se modificó código de aplicación.
- No se tocaron routers reales.
- No se ejecutaron comandos RouterOS.
- No se documentaron secretos ni tokens.

---

## 1. Repo y commit

Acciones ejecutadas:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Resultado:

- PASS: `main` contiene `1bd2bfe fix(suspension): preserve reactivation traceability`.
- PASS: repositorio actualizado antes del redeploy.

---

## 2. Redeploy y healthchecks

Resultado del redeploy:

- PASS: build/deploy de staging finalizó correctamente.
- PASS: contenedor de aplicación quedó `healthy`.
- PASS: imagen desplegada corresponde al commit `1bd2bfe`.

Healthchecks:

| Endpoint | Resultado |
| --- | --- |
| `GET /api/health` | HTTP 200 |
| `GET /api/health/live` | HTTP 200 |
| `GET /api/health/ready` | HTTP 200 |

Resultado: PASS.

---

## 3. Dashboard contract

Endpoint:

```http
GET /api/dashboard-stats
```

Validación:

- PASS: existe `suspension.delinquent`.
- PASS: también existe `suspension.morosos`; se considera aceptable porque `delinquent` está presente.

Keys observadas en `suspension`:

- `active`
- `delinquent`
- `morosos`
- `pendingReactivation`
- `pendingSuspension`
- `reactivatedToday`
- `suspended`
- `suspendedToday`
- `warning`

Resultado: PASS.

---

## 4. Test-tools de staging

Endpoint:

```http
POST /api/suspension/test-tools/scenario
```

Validaciones:

| Caso | Esperado | Observado | Resultado |
| --- | ---: | ---: | --- |
| Sin super admin | 403 | 403 | PASS |
| Sin `confirm:true` | 400 | 400 | PASS |
| Scenario inválido | 400 | 400 | PASS |
| Super admin + `confirm:true` | 200/201 | 201 | PASS |

Resultado: PASS.

---

## 5. Escenario A — activo + factura vencida fuera de gracia

Preparación:

- Scenario: `A`.
- Cliente de prueba creado activo.
- Factura de prueba vencida fuera de gracia.

Evaluación:

```http
POST /api/suspension/evaluate/:customerId
```

Resultado observado:

| Campo | Observado |
| --- | --- |
| `billingStatus` | `DELINQUENT` |
| `serviceStatus` | `PENDING_SUSPENSION` |
| Acción | `create_suspension` |
| Orden creada | Sí |
| Tipo de orden | `suspension` |
| Status de orden | `PENDING` |
| Evento creado | Sí |
| `client.status` | Sin cambios: `active` |
| Logs MikroTik | Sin actividad nueva |

Trazabilidad:

- `customerId`: presente.
- `invoiceId`: presente en evaluación, orden y evento.
- `reason`: `Morosidad fuera de la ventana de gracia (3 días).`
- `source`: `engine` en la orden.
- `createdAt`: presente en orden y evento.
- `actorId`/`automatic`: evento automático con actor autenticado presente; el UUID no se documenta.

Respuesta de trazabilidad:

- Por qué se creó: por morosidad fuera de la ventana de gracia.
- Qué factura la causó: la factura vencida creada por el escenario A; `invoiceId` presente y consistente.
- Cuándo ocurrió: `createdAt` presente en orden y evento.

Idempotencia:

- Reevaluación devolvió acción `none` con razón `Orden de suspensión ya pendiente.`
- Ordenes equivalentes antes/después: 1 → 1.
- Eventos equivalentes antes/después: 1 → 1.

Resultado Escenario A: PASS.

---

## 6. Escenario B — suspendido + factura pagada

Preparación:

- Scenario: `B`.
- Cliente de prueba creado suspendido.
- Factura de prueba pagada.

Evaluación:

```http
POST /api/suspension/evaluate/:customerId
```

Resultado observado:

| Campo | Observado |
| --- | --- |
| `billingStatus` | `CURRENT` |
| `serviceStatus` | `PENDING_REACTIVATION` |
| Acción | `create_reactivation` |
| Orden creada | Sí |
| Tipo de orden | `reactivation` |
| Status de orden | `PENDING` |
| Evento creado | Sí |
| `client.status` | Sin cambios: `suspended` |
| Logs MikroTik | Sin actividad nueva |

Trazabilidad:

- `customerId`: presente.
- `invoiceId`: presente en evaluación, orden y evento.
- `reason`: `Saldo regularizado: procede reactivación.`
- `source`: `engine` en la orden.
- `createdAt`: presente en orden y evento.
- `actorId`/`automatic`: evento automático con actor autenticado presente; el UUID no se documenta.

Respuesta de trazabilidad:

- Por qué se creó: porque el cliente estaba suspendido y el saldo fue regularizado.
- Qué factura la causó: la factura pagada creada por el escenario B; `invoiceId` presente y consistente.
- Cuándo ocurrió: `createdAt` presente en orden y evento.

Idempotencia:

- Reevaluación devolvió acción `none` con razón `Orden de reactivación ya pendiente.`
- Ordenes equivalentes antes/después: 1 → 1.
- Eventos equivalentes antes/después: 1 → 1.

Resultado Escenario B funcional: PASS.

---

## 7. Evaluate-all

Endpoint:

```http
POST /api/suspension/evaluate-all
```

Resultado observado:

- PASS: las órdenes existentes permanecieron `PENDING`.
- PASS: no hubo órdenes `EXECUTED`.
- PASS: `client.status` de los clientes de prueba no cambió.
- PASS: no hubo actividad nueva en logs/auditoría MikroTik.
- PASS: segunda ejecución fue idempotente para creación de órdenes.

Resumen observado:

- Primera ejecución: `evaluated=5`, `suspensionOrders=0`, `reactivationOrders=0`, `changed=2`.
- Segunda ejecución: `evaluated=5`, `suspensionOrders=0`, `reactivationOrders=0`, `changed=0`.

Resultado: PASS.

---

## 8. RBAC

Validación rápida sobre endpoints del módulo de suspensiones:

| Rol | Lectura | Evaluación | Política | Resultado |
| --- | --- | --- | --- | --- |
| Soporte | 403 | 403 | No autorizado | PASS |
| Solo lectura | 200 | 403 | No autorizado | PASS |
| Técnico | 200 | 403 | No autorizado | PASS |
| Cobranza | 200 | 200 | 403 | PASS |
| Admin | 200 | 200 | 200 | PASS |
| SuperAdmin | 200 | 200 | 200 | PASS |

Resultado: PASS.

---

## 9. UI

Validación solicitada:

- Módulo Suspensiones visible.
- Buckets visibles.
- Órdenes visibles.
- Eventos visibles.
- Política visible.
- Botón Evaluar visible para roles autorizados.

Resultado observado al abrir la raíz pública de staging:

```text
Blocked request. This host is not allowed.
To allow this host, add the staging host to server.allowedHosts in vite.config.js.
```

Adicionalmente, los logs del contenedor muestran errores de Vite al optimizar dependencias por permisos en `/app/node_modules/.vite`.

Conclusión UI:

- FAIL: la UI pública de staging no cargó correctamente, por lo que no se pudo validar visualmente el módulo de Suspensiones ni sus componentes.

Resultado UI: FAIL.

---

## 10. No ejecución real

Validaciones:

- No se activó Worker MikroTik.
- No se tocó ningún router real.
- No se ejecutó ningún comando RouterOS.
- No se creó ninguna orden `EXECUTED`.
- `client.status` no cambió por evaluación.
- Logs/auditoría MikroTik sin actividad nueva durante la validación.

Métricas observadas:

- Logs MikroTik: 4 antes, 4 después.
- Command audit MikroTik: 0 antes, 0 después.
- Órdenes `EXECUTED`: 0.

Resultado: PASS.

---

## 11. Limpieza

Acciones:

- Se eliminaron los escenarios de prueba.
- Se restauró la política default.
- Se verificó que no quedaran órdenes ni eventos de los clientes de prueba.
- Se verificó que no quedaran facturas de prueba.
- Se verificó que no quedaran estados temporales del motor para esos clientes.

Observación importante:

- El cleanup vía endpoint funcionó para el escenario A.
- En el escenario B, el endpoint `DELETE /api/suspension/test-tools/customer/:id` devolvió inicialmente HTTP 500 porque el cliente tenía artefactos persistentes de pago asociados a la factura pagada.
- Se completó la limpieza administrativa de esos artefactos de staging sin imprimir secretos, y luego el endpoint quedó verificable sin residuos para el cliente.

Resultado de limpieza final:

- PASS final: staging quedó limpio de los datos creados por esta validación.
- FAIL parcial de contrato operacional: el cleanup automático del escenario B no fue autosuficiente en el primer intento.

---

## 12. Tests locales

Comandos ejecutados:

```bash
npm run typecheck
npm test
npm run build
```

Resultados:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 24 archivos passed.
  - 6 archivos skipped.
  - 259 tests passed.
  - 34 tests skipped.
- `npm run build`: PASS.

Resultado: PASS.

---

## 13. Conclusión

Backend del Motor de Suspensiones en commit `1bd2bfe`:

- Dashboard contract: PASS.
- Escenario A: PASS.
- Escenario B: PASS.
- `invoiceId` trazable: PASS.
- Idempotencia: PASS.
- RBAC: PASS.
- No ejecución real: PASS.
- Tests locales: PASS.

Bloqueantes para aprobar Fase 4.5 completa:

1. UI pública de staging no cargó por bloqueo de host permitido de Vite; no se pudo validar el módulo visualmente.
2. Cleanup automático del escenario B no fue autosuficiente en el primer intento por dependencias persistentes de pagos/aplicaciones de pago; aunque la limpieza final quedó completa, el contrato operacional de no dejar datos de prueba requiere que el endpoint sea confiable por sí mismo.

Resultado final:

❌ FASE 4.5 NO APROBADA

No se debe avanzar a Fase 4.6 ni al Worker MikroTik hasta corregir y revalidar:

- Publicación/carga de UI en staging.
- Cleanup automático completo de escenario B con factura pagada y artefactos de pago persistentes.
