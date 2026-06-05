# Suspension Engine 4.5.1 — Staging Validation Result

Fecha UTC: 2026-06-05T00:15:40Z
Ambiente: NugaCore Staging
Commit funcional validado: `acfd9a0 fix(suspension): align engine with persistent billing data`
Resultado final: **NO APROBADA**

Esta revalidación NO avanzó al Worker MikroTik, no conectó routers, no tocó routers y no ejecutó acciones reales.

## 1. Actualización y despliegue

Resultado: PASS

- Staging actualizado en `main`.
- `git log --oneline -5` contiene `acfd9a0`.
- Contenedor redeployado y healthy.
- Healthchecks finales:
  - `GET /api/health` -> 200
  - `GET /api/health/live` -> 200
  - `GET /api/health/ready` -> 200

## 2. Variables

Resultado: PASS

Variables verificadas en el contenedor staging activo:

- `NODE_ENV=staging`
- `USE_DB_CUSTOMERS=true`
- `USE_DB_BILLING=true`
- `USE_DB_PLANS=true`
- `USE_DB_SUSPENSION=false`
- `STAGING_TEST_TOOLS_ENABLED=true`

Notas:

- `USE_DB_SUSPENSION=false` es válido según el alcance de 4.5.1, que permite `false` o `true`.
- Se confirmó que el flag de test-tools quedó habilitado solo para la aplicación staging intervenida.
- No se imprimieron secretos.

Durante la validación se probó `USE_DB_SUSPENSION=true`, pero staging no tenía disponibles las tablas de suspensión en Supabase (`suspension_orders`, `suspension_policies`), lo que provocaba errores 502/503 en endpoints de suspensión/dashboard. Se dejó `USE_DB_SUSPENSION=false` para completar la validación con Customers/Billing persistentes y suspensión en memoria.

## 3. Dashboard contract

Resultado: PASS

`GET /api/dashboard-stats` respondió 200 e incluyó `suspension` con las claves requeridas:

- `suspendedToday`
- `reactivatedToday`
- `delinquent`
- `pendingSuspension`
- `pendingReactivation`

También existe `morosos`, pero ya no bloquea porque `delinquent` está presente.

Snapshot observado:

```text
suspendedToday = 0
reactivatedToday = 0
delinquent = 0
pendingSuspension = 0
pendingReactivation = 0
```

## 4. RBAC

Resultado: PASS

Validado con usuarios staging reales.

Soporte:

- `GET /api/suspension/customers` -> 403
- `POST /api/suspension/evaluate-all` -> 403

Solo lectura:

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `POST /api/suspension/evaluate-all` -> 403

Técnico:

- `GET /api/suspension/customers` -> 200
- `POST /api/suspension/evaluate-all` -> 403

Cobranza:

- `GET /api/suspension/customers` -> 200
- `POST /api/suspension/evaluate-all` -> 200

Admin:

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `GET /api/suspension/events` -> 200
- `GET /api/suspension/policies` -> 200
- `POST /api/suspension/evaluate-all` -> 200
- `PUT /api/suspension/policies` -> 200

SuperAdmin:

- `GET /api/suspension/customers` -> 200
- `GET /api/suspension/orders` -> 200
- `GET /api/suspension/events` -> 200
- `GET /api/suspension/policies` -> 200
- `POST /api/suspension/evaluate-all` -> 200
- `PUT /api/suspension/policies` -> 200

## 5. Test-tools

Resultado: PASS parcial

Candados validados:

- Sin super admin: `POST /api/suspension/test-tools/scenario` -> 403
- Sin `confirm:true`: `POST /api/suspension/test-tools/scenario` -> 400
- Con super admin + `confirm:true`: escenarios A/B creados -> 201

Limitación detectada:

- `DELETE /api/suspension/test-tools/customer/c-3` devolvió 500 al limpiar el escenario B.
- La causa visible en logs fue error del repositorio de customers al borrar el cliente en Supabase.
- La limpieza final se completó de forma controlada con eliminación directa de artefactos de prueba en Supabase staging, sin tocar datos reales.

Esto no bloqueó la limpieza final, pero sí deja una corrección pendiente en el endpoint de test-tools.

## 6. Escenario A — DB real Customers/Billing

Resultado: PASS

Escenario creado:

- Scenario: A
- Customer: `c-2`
- Invoice: `fac-101`
- Cliente activo
- Factura vencida fuera de gracia

Primera evaluación:

- `POST /api/suspension/evaluate/c-2` -> 200
- `billingStatus = DELINQUENT`
- `serviceStatus = PENDING_SUSPENSION`
- `networkStatus = active`
- `action = create_suspension`
- Orden: `sord-1`
- Orden tipo: `suspension`
- Orden status: `PENDING`
- Evento creado
- `client.status` siguió `active`
- No hubo logs MikroTik nuevos

## 7. Escenario B — DB real Customers/Billing

Resultado: PASS funcional, FAIL de trazabilidad de orden

Escenario creado:

- Scenario: B
- Customer: `c-3`
- Invoice: `fac-102`
- Cliente suspendido
- Factura pagada

Primera evaluación:

- `POST /api/suspension/evaluate/c-3` -> 200
- `billingStatus = CURRENT`
- `serviceStatus = PENDING_REACTIVATION`
- `networkStatus = suspended`
- `action = create_reactivation`
- Orden: `rord-2`
- Orden tipo: `reactivation`
- Orden status: `PENDING`
- Evento creado
- `client.status` siguió `suspended`
- No hubo logs MikroTik nuevos

Bloqueo:

- La orden de reactivación `rord-2` no expuso `invoiceId`.
- El evento de reactivación tampoco expuso `invoiceId`.
- La respuesta de creación del escenario sí reportó `invoiceId = fac-102`, pero la orden que debe ser trazable no preservó ese dato.

Esto incumple la tarea de trazabilidad para órdenes A y B.

## 8. Idempotencia

Resultado: PASS

Escenario A:

- Segunda evaluación de `c-2` -> `action = none`
- Reason: orden de suspensión ya pendiente
- No duplicó `SuspensionOrder`
- No duplicó orden equivalente

Escenario B:

- Segunda evaluación de `c-3` -> `action = none`
- Reason: orden de reactivación ya pendiente
- No duplicó `ReactivationOrder`
- No duplicó orden equivalente

## 9. Evaluate-all

Resultado: PASS

`POST /api/suspension/evaluate-all` como Admin:

- HTTP 200
- `evaluated = 5`
- `suspensionOrders = 0`
- `reactivationOrders = 0`
- `changed = 0`

Interpretación:

- Las órdenes A/B ya existían por evaluación individual.
- `evaluate-all` no duplicó órdenes.
- No ejecutó órdenes.
- No cambió `client.status`.
- No tocó MikroTik.
- No creó logs MikroTik.

## 10. Trazabilidad

Resultado: FAIL parcial

Escenario A:

- `customerId`: presente (`c-2`)
- `invoiceId`: presente (`fac-101`)
- `reason`: presente
- `source`: `engine`
- `createdAt`: presente
- `automatic/actor`: observable en evento
- Responde por qué se creó, qué factura la causó y cuándo.

Escenario B:

- `customerId`: presente (`c-3`)
- `invoiceId`: ausente en la orden de reactivación
- `reason`: presente
- `source`: `engine`
- `createdAt`: presente
- `automatic/actor`: observable en evento
- No responde completamente qué factura causó la orden desde la propia trazabilidad de la orden/evento.

Conclusión:

- La trazabilidad de suspensión pasa.
- La trazabilidad de reactivación queda incompleta porque falta `invoiceId` en la orden/evento.

## 11. UI

Resultado: PASS parcial

Validado por endpoints RBAC y por revisión del componente del módulo Suspensiones:

- Buckets visibles implementados.
- Órdenes pendientes implementadas.
- Eventos recientes implementados.
- Política visible implementada.
- Botón Evaluar cartera implementado para roles con permiso.
- Estado solo lectura implementado para roles sin permiso.
- Escenarios A/B fueron visibles por API mientras estaban activos.

No se ejecutó ninguna acción real desde UI.

## 12. No ejecución real

Resultado: PASS

Antes/después de las evaluaciones:

- MikroTik logs: 4 -> 4
- Command audit: 0 -> 0
- Órdenes ejecutadas: 0
- Worker MikroTik: no detectado
- Router tocado: no
- `client.status` modificado por motor: no

Las órdenes quedaron `PENDING` durante la validación.

## 13. Tests

Resultado: PASS

Ejecutados en `/opt/nugacore-staging`:

- `npm run typecheck` -> PASS
- `npm test` -> PASS
  - 24 files passed
  - 258 tests passed
  - 6 files / 34 tests skipped
- `npm run build` -> PASS
- `RUN_DB_TESTS=true npm run test:db` con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` configurados localmente -> PASS
  - 4 DB test files passed
  - 21 DB tests passed

No se imprimieron secretos.

## 14. Limpieza

Resultado: PASS con incidencia

Limpieza solicitada:

- `DELETE /api/suspension/test-tools/customer/c-2` -> 200, pero `removed=false` porque el cliente ya no estaba.
- `DELETE /api/suspension/test-tools/customer/c-3` -> 500 por error en repositorio de customers.

Limpieza final ejecutada de forma controlada:

- Se eliminaron artefactos de prueba de Supabase staging para `c-2`, `c-3`, `fac-101`, `fac-102` y dependencias (`invoice_items`, `payments`, `payment_applications`).
- Se reinició el contenedor para limpiar estado en memoria de suspensión.
- Se restauró política default.

Verificación final:

- Clientes test restantes: 0
- Órdenes test restantes: 0
- Eventos test restantes: 0
- Órdenes totales en suspension store: 0
- Eventos totales en suspension store: 0
- Healthchecks: 200/200/200
- Política default restaurada

## 15. Riesgos / bloqueos restantes

1. La orden de reactivación no conserva `invoiceId`, aunque el escenario B fue creado con factura pagada identificable.
2. `DELETE /api/suspension/test-tools/customer/<id>` falló para el cliente suspendido con factura/pago, obligando a limpieza controlada directa.
3. `USE_DB_SUSPENSION=true` no es usable en staging mientras no existan/apliquen las tablas de suspensión en Supabase.

## 16. Resultado final

**FASE 4.5 NO APROBADA**

La corrección de `acfd9a0` resolvió los bloqueos principales de evaluación con Customers/Billing persistentes, escenarios A/B, dashboard contract, RBAC e idempotencia.

Sin embargo, la fase no debe aprobarse todavía porque:

1. La trazabilidad de la orden de reactivación no incluye `invoiceId`.
2. El endpoint de limpieza de test-tools falla para el escenario B.

## 17. Recomendación siguiente

No avanzar al Worker MikroTik.

Antes de aprobar Fase 4.5:

1. Corregir la trazabilidad de reactivación para que la orden/evento conserve `invoiceId` o una referencia explícita a la factura que regularizó el saldo.
2. Corregir `DELETE /api/suspension/test-tools/customer/<id>` para limpiar correctamente clientes con facturas pagadas/pagos/aplicaciones en Supabase.
3. Si se desea `USE_DB_SUSPENSION=true`, aplicar primero la migración/tablas de suspensión en Supabase staging.
4. Revalidar únicamente trazabilidad B, cleanup test-tools y, si aplica, persistencia DB de suspensión.
