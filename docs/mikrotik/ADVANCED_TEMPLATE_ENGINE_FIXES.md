# Advanced Template Engine — Hotfix de Bloqueadores (Fase 4.9.1)

Hermes validó `cb8036c` y reportó 3 bloqueadores. Este documento describe la causa raíz, la corrección y los tests de cada uno.

## Bloqueador 1 — Peer WireGuard huérfano por templateId inexistente

### Síntoma
`POST /api/router-enrollment/start` con `templateId='no_existe'` devolvía correctamente `HTTP 400 TEMPLATE_NOT_FOUND`, pero el conteo de peers subía (`peers=3 → peers=4`).

### Causa raíz
El orden de operaciones en `enrollmentService.start()` validaba el `templateId` **dentro** de `buildScript()`, que se ejecutaba **después** de `getPeerConfigForRouter()` (creación del peer):

```
start()
  → buildScript()
       → getPeerConfigForRouter()   ← CREA EL PEER
       → resolveTemplateParams()    ← valida templateId, lanza TEMPLATE_NOT_FOUND
```

Existía un rollback best-effort en el `catch`, pero `revokePeer()` marca el peer como `revoked` sin eliminarlo del repositorio, por lo que el conteo total seguía incrementando.

### Corrección
Se movió la validación del `templateId` al **inicio** de `start()`, antes de tocar WireGuard:

```
start()
  1. Validar input básico (routerName, routerosVersion)
  2. Validar templateId            ← TEMPLATE_NOT_FOUND aquí, sin crear peer
  3-4. Resolver servidor WireGuard
  5. Crear/reutilizar peer
  6. Generar script
  7. Crear router
  8. Crear enrollment
```

`backend/domains/router-enrollment/service.ts`:
```typescript
const effectiveTemplateId = input.templateId?.trim() || 'router_base_wireguard';
validateEnrollmentTemplateId(effectiveTemplateId);  // lanza ANTES de WireGuard
```

El rollback best-effort en el `catch` se conserva como defensa para fallos que ocurran **después** del paso 5 (p. ej. un error del generador).

### Tests
`tests/contract/router-enrollment.templates.contract.test.ts`:
- templateId inválido no incrementa el conteo de peers
- templateId inválido no crea enrollment
- templateId inválido no agrega router al store
- conteos antes/después idénticos (peers, enrollments, routers)
- control positivo: un templateId válido sí crea exactamente un peer

## Bloqueador 2 — GET detail sin templateName ni generatorVersion

### Síntoma
`GET /api/router-enrollment/:id` devolvía `templateId` y `routerosVersion`, pero no `templateName` ni `generatorVersion`.

### Causa raíz
`RouterEnrollmentView` no incluía esos campos. La respuesta de `POST /start` sí los tenía (se calculaban inline), pero el detalle (`getById`) y la lista (`list`) no.

### Corrección
Se derivan desde el `templateId` **sin persistir** información duplicada. Nuevo helper en `template-mapper.ts`:

```typescript
export function getTemplateMetadata(templateId: string): TemplateMetadata {
  const descriptor = getTemplateById(templateId as TemplateLibraryId);
  return {
    templateName:     descriptor?.name ?? templateId,
    generatorVersion: descriptor?.generatorVersion ?? TEMPLATE_LIBRARY_VERSION,
  };
}
```

`toView()` ahora lo invoca, por lo que `getById` **y** `list` exponen ambos campos automáticamente. No se exponen ni script ni claves.

### Tests
- GET /:id incluye templateName (legible, no el id)
- GET /:id incluye generatorVersion
- GET /:id NO expone script ni claves (privateKey, presharedKey, wgPrivateKey)
- GET / (list) incluye ambos campos en cada item
- templateName/generatorVersion del detalle coinciden con los de start
- unit: `getTemplateMetadata` para los 9 templates + fallback de id desconocido

## Bloqueador 3 — Wizard no conservaba la selección de plantilla

### Síntoma
Al seleccionar "Balanceador PCC — 5 WAN" en el paso 3 y avanzar al paso Generar, el resumen mostraba "Router Base + WireGuard".

### Análisis
La selección en el paso 3 (`setF({ templateId: tpl.id })`) y el resumen del paso 5 leen ambos `form.templateId`; la cadena de estado del componente es correcta y no se encontró ningún punto de remontaje en la cadena de render (`MikrotikModule` y el wizard se montan sin `key` ni condición que parpadee). El riesgo real es la **divergencia** entre lo que el resumen muestra y lo que el payload envía, más una fragilidad por referencias anidadas compartidas con el objeto por defecto.

### Corrección
1. **Fuente única de verdad** para la etiqueta de plantilla: nuevo helper `getTemplateLabel(templateId)` en `routerOnboardingView.ts`, usado por el resumen del paso 5. El resumen y el payload (`buildAdvancedEnrollmentPayload`) leen ahora el mismo `form.templateId`, eliminando la posibilidad de divergencia.

2. **Endurecimiento del estado**: el formulario por defecto se clona con objetos anidados frescos (`freshDefaultForm()`), tanto en el inicializador de `useState` (lazy) como en `handleClose`. Evita que mutaciones de `wanConfigs`/`lanAdvanced`/`security` contaminen `DEFAULT_ADVANCED_FORM` entre aperturas del wizard.

```typescript
const freshDefaultForm = (): AdvancedOnboardingForm => ({
  ...DEFAULT_ADVANCED_FORM,
  wanConfigs: DEFAULT_ADVANCED_FORM.wanConfigs.map((w) => ({ ...w })),
  lanAdvanced: { ...DEFAULT_ADVANCED_FORM.lanAdvanced },
  security: { ...DEFAULT_ADVANCED_FORM.security },
});
```

### Tests
`tests/unit/router.onboarding.advanced.test.ts`:
- `getTemplateLabel` para pcc_5wan, router_base_wireguard, noc_ready, pppoe_server, fallback de id
- seleccionar pcc_5wan: el label del resumen muestra "Balanceador PCC — 5 WAN"
- seleccionar pcc_5wan: el payload contiene `templateId='pcc_5wan'`
- seleccionar pcc_5wan NO revierte a router_base_wireguard
- cambiar de pcc_5wan a noc_ready actualiza label y payload
- sin selección (default): label y payload son router_base_wireguard
- selección pcc_5wan en modo avanzado conserva templateId en payload

## Resultado de validación

- `npm run typecheck` → PASS
- `npm test` → 860 passed, 34 skipped, 0 failures
- `npm run build` → PASS

## Riesgos restantes

- **Modo básico PCC**: solo se envía `wanInterface` (singular); los gateways WAN restantes se completan con placeholders en el script generado (con warnings). Se resuelve en Fase 4.9.2 usando `wanConfigs` del modo avanzado.
- **Templates no-WG**: crean un peer WireGuard para management futuro, pero el script generado no embebe credenciales WG. Comportamiento intencional en esta fase.
- **Wizard**: no se reprodujo un remontaje en la cadena de render actual; si el entorno de staging sirviera un bundle cacheado, debe forzarse un rebuild. La cadena de datos (selección → resumen → payload) quedó canónica y cubierta por tests.
