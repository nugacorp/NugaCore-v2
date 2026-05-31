# Fase 6 - Torres y Sitios (sin cambios UI)

## Objetivo
Habilitar gestion operativa de red fisica para torres y sectores sin modificar componentes visuales.

## Implementado

### 1. CRUD de torres
- `GET /api/network-towers` con filtros por `status` y `q`.
- `GET /api/network-towers/:id`.
- `POST /api/network-towers`.
- `PUT /api/network-towers/:id`.
- `DELETE /api/network-towers/:id`.

### 2. Estado de torre
- `POST /api/network-towers/:id/state` para establecer estado explicito `online|warning|offline`.
- Se mantiene compatibilidad con endpoint existente:
  - `POST /api/network-towers/:id/toggle-state`.

### 3. Sectores por torre
- Modelo en memoria `NETWORK_SECTORS` agregado.
- Endpoints:
  - `GET /api/network-towers/:id/sectors`
  - `POST /api/network-towers/:id/sectors`
  - `PUT /api/network-sectors/:id`
  - `DELETE /api/network-sectors/:id`
- El estado agregado de sectores actualiza estado operativo de torre.

### 4. Compatibilidad y no ruptura
- Endpoints consumidos por frontend actual permanecen vigentes.
- No se tocaron componentes visuales ni layout del modulo de red.

## Archivos
- `backend/domains/network/routes.ts`
- `backend/state/store.ts`

## Validacion
- `npm run lint`: OK
- `npm run build`: pendiente de ejecucion en este documento
