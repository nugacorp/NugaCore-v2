# Advanced Template Engine — NugaCore (Fase 4.9.1)

## Objetivo

Conectar el templateId seleccionado en el Router Onboarding Wizard con el generador correcto de la RouterOS Templates Library. Cada plantilla produce un script `.rsc` diferente.

## Arquitectura

### Capas involucradas

```
src/components/RouterOnboardingWizard.tsx       ← frontend: wizard
  └─ POST /api/router-enrollment/start
       { templateId: 'pcc_5wan', ... }
              ↓
backend/domains/router-enrollment/routes.ts
              ↓
backend/domains/router-enrollment/service.ts
  ├─ resolveTemplateParams()                    ← NUEVO
  │     backend/domains/router-enrollment/template-mapper.ts
              ↓
backend/domains/routeros-templates/generator.ts
  └─ generateFromTemplate(params)               ← sin cambios
```

### Nuevo archivo: template-mapper.ts

Responsabilidades:
1. Validar que el `templateId` es soportado en enrollment (`ENROLLMENT_SUPPORTED_TEMPLATES`)
2. Determinar si la plantilla necesita credenciales WireGuard (`needsWireGuard`)
3. Construir los `TemplateLibraryParams` correctos para `generateFromTemplate()`
4. Devolver `templateName` y `generatorVersion` para la respuesta de la API

## Mapeo de templates

| Wizard ID | Generador | needsWireGuard | Script contiene |
|---|---|---|---|
| `router_base_wireguard` | `genRouterBaseWireguard()` | ✓ | Bridge, DHCP, NAT, WireGuard NugaCore |
| `tower_wisp` | `genTowerWisp()` | ✓ | VLANs, Bridge, WireGuard, Backups |
| `pcc_2wan` | `genPcc(p, 2)` | ✗ | PCC 2 WAN, Netwatch, Failover |
| `pcc_3wan` | `genPcc(p, 3)` | ✗ | PCC 3 WAN, Netwatch, Failover |
| `pcc_4wan` | `genPcc(p, 4)` | ✗ | PCC 4 WAN, Netwatch, Failover |
| `pcc_5wan` | `genPcc(p, 5)` | ✗ | PCC 5 WAN, Netwatch, Failover |
| `pppoe_server` | `genPppoeServer()` | ✗ | PPPoE Server, pools, perfiles |
| `noc_ready` | `genNocReady()` | ✗ | API segura, usuario nugacore, logging |
| `monitoring_agent` | `genMonitoringAgent()` | ✗ | Watchdog, scheduler, backups |

## Persistencia

### RouterEnrollmentRecord (nuevo campo)
```typescript
templateId: string   // plantilla usada en la generación
```

### RouterEnrollmentView (campos nuevos)
```typescript
templateId: string         // visible en GET /api/router-enrollment/:id
templateName: string       // derivado de templateId (no persistido)
generatorVersion: string   // derivado de templateId (no persistido)
```

> `templateName` y `generatorVersion` se derivan al vuelo desde `templateId`
> vía `getTemplateMetadata()`; no se duplica información en la base de datos.
> Ver [ADVANCED_TEMPLATE_ENGINE_FIXES.md](./ADVANCED_TEMPLATE_ENGINE_FIXES.md).

### StartEnrollmentInput (nuevo campo opcional)
```typescript
templateId?: string  // omitir → router_base_wireguard (backward compat)
```

### StartEnrollmentResult (nuevos campos)
```typescript
templateId: string       // ID de la plantilla usada
templateName: string     // nombre legible
generatorVersion: string // versión del generador
```

### Migración SQL
Archivo: `supabase/migrations/20260613000000_router_enrollment_template_id.sql`

```sql
ALTER TABLE router_enrollment
  ADD COLUMN IF NOT EXISTS template_id TEXT NOT NULL DEFAULT 'router_base_wireguard';
```

## Validación

`POST /api/router-enrollment/start` con `templateId` inválido:

```json
HTTP 400
{
  "error": "templateId 'no_existe' no válido para enrollment. Templates soportados: ...",
  "code": "TEMPLATE_NOT_FOUND"
}
```

## Comportamiento de Download

`GET /api/router-enrollment/:id/download` regenera el script usando el `templateId` persistido en el record. Ya no asume `router_base_wireguard`.

```
record.templateId = 'pcc_5wan'
  → download() llama buildScript() con input.templateId = 'pcc_5wan'
  → resolveTemplateParams('pcc_5wan', ...)
  → generateFromTemplate({ templateId: 'pcc_5wan', ... })
  → script PCC 5 WAN
```

## Backward Compatibility

Si `templateId` se omite en `POST /start`, se usa `router_base_wireguard` (comportamiento pre-4.9.1). Todos los clientes existentes que no envían `templateId` continúan funcionando sin cambios.

## Riesgos y Limitaciones

### Fase 4.9.1 (actual)
- Templates PCC en modo básico solo usan `wanInterface` como primer WAN. Los gateways se completan con placeholders `<GATEWAY_WAN2>`, etc. El script incluye warnings.
- Templates no-WG crean un peer WireGuard pero no lo embeben en el script.

### Preparación para Fase 4.9.2 — TemplateParameters

La arquitectura está preparada para recibir parámetros específicos por plantilla. Ejemplo de extensión futura en `StartEnrollmentInput`:

```typescript
// Fase 4.9.2 — NO implementado aún
templateParameters?: {
  // PCC
  wanCount?: number;
  // NOC
  snmp?: boolean;
  // PPPoE
  poolName?: string;
};
```

El mapper en Fase 4.9.2 leerá `templateParameters` para enriquecer los parámetros PCC con los `wanGateways` reales del modo avanzado del wizard.

## Tests

### Unit tests
- `tests/unit/template-mapper.test.ts` — 50+ tests cubriendo:
  - `ENROLLMENT_SUPPORTED_TEMPLATES` (9 templates, exclusiones correctas)
  - `validateEnrollmentTemplateId()` (válidos, inválidos, null/undefined, code)
  - `resolveTemplateParams()` por cada template (libraryId, needsWireGuard, wgParams, pccParams)
  - `generatorVersion` presente en todos los templates

### Contract tests
- `tests/contract/router-enrollment.templates.contract.test.ts` — end-to-end:
  - `templateId` en respuesta de `POST /start`
  - `templateId` persistido y visible en `GET /:id`
  - `download` regenera el template correcto
  - `templateId` inválido → 400 TEMPLATE_NOT_FOUND
  - Todos los 9 templates retornan 201
  - Regresión: check-online y revoke no se ven afectados
