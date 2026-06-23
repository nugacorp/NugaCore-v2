# Client Onboarding / Client 360 — staging result

Fecha de validación: 2026-06-23

## Resultado final

✅ CLIENT ONBOARDING / CLIENT 360 APROBADO

Alcance respetado:

- No se avanzó a PROD-7.
- No se activó Worker Live.
- No se activó RouterOS Write.
- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se tocaron routers reales.
- No se aplicaron migraciones.

## Commits validados

Commit solicitado presente en `main` y contenido en el HEAD validado:

- `e2d4743 feat(customers): add ip assignment validation to onboarding`

Commit posterior de Client 360 encontrado en `origin/main`; por instrucción se validó ese HEAD:

- `f36e665 feat(customers): add client 360 quick actions`

Artefacto final desplegado en staging: `f36e665...`.

## Deploy y health

Redeploy de staging ejecutado mediante Coolify contra HEAD actual.

Validaciones:

- Contenedor: `running/healthy`.
- Imagen desplegada: `f36e665...`.
- `GET /api/health`: 200.
- `GET /api/health/live`: 200.
- `GET /api/health/ready`: 200.

Flags peligrosos dentro del contenedor, sin imprimir secretos:

- `USE_DB_MIKROTIK`: `UNSET`.
- `USE_DB_WIREGUARD`: `UNSET`.
- `MIKROTIK_WORKER_LIVE`: `OFF`.
- `MIKROTIK_COMMIT_MODE`: `UNSET`.
- `MIKROTIK_WRITE_ENABLED`: `UNSET`.
- `ROUTEROS_READONLY_PROVIDER`: `mock`.

## Checks

Ejecutados en `/opt/nugacore-staging`:

- `npm run typecheck`: PASS.
- `npm test`: PASS — 103 test files passed, 8 skipped; 1474 tests passed, 49 skipped.
- `npm run build`: PASS.

## IPAM / Alta de cliente

UI validada en Clientes / Alta Nuevo Cliente.

Campos presentes:

- `Router / Torre`.
- `Pool / Segmento`.
- `IP asignada`.
- `Escanear IPs disponibles`.
- `Estado de IP`.

Comportamiento validado:

- Cliente Activo requiere router y pool/IP por validación UI (`required={!isLeadForm}`) y backend.
- Lead Comercial puede continuar sin IP por diseño de formulario (`isLeadForm`).
- IP inválida/fuera de rango devuelve `out_of_pool` y no se marca disponible.
- IP ocupada/duplicada devuelve `in_use` o `IPAM_IN_USE`; backend bloquea alta aunque el frontend intente enviarla como disponible.
- IP disponible permite alta; backend conserva `routerId`, `poolId`, `assignedIp` e `ipAssignmentStatus`.
- Se creó un cliente de prueba con IP disponible y se eliminó después; cleanup devolvió 204.
- Backend revalida antes de guardar: alta con `192.168.100.10` devolvió 409 `IPAM_IN_USE`.

Endpoints IPAM validados con JWT real:

- `GET /api/ipam/routers`: 200, devuelve routers/torres mock.
- `GET /api/ipam/routers/:routerId/pools`: 200.
- `GET /api/ipam/pools/:poolId/available-ips`: 200, `source=mock-local`.
- `POST /api/ipam/validate-ip`: 200.

RBAC observado para lectura IPAM:

- Super Admin: 200.
- Administrador: 200.
- Técnico: 200.
- Soporte: 200.
- Solo lectura: 200.
- Cobranza: 200.

## WISP Core Sprint

UI de Alta Cliente validada:

- Capacidad de router visible tras seleccionar `RB5009 Principal`.
- Muestra utilización (`56.25% utilizada` observado).
- Muestra clientes activos como `Activos`.
- Muestra capacidad libre como `Libres`.
- Muestra capacidad total.
- GPS manual visible con latitud/longitud editables.
- Botón `Obtener ubicación actual` visible.
- Botón `Calcular cobertura` visible.
- Cobertura calculada en UI con distancia, azimut, porcentaje y estado.
- Reserva de equipo visible.
- Campos de equipo, CPE, serie y MAC visibles.
- Reserva de equipo funciona en modo local/mock.

Endpoints WISP Core validados:

- `GET /api/ipam/routers/:routerId/capacity`: 200; campos observados: `routerId`, `routerName`, `totalCapacity`, `activeClients`, `freeCapacity`, `utilizationPercent`.
- `GET /api/coverage/check`: 200 con `distanceKm`, `azimuth`, `estimatedCoverage`, `status`.
- `GET /api/inventory/customer-equipment`: 200.
- `GET /api/inventory/customer-equipment/reservations`: 200.
- `POST /api/inventory/customer-equipment/reservations`: 201 para roles autorizados; 403 para Solo lectura y Cobranza.

RBAC de reserva de equipo observado:

- Super Admin: 201.
- Administrador: 201.
- Técnico: 201.
- Soporte: 201.
- Solo lectura: 403.
- Cobranza: 403.

Notas de seguridad WISP Core:

- IPAM es local/mock; la UI indica: `IPAM local/mock. No consulta ni modifica RouterOS.`
- Capacidad/cobertura/equipo no consultan RouterOS real ni CHR real.
- Reserva de equipo queda en memoria del proceso de staging; no escribe inventario externo ni routers.

## Client 360

Commit Client 360 existe y fue validado en HEAD.

Tabla/lista de clientes:

- Columna `ACCIONES` visible.
- Botón `Acciones` por cliente visible.
- Menú agrupado validado:
  - Cliente.
  - Servicio.
  - Cobranza.
  - Soporte.
  - Red.
  - Historial.

Acciones presentes en menú:

- Ver perfil.
- Editar cliente.
- Suspender servicio.
- Reactivar servicio.
- Cambiar plan.
- Cambiar IP.
- Registrar pago.
- Generar factura.
- Estado de cuenta.
- Crear ticket.
- Ver tickets.
- Ver router.
- Ver ubicación.
- Copiar IP.
- Ver eventos.

Panel Cliente 360 validado:

- `CLIENTE 360` abre desde `Ver perfil`.
- Muestra nombre del cliente.
- Muestra estado.
- Muestra plan.
- Muestra IP asignada.
- Muestra router.
- Muestra zona/ciudad.
- Muestra dirección.
- Muestra teléfono/WhatsApp.
- Muestra email.
- Muestra fecha instalación.
- Muestra GPS.
- Muestra historial reciente o empty state `No hay historial reciente para este cliente.`

## Acciones rápidas seguras

Validaciones:

- `Ver perfil` abre Cliente 360.
- `Editar cliente` no rompe; acción presente y controlada por RBAC.
- `Registrar pago` no genera error en contrato UI; acción presente para roles permitidos.
- `Generar factura` muestra `Generación de factura pendiente de integración.` y no genera factura real externa.
- `Suspender/Reactivar` muestran simulación local: `Esta acción todavía no ejecuta cambios reales` y `no se aplicó al router`.
- `Crear ticket` no rompe; acción presente para roles permitidos.
- `Cambiar IP` valida formato y duplicados antes de aceptar.
- `Ver ubicación` abre Google Maps si hay GPS o muestra aviso `Cliente sin coordenadas.`.
- `Copiar IP` usa portapapeles y muestra feedback `IP copiada al portapapeles`.

## RBAC de acciones rápidas

Validado por tests de `clientActionCaps` y revisión de UI:

- Super Admin: todas las acciones permitidas.
- Administrador: todas las acciones permitidas.
- Técnico: acciones técnicas visibles, incluyendo router/IP/ticket/ubicación; sin facturación ni suspensión.
- Soporte: perfil/tickets/ubicación visibles; sin facturación ni suspensión.
- Cobranza: pagos/estado de cuenta visibles; sin cambiar IP, suspender, reactivar ni acciones de router/script.
- Solo lectura: solo acciones de lectura seguras como ver perfil, historial, copiar IP y ver ubicación; sin mutaciones.

## No ejecución real

Confirmado:

- No RouterOS write.
- No Worker Live.
- No queue real.
- No suspensión real en MikroTik.
- No reactivación real en MikroTik.
- No cambios en routers.
- No CHR real.
- No RB5009 real.

Escaneo específico de `CrmModule.tsx`, `ClientActionsMenu.tsx` y `Client360Panel.tsx` sin coincidencias para:

- `/api/routeros`
- `/api/mikrotik`
- `worker`
- `/execute`
- `MIKROTIK_WORKER_LIVE`
- `MIKROTIK_COMMIT_MODE`
- `MIKROTIK_WRITE_ENABLED`
- `USE_DB_MIKROTIK`
- `USE_DB_WIREGUARD`
- comandos RouterOS write prohibidos.

## Seguridad y logs

Logs recientes del contenedor revisados por patrones, sin imprimir contenido sensible.

Ausencia confirmada de:

- JWTs.
- Service role.
- Passwords.
- Private keys.
- Preshared keys.
- Scripts RouterOS write completos.

Payloads de endpoints IPAM/WISP Core fueron escaneados por patrones sensibles y pasaron.

## Limitaciones / observaciones

- Algunas acciones rápidas son placeholders seguros o simulaciones hasta que exista integración productiva explícita.
- Reserva de equipo en staging es local/mock en memoria; los registros de prueba permanecen hasta reinicio del contenedor.
- Cobertura es estimación informativa y no bloquea alta.
- No se validó ni habilitó escritura RouterOS.

## Veredicto

✅ CLIENT ONBOARDING / CLIENT 360 APROBADO para staging read-only/mock.

No avanzar a RouterOS Write sin autorización explícita.
No activar Worker Live.
No tocar routers reales.
