# Fase 7 - Equipos e Inventario Tecnico (sin cambios UI)

## Objetivo
Fortalecer el control tecnico de activos de red con alta/edicion/asignacion, estados operativos e historial de movimientos.

## Implementado

### 1. Inventario enriquecido
- `GET /api/inventory` ahora soporta filtros por:
  - `q`
  - `warehouse`
  - `operationalStatus`
- La respuesta incluye metadata de estado operativo y asignacion por item.

### 2. Edicion de item
- `PUT /api/inventory/:id` para actualizar nombre, categoria, modelo, marca, almacen y seriales.

### 3. Estado de equipo
- `GET /api/inventory/:id/state`
- `PUT /api/inventory/:id/state`
- Estados soportados:
  - `Disponible`
  - `Instalado`
  - `En reparacion`
  - `Danado`
  - `Perdido`
  - `Baja`

### 4. Asignaciones tecnicas
- `POST /api/inventory/:id/assign`
  - Asigna equipo a `tower`, `client` o `technician`.
  - Actualiza stock y estado a `Instalado`.
- `POST /api/inventory/:id/unassign`
  - Retorno desde asignacion a almacen.
  - Actualiza stock y estado a `Disponible`.

### 5. Historial de movimientos y asignaciones
- `GET /api/inventory/movements`
- `GET /api/inventory/assignments`
- Se registran entradas/salidas/traspasos y acciones de asignacion/desasignacion.

### 6. Compatibilidad
- Endpoints existentes se mantienen:
  - `POST /api/inventory/movement`
  - `POST /api/inventory/add`
- El frontend actual sigue operativo sin cambios visuales.

## Archivos
- `backend/domains/inventory/routes.ts`
- `backend/state/store.ts`

## Validacion
- `npm run lint`: OK
- `npm run build`: pendiente de ejecucion en este documento
