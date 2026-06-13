# Advanced Template Engine — Auditoría (Fase 4.9.1)

## 1. Flujo actual (antes de Fase 4.9.1)

```
Wizard (frontend)
  └─ POST /api/router-enrollment/start
       { routerName, routerosVersion, templateId: 'pcc_5wan', ... }
              ↓
  enrollmentService.start()
       ↓
  buildScript()
       ├─ generateFromTemplate({ templateId: 'router_base_wireguard', ... })  ← HARDCODED
       └─ resultado: script .rsc de Router Base WireGuard, siempre
```

## 2. Limitaciones encontradas

### 2.1 templateId ignorado en el backend

`buildScript()` en `service.ts` invocaba `generateFromTemplate()` con `templateId: 'router_base_wireguard'` hardcodeado. El `templateId` enviado por el wizard en el payload era leído por el servicio pero descartado antes de llegar al generador.

```typescript
// ANTES (línea 98 de service.ts)
const resource = generateFromTemplate({
  templateId: 'router_base_wireguard',  // ← siempre, sin importar lo que envió el wizard
  routerName: input.routerName,
  ...
});
```

### 2.2 templateId no persistido en el record

`RouterEnrollmentRecord` y `RouterEnrollmentView` no tenían campo `templateId`. El endpoint de descarga (`/download`) no podía saber qué plantilla se usó originalmente.

### 2.3 download() también hardcodeaba la plantilla

`download()` reconstruía el `StartEnrollmentInput` desde el store del router, sin `templateId`. `buildScript()` volvía a generar con `router_base_wireguard`.

### 2.4 templateId no en StartEnrollmentInput

`StartEnrollmentInput` no tenía campo `templateId`, por lo que TypeScript descartaba ese campo del body del request (aunque llegara correctamente desde el wizard).

### 2.5 templateId no validado

No existía validación de que el `templateId` enviado fuera uno de los soportados. Cualquier valor pasaba sin error, pero era descartado.

## 3. Impacto UX

| Acción del usuario | Expectativa | Realidad pre-4.9.1 |
|---|---|---|
| Selecciona PCC 5 WAN | Script .rsc con balanceo PCC 5 WAN | Script Router Base WireGuard |
| Selecciona NOC Ready | Script .rsc con configuración NOC | Script Router Base WireGuard |
| Selecciona PPPoE Server | Script .rsc con servidor PPPoE | Script Router Base WireGuard |
| Descarga el script | Misma plantilla que seleccionó | Siempre Router Base WireGuard |

El wizard mostraba **9 opciones distintas** pero el backend generaba **siempre la misma**.

## 4. Análisis de las 9 plantillas del wizard

### Templates con WireGuard incrustado en script

| ID | Generador | Requiere credenciales WG |
|---|---|---|
| `router_base_wireguard` | `genRouterBaseWireguard()` | Sí — wgPrivateKey, wgServerPublicKey, etc. |
| `tower_wisp` | `genTowerWisp()` | Sí — llama `sectionWireguard(p)` |

Estos templates siempre crean un peer WG y embeben las credenciales en el script.

### Templates sin WireGuard en script

| ID | Generador | Parámetros clave |
|---|---|---|
| `pcc_2wan` | `genPcc(p, 2)` | wanInterfaces, wanGateways |
| `pcc_3wan` | `genPcc(p, 3)` | wanInterfaces, wanGateways |
| `pcc_4wan` | `genPcc(p, 4)` | wanInterfaces, wanGateways |
| `pcc_5wan` | `genPcc(p, 5)` | wanInterfaces, wanGateways |
| `pppoe_server` | `genPppoeServer()` | pppoeInterface, pppoeServiceName |
| `noc_ready` | `genNocReady()` | nocApiCidr, apiPort |
| `monitoring_agent` | `genMonitoringAgent()` | watchdogTarget, enableAutoBackup |

Para estos templates, el peer WireGuard se crea igualmente (para futuro management NugaCore) pero las credenciales no se embeben en el script generado.

**Nota arquitectónica:** En Fase 4.9.2 se puede agregar una sección WireGuard opcional a templates no-WG para habilitar management remoto de todos los tipos de routers desde el dashboard NugaCore.

## 5. Comportamiento del generador con parámetros faltantes

El generador de RouterOS Templates tiene defaults para todos los parámetros opcionales:

- PCC sin `wanInterfaces`: usa `ether1, ether2, ...etherN` con warnings
- PCC sin `wanGateways`: usa placeholders `<GATEWAY_WAN1>` con warnings
- LAN sin parámetros: usa `192.168.1.0/24`, `192.168.1.1`

Este diseño defensivo permite que el mapper pase solo los datos disponibles del wizard sin romper la generación.

## 6. Arquitectura propuesta (implementada en Fase 4.9.1)

```
Wizard (frontend)
  └─ POST /api/router-enrollment/start
       { routerName, routerosVersion, templateId: 'pcc_5wan', ... }
              ↓
  enrollmentService.start()
       ├─ validar templateId (TEMPLATE_NOT_FOUND si inválido)
       ├─ crear peer WireGuard (siempre, para management)
       ├─ resolveTemplateParams(templateId, input, peerConfig)
       │     ├─ determina libraryId (mismo en esta fase)
       │     ├─ determina needsWireGuard (true solo para WG templates)
       │     └─ construye TemplateLibraryParams correctos
       ├─ generateFromTemplate(params) → script específico
       ├─ persiste templateId en RouterEnrollmentRecord
       └─ retorna { templateId, templateName, generatorVersion, script, ... }
```

## 7. Riesgos identificados

### 7.1 Parámetros avanzados PCC no fluyen en modo básico

En modo básico del wizard, solo se envía `wanInterface` (singular). El mapper lo convierte a `wanInterfaces: [wanInterface]`, dejando los WANs restantes con placeholders. El script se genera con warnings pero es funcional.

**Solución en Fase 4.9.2:** Usar `wanConfigs` del modo avanzado del wizard para pasar todos los gateways y nombres de interfaz.

### 7.2 Templates no-WG crean peer WG sin usarlo en el script

El peer WireGuard se crea en enrollment pero las credenciales no se embeben en scripts PCC/PPPoE/NOC/monitoring. Esto significa el router no se conectará automáticamente a NugaCore VPN al importar el script.

**Solución en Fase 4.9.2:** Opción de agregar sección WireGuard de management al final de cualquier script no-WG.

### 7.3 Templates no disponibles en wizard

La biblioteca tiene 13 templates pero el wizard expone 9. Templates como `router_base_sstp`, `wireguard_client`, `wireguard_server`, `client_residential` no están disponibles en enrollment. Esto es intencional en esta fase.

## 8. Verificación de regresión

- **WireGuard Auto Enrollment:** No modificado. El peer WG siempre se crea.
- **Check Online:** No toca templateId. Sin cambios.
- **Download:** Corregido para usar `templateId` persistido en el record.
- **Revoke:** No toca templateId. Sin cambios.
- **RBAC:** Sin cambios.
- **RouterOS Templates Library:** Reutilizada sin modificaciones.
