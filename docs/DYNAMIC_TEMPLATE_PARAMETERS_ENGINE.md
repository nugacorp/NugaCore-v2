# Dynamic Template Parameters Engine — Fase 4.9.2

## Objetivo

Convertir el Router Onboarding Wizard en un generador profesional de
configuraciones RouterOS: cada plantilla declara su esquema de parámetros,
el Wizard renderiza el formulario dinámicamente (sin hardcodear campos) y el
`.rsc` se genera usando esos parámetros.

## Arquitectura

```
Wizard (frontend)
  ├─ GET /api/router-templates/:id/parameters   → esquema de la plantilla
  │     src/lib/templateParametersView.ts (helpers de formulario)
  └─ POST /api/router-enrollment/start
        { templateId, templateParameters: { ... } }
              ↓
  backend/domains/router-enrollment/service.ts
        ├─ validateEnrollmentTemplateId()         (Fase 4.9.1)
        ├─ applyDefaults() + validateTemplateParameters()   ← NUEVO (antes de WireGuard)
        ├─ crear peer WireGuard
        ├─ resolveTemplateParams()                (Fase 4.9.1, base)
        ├─ mapParametersToLibraryParams()         ← NUEVO (override dinámico)
        └─ generateFromTemplate({ ...base, ...dynamic })
              ↓
  backend/domains/routeros-templates/generator.ts   (sin cambios)
```

### Nuevo dominio: `backend/domains/router-template-parameters/`

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | `TemplateParameter`, `TemplateParameterGroup`, `TemplateParameterSchema`, valores |
| `schemas.ts` | Builders reutilizables (`str`, `num`, `bool`, `ip`, `cidr`, `select`, `wanGroup`) |
| `registry.ts` | Esquema de parámetros por plantilla + `getParameterSchema()` |
| `validators.ts` | `validateTemplateParameters()`, `redactSecretValues()`, `applyDefaults()` |
| `mappers.ts` | `mapParametersToLibraryParams()` → traduce al shape del generador |
| `routes.ts` | `GET /api/router-templates/:id/parameters` |

## Endpoint

```
GET /api/router-templates/:id/parameters
RBAC: super admin, administrador, tecnico
200 → TemplateParameterSchema
404 → { code: 'TEMPLATE_PARAMETERS_NOT_FOUND' }
```

## Modelo de parámetro

```ts
{ id, label, type: 'string'|'number'|'boolean'|'select'|'ip'|'cidr',
  required, defaultValue?, options?, description?, secret? }
```

Los grupos `nested:true` (wan1…wanN) viven anidados en los valores; el grupo
`global` es plano.

## Plantillas soportadas

| templateId | Parámetros |
|---|---|
| `router_base_wireguard` | lanCidr, dhcpEnabled, dnsServers (WireGuard lo gestiona NugaCore) |
| `tower_wisp` | lanCidr, dhcpEnabled, dnsServers, vlanManagement, vlanClients |
| `pcc_2wan`…`pcc_5wan` | global: pbrEnabled, lanCidr, dhcpEnabled, dnsServers · por WAN: mode, interface, gateway, bandwidthMbps, pingTarget (+username/password PPPoE) |
| `pppoe_server` | pppoeInterface, poolStart, poolEnd, localAddress, dnsServers |
| `noc_ready` | telegramEnabled, netwatchEnabled, emailAlerts |
| `monitoring_agent` | watchdogTarget, enableAutoBackup |

`wireguard_managed` queda cubierto por `router_base_wireguard` (WG gestionado por
NugaCore; el usuario nunca modifica wgPeer/wgKeys/wgServer). `hotspot_basic` se
difiere a una fase futura: requiere un generador RouterOS nuevo (no se inventa
aquí para no romper la RouterOS Templates Library).

## Qué consume el generador hoy

El mapper traduce al shape `TemplateLibraryParams` existente:
- `lanCidr` (gateway/CIDR) → `lanGateway` (IP) + `lanCidr` (red derivada por máscara).
- `dnsServers` (csv) → `dnsServers[]`.
- PCC `wanN.interface/gateway` → `wanInterfaces[]` / `wanGateways[]`.
- PPPoE `pppoeInterface/poolStart/poolEnd/localAddress` → campos PPPoE del generador.
- Tower `vlanManagement/vlanClients`; Monitoring `watchdogTarget/enableAutoBackup`.

Parámetros aún no consumidos por el generador (`pbrEnabled`, `dhcpEnabled`,
`bandwidthMbps`, `pingTarget`, alertas NOC, credenciales PPPoE por WAN) se
**persisten** en `templateParameters` para compatibilidad futura, sin afectar la
generación actual (mismo patrón que Fase 4.9.1).

## Persistencia

- `RouterEnrollmentRecord.templateParameters` (in-memory store) — set completo (defaults aplicados).
- Migración `20260613120000_router_enrollment_template_parameters.sql` → columna `template_parameters JSONB`.
- `RouterEnrollmentView.templateParameters` — **con secretos redactados**.

## Seguridad

- Parámetros `secret:true` (password PPPoE) se persisten para regeneración pero:
  - NUNCA en la vista (`redactSecretValues` → `<REDACTED>`).
  - NUNCA en `scriptPreview` (el preview ya redacta `password=`).
  - NUNCA en logs (start/buildScript no loguean parámetros).
- Validación de parámetros ocurre ANTES de crear el peer WireGuard: parámetros
  inválidos → 400 `TEMPLATE_PARAMETERS_INVALID` sin dejar recursos huérfanos.

## Download

`GET /api/router-enrollment/:id/download` regenera con `templateId`,
`routerosVersion` y `templateParameters` persistidos (sin defaults ad-hoc).

## Wizard

- Paso 3: selección de plantilla (`form.templateId`).
- Paso 3 → 4: `GET /api/router-templates/:id/parameters` y se inicializan los
  valores con los defaults del esquema.
- Paso 4: formulario **dinámico** generado desde el esquema (sin campos
  hardcodeados). Visibilidad condicional: gateway solo en estática; usuario/
  password solo en PPPoE. Cada campo lleva `data-testid="param-<grupo>-<id>"`.
- Paso 5: resumen muestra plantilla + nº de parámetros configurados.
- `POST /start` incluye `templateParameters`.

## Riesgos / pendientes

- `hotspot_basic` y un generador PPPoE-por-WAN real quedan para una fase futura.
- Parámetros persistidos-para-futuro (ver arriba) no alteran el `.rsc` hasta que
  el generador los consuma.
- El password PPPoE se persiste en claro en `template_parameters` (JSONB) para
  permitir regeneración; protegido por RLS deny-by-default y redacción en API.
