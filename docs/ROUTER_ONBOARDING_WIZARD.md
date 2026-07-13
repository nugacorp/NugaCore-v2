# Router Onboarding Wizard — Fase 4.9

## Objetivo

Proporcionar una experiencia unificada y simplificada para agregar un router MikroTik a NugaCore
desde el módulo MikroTik, sin exponer conceptos internos de WireGuard peers, servidores o enrollment.

---

## Flujo UX (8 pasos)

```
[ + Agregar Router ]
        ↓
0. Preparación         → checklist factory-reset (backup, acceso, WAN)
        ↓
1. Datos del router    → nombre, tipo, modelo, versión RouterOS, sitio
        ↓
2. Conectividad        → NugaCore VPN administrada automáticamente
        ↓
3. Plantilla inicial   → por defecto `nugacore_factory_onboarding`
        ↓
4. Configuración LAN   → CIDR, gateway, bridge, WAN, DHCP
        ↓
5. Generar             → llama POST /api/router-enrollment/start
        ↓
6. Descargar .rsc      → copiar script + comunidad SNMP (una vez)
        ↓
7. Confirmar online    → POST /api/router-enrollment/:id/check-online
```

Ver también: `docs/FACTORY_RESET_ONBOARDING_WIZARD.md`

---

## Endpoints utilizados

| Método | Endpoint | Propósito |
|--------|----------|-----------|
| `GET` | `/api/wireguard/servers` | Verificar disponibilidad de servidor WG default (Paso 2) |
| `POST` | `/api/router-enrollment/start` | Generar enrollment + script .rsc (Paso 5) |
| `GET` | `/api/router-enrollment/:id/download` | Descargar script .rsc (Paso 6) |
| `POST` | `/api/router-enrollment/:id/check-online` | Confirmar router online (Paso 7) |

### Payload de POST /start

```json
{
  "routerName": "Torre Norte",
  "routerosVersion": "7",
  "routerType": "tower",
  "templateId": "tower_wisp",
  "lanCidr": "192.168.88.0/24",
  "lanGateway": "192.168.88.1",
  "lanBridgeName": "bridgeLAN",
  "wanInterface": "ether1",
  "lanInterfaces": "ether2,ether3,ether4,ether5",
  "notes": "[tower] Modelo: RB5009 | Sitio: Torre del Valle | Plantilla: tower_wisp"
}
```

> `wgServerId` se **omite** deliberadamente para que el backend use `DEFAULT_WIREGUARD_SERVER`.

> `routerType`, `templateId` y `lanInterfaces` son enviados pero actualmente ignorados por el backend.
> En una fase futura, el backend puede consumirlos para generar scripts más especializados.

---

## RBAC

| Rol | Puede agregar router |
|-----|---------------------|
| Super Admin | ✅ |
| Administrador | ✅ |
| Técnico | ✅ |
| Cobranza | ❌ |
| Soporte | ❌ |
| Solo lectura | ❌ |

Helper: `canStartRouterOnboarding(role)` en `src/lib/routerOnboardingRbac.ts`

---

## Plantillas disponibles

| ID interno | Nombre amigable | ROS compatible |
|-----------|----------------|----------------|
| `router_base_wireguard` | Router Base + WireGuard | v7 only |
| `tower_wisp` | Torre WISP | v7 only |
| `pcc_2wan` | Balanceador PCC 2 WAN | v6/v7 |
| `pcc_3wan` | Balanceador PCC 3 WAN | v6/v7 |
| `pcc_4wan` | Balanceador PCC 4 WAN | v6/v7 |
| `pcc_5wan` | Balanceador PCC 5 WAN | v6/v7 |
| `pppoe_server` | Servidor PPPoE | v6/v7 |
| `noc_ready` | NOC Ready | v6/v7 |
| `monitoring_agent` | Lab / CHR | v6/v7 |

El wizard muestra una advertencia visual si se selecciona una plantilla v7-only con RouterOS v6.

---

## Cómo usar

### Para el usuario final (técnico / admin)

1. Ve al módulo **MikroTik**.
2. Clic en **[ + Agregar Router ]** (esquina superior derecha del header).
3. Completa los 7 pasos del wizard.
4. Descarga el archivo `.rsc` generado.
5. Súbelo al MikroTik via WinBox → Files, o via FTP.
6. En Terminal RouterOS: `/import file-name=<archivo>.rsc`
7. Elimina el archivo: `/file remove [find name~"nugacore-tpl-"]`
8. Clic en **Verificar conexión** en el wizard.

### Para el desarrollador

El wizard vive en `src/components/RouterOnboardingWizard.tsx`.

Props requeridas:
```typescript
interface RouterOnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
  userRole: UserRole | string | null;
  getAuthHeaders: () => Promise<Record<string, string>>;
}
```

Los helpers puros están en `src/lib/routerOnboardingView.ts` y son importables sin React.

---

## Qué pasa si no hay servidor WireGuard default

El Paso 2 (Conectividad) llama a `GET /api/wireguard/servers` para verificar si existe
al menos un servidor activo.

Si **no existe**:
- Se muestra un bloque de advertencia: _"No existe un servidor WireGuard principal activo."_
- El botón "Siguiente" queda deshabilitado.
- El usuario debe crear un servidor en el módulo **WireGuard Manager** primero.

Si **sí existe**:
- Se muestra confirmación verde.
- El usuario puede avanzar.

---

## Limitaciones (Fase 4.9)

1. **Template = siempre `router_base_wireguard`** en el script generado. El backend hardcodea
   este template para el script WireGuard. `templateId` es enviado pero ignorado por ahora.

2. **DHCP start/end y lanInterfaces** no son consumidos por el backend actualmente. Se envían
   en el payload para trazabilidad futura.

3. **Sin soporte multi-WAN en el wizard** — las plantillas PCC se pueden seleccionar pero el
   script generado siempre es el base. Fase 5.x puede wiring completo de templates.

4. **No revoca automáticamente** un enrollment anterior del mismo router. Si el usuario repite
   el onboarding, crea un nuevo enrollment.

---

## Siguiente fase sugerida (Fase 5.0)

- Wiring completo del `templateId` en el backend de enrollment.
- Soporte de `lanInterfaces` en el generator.
- Vista de enrollments en curso desde el wizard.
- Detección automática de enrollments duplicados.
