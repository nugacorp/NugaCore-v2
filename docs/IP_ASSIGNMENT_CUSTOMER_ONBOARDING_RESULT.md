# Client IP Assignment for New WISP Customer

Fecha: 2026-06-21
Estado: ✅ Implementado localmente con fuente mock/local

## Objetivo

Agregar asignación segura de IP al formulario
`Registrar Entrada: Cliente WISP Residencial/Corp`, sin consultar ni modificar
routers reales.

El flujo permite seleccionar router/torre, consultar pools conocidos, calcular
IPs libres, elegir una IP o escribirla manualmente y bloquear el alta cuando la
dirección es inválida, reservada, está fuera del segmento o ya está ocupada.

## Endpoints IPAM

Dominio: `backend/domains/ipam/`

| Método | Endpoint | Función |
| --- | --- | --- |
| GET | `/api/ipam/routers` | Lista routers/torres mock disponibles. |
| GET | `/api/ipam/routers/:routerId/pools` | Lista pools conocidos del nodo. |
| GET | `/api/ipam/pools/:poolId/available-ips` | Calcula IPs libres localmente. |
| POST | `/api/ipam/validate-ip` | Valida formato, segmento, reserva y duplicado. |

Todos requieren un rol de lectura válido. `POST /validate-ip` es una consulta de
validación: no escribe en RouterOS, no crea queues y no modifica routers.

## Datos mock

- Router `rb5009-main`.
- Torre `tower-san-ramon`.
- Pool principal `192.168.100.0/24`.
- Gateway `192.168.100.1`.
- Ocupadas mock: `.1`, `.10`, `.20`, `.50`.
- Reservadas: `.2`, `.254`, además de network y broadcast.

Las IPs se calculan desde el CIDR; no existe una lista hardcodeada de direcciones
libres. También se excluyen direcciones ya asignadas a clientes de NugaCore.

## Flujo UI

La sección **Asignación de Red** conserva el tema slate/indigo existente e incluye:

- Router / Torre.
- Pool / Segmento y gateway.
- Botón `Escanear IPs disponibles`.
- Selector de IP libre.
- Modo de entrada manual.
- Estado: Disponible, En uso, Reservada o Inválida.
- Mensajes claros de validación.

Las consultas IPAM usan el Bearer JWT de la sesión mediante `getAuthHeaders`.

## Validaciones

Cliente Activo:

- Requiere router/torre.
- Requiere pool.
- Requiere IP.
- La IP debe ser IPv4 válida.
- Debe pertenecer al CIDR.
- No puede ser network, broadcast, gateway ni reservada.
- No puede estar ocupada por el mock o por otro cliente NugaCore.
- `Confirmar Alta` permanece deshabilitado hasta obtener estado `available`.

Lead Comercial:

- Puede continuar sin asignación de red.
- Si selecciona una IP, se usa el mismo flujo de validación.

Defensa backend:

- El payload incluye `routerId`, `poolId`, `assignedIp` e
  `ipAssignmentStatus`.
- Si se envía cualquier campo de red, los tres campos principales son
  obligatorios.
- `POST /api/clients` vuelve a validar la IP antes de crear el cliente.
- Una IP ocupada devuelve HTTP 409 aunque el frontend enviara
  `ipAssignmentStatus=available`.
- Callers legacy sin campos IPAM conservan temporalmente su contrato anterior.

## Persistencia actual

- En modo store local, los cuatro campos IPAM permanecen en el objeto `Client`.
- `assignedIp` también alimenta el campo legacy `ip`.
- En Supabase, `assignedIp` usa la columna existente `clients.ip_assigned`.
- `routerId`, `poolId` e `ipAssignmentStatus` todavía no tienen columnas
  persistentes en `clients`; no se añadió ni aplicó una migración en esta fase.

## Tests

Cobertura agregada:

- Listar routers.
- Listar pools.
- Calcular IPs disponibles.
- Validar IP disponible.
- Validar IP ocupada por mock o cliente.
- Validar IP fuera del pool.
- Validar IP inválida/reservada.
- Contrato de los cuatro endpoints.
- Revalidación durante alta de cliente.
- Campos y controles UI.
- IP ocupada bloquea confirmar.
- IP válida permite confirmar.
- Cliente Activo requiere IP.
- Lead Comercial permite IP vacía.

Validación final:

- `npm run typecheck`: PASS.
- `npm test`: PASS.
  - 84 archivos pasaron.
  - 7 archivos omitidos por configuración.
  - 1324 tests pasaron.
  - 46 tests omitidos por configuración.
- `npm run build`: PASS.
  - Vite: 1762 módulos transformados.
  - Bundle de servidor generado correctamente.

## Límites y guardrails

- No RouterOS real.
- No CHR real.
- No Worker Live.
- No queues ni address-list.
- No se activó `USE_DB_MIKROTIK`.
- No se activó `USE_DB_WIREGUARD`.
- No se activó `MIKROTIK_WORKER_LIVE`.
- No se activó `MIKROTIK_COMMIT_MODE`.
- No se activó `MIKROTIK_WRITE_ENABLED`.

## Siguiente paso

Después de aprobar PROD-5/CHR, integrar una fuente read-only real para descubrir
pools/ocupación desde RouterOS. La transición debe conservar el contrato IPAM y
mantener toda escritura deshabilitada hasta una fase explícitamente autorizada.
