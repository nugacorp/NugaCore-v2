# WISP Core Production Sprint — WISP-1 a WISP-5

Fecha: 2026-06-22
Estado: ✅ Implementado y validado localmente
Alcance: alta operativa WISP completa, sin conexión ni escritura RouterOS

## Resultado

El alta de Cliente Activo en CRM ahora permite completar el flujo:

1. Seleccionar router o torre.
2. Consultar capacidad informativa.
3. Capturar o editar GPS.
4. Calcular cobertura estimada.
5. Reservar equipo para instalación.
6. Seleccionar y validar una IP.
7. Crear el cliente.

La ruta real conservada por el repositorio es `POST /api/clients`. El backend
continúa revalidando la IP antes de crear el cliente.

## WISP-1 — Capacidad

Endpoint creado:

- `GET /api/ipam/routers/:routerId/capacity`

Respuesta: `routerId`, `routerName`, `totalCapacity`, `activeClients`,
`freeCapacity` y `utilizationPercent`.

La capacidad inicial es mock y suma los clientes activos asignados en NugaCore.
CRM la muestra al seleccionar el nodo con los umbrales solicitados:

- verde: menor a 70 %
- amarillo: 70 % a 85 %
- rojo: mayor a 85 %

Es informativa y no bloquea altas.

## WISP-2 — GPS

CRM incorpora el botón `Obtener ubicación actual` mediante
`navigator.geolocation.getCurrentPosition`.

- Latitud válida: -90 a 90.
- Longitud válida: -180 a 180.
- Los campos permanecen editables manualmente.
- Confirmación: `GPS capturado correctamente.`
- Coordenadas inválidas bloquean el submit del formulario.

## WISP-3 — Cobertura

Dominio creado en `backend/domains/coverage/`.

Endpoint:

- `GET /api/coverage/check?routerId&latitude&longitude`

Calcula localmente distancia mediante Haversine, azimut, porcentaje estimado de
cobertura y estado `GOOD`, `WARNING` o `POOR`.

El resultado es informativo. No bloquea el alta y no consulta equipos reales.

## WISP-4 — Reserva de inventario

Dominio creado en `backend/domains/inventory/customer-equipment/`.

Endpoints:

- `GET /api/inventory/customer-equipment`
- `GET /api/inventory/customer-equipment/reservations`
- `POST /api/inventory/customer-equipment/reservations`

El catálogo expone CPE disponibles del inventario actual y accesorios PoE/fuente
mock. La reserva incluye equipo, serie, MAC y cliente.

Reglas:

- estado único nuevo: `RESERVED`;
- reserva exclusivamente en memoria;
- no descuenta `qty`;
- no registra movimientos de salida;
- no cambia el estado operativo del inventario.

El formulario muestra `Equipo reservado para instalación.` y asocia el
`equipmentReservationId` al cliente en el store local.

## RBAC del alta

- Super Admin, Administrador, Técnico y Soporte pueden iniciar el alta.
- Técnico ahora puede ver CRM y crear el cliente WISP completo.
- Los controles de suspender, reactivar y baja sólo se muestran a los roles
  autorizados para gestionar el ciclo de vida.
- Cobranza y Solo lectura no obtienen permiso de creación.

## WISP-5 — Providers IPAM

Arquitectura creada en `backend/domains/ipam/providers/`:

- `provider-interface.ts`
- `mock-provider.ts`
- `routeros-provider.ts`
- `fallback.ts`
- `index.ts`

Feature flag:

- `IPAM_PROVIDER=mock` por defecto.
- `IPAM_PROVIDER=routeros` selecciona el provider preparado.

El provider RouterOS está deliberadamente no configurado: no contiene host,
credenciales, cliente de red, API MikroTik, comandos ni métodos de escritura.
Cuando se selecciona `routeros`, falla con código seguro
`IPAM_ROUTEROS_NOT_CONFIGURED` y cae automáticamente a mock.

## Dashboard y Manual

Dashboard agrega, con el diseño slate/indigo existente:

- Clientes por torre.
- Capacidad utilizada.
- Equipos reservados.
- Instalaciones pendientes.

El Manual de Usuario agrega `Alta de Cliente WISP` con pasos de GPS, cobertura,
IPAM, inventario y placeholders de capturas.

No se cambió la paleta, tema, tipografía ni branding global.

## Archivos principales creados

- `backend/domains/coverage/{types,service,routes}.ts`
- `backend/domains/ipam/providers/{provider-interface,mock-provider,routeros-provider,fallback,index}.ts`
- `backend/domains/inventory/customer-equipment/{types,repository,service}.ts`
- `src/lib/wispOnboardingView.ts`
- `tests/unit/capacity.service.test.ts`
- `tests/unit/coverage.service.test.ts`
- `tests/unit/inventory.reservation.test.ts`
- `tests/unit/ipam.providers.test.ts`
- `tests/unit/customer-onboarding.ui.test.ts`
- `tests/contract/capacity.contract.test.ts`
- `tests/contract/coverage.contract.test.ts`
- `tests/contract/inventory.customer-equipment.contract.test.ts`

## Validación

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 93 archivos pasaron.
  - 7 archivos omitidos por configuración.
  - 1,358 tests pasaron.
  - 46 tests omitidos por configuración.
- `npm run build`: PASS.
  - Vite transformó 1,763 módulos.
  - Bundle frontend y `dist/server.cjs` generados.
  - Warning no bloqueante de tamaño de chunk.

## Guardrails confirmados

- No se conectó CHR real.
- No se conectó RouterOS real.
- No se usó SSH.
- No se usó API MikroTik real.
- No se activó Worker Live.
- No se activó commit mode.
- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se creó ejecución de queues ni provisioning automático.
- No se avanzó a PROD-5.

## Siguiente gate

Validación funcional por Hermes/operador en staging del flujo visual y de los
endpoints mock. Cualquier integración real con RouterOS continúa bloqueada hasta
una fase posterior explícitamente autorizada.
