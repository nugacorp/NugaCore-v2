# Auditoría UX — Router Onboarding Wizard (Fase 4.9)

## 1. Flujo actual fragmentado

Para agregar un router a NugaCore, un técnico hoy debe:

| Paso | Módulo | Pantalla |
|------|--------|----------|
| 1. Crear router en provisioning | MikroTik Core | MikrotikRoutersPanel → "Crear Router" |
| 2. Elegir tipo de conexión (WireGuard/SSTP) | MikroTik Core | MikrotikRoutersPanel → Generar Script |
| 3. Ir al módulo WireGuard para entender el servidor | WireGuard Manager | WireguardManagerModule |
| 4. Volver y elegir servidor WG | MikroTik Core | MikrotikRoutersPanel (dropdown servidores) |
| 5. Generar script .rsc | MikroTik Core | MikrotikRoutersPanel → "Generar Script" |
| 6. O ir al módulo Enrollment si quiere WG automático | Router Enrollment | RouterEnrollmentWizard (7 pasos) |
| 7. Elegir plantilla base | RouterOS Templates | RouterOsTemplatesModule (separado) |
| 8. Descargar .rsc | Router Enrollment | Paso 5 del wizard |
| 9. Instrucciones de importación | Router Enrollment | Paso 6 del wizard |
| 10. Confirmar online | Router Enrollment | Paso 7 del wizard |

**Resultado:** 3-4 módulos distintos, 10+ pasos, conceptos internos expuestos.

---

## 2. Módulos que intervienen

### MikrotikRoutersPanel (Fase 4.4)
- Crea routers en el store con `provisioningMode`, `connectionType`, `apiPort`, etc.
- Genera scripts de provisioning por rol.
- No tiene flujo guiado.

### WireguardManagerModule (Fase 4.5)
- Administra servidores WireGuard y peers.
- El técnico necesita entender qué es un "peer" y qué es un "servidor WireGuard".
- No tiene relación directa con el onboarding de routers para el usuario final.

### RouterEnrollmentWizard (Fase 4.7)
- Wizard de 7 pasos para enrollment automático WireGuard.
- Requiere que el usuario **seleccione manualmente el servidor WireGuard** (Paso 2).
- No incluye selección de plantilla.
- No incluye campos de tipo de router, modelo ni sitio.
- **Es el más cercano a lo que necesitamos, pero está en un módulo separado.**

### RouterOsTemplatesModule (Fase 4.6.3)
- Genera scripts de plantilla independientemente del enrollment.
- Tiene 13 plantillas en 8 categorías.
- No está conectado al flujo de enrollment.

---

## 3. Pasos técnicos que NO deben exponerse al usuario final

| Concepto técnico | Acción | Solución en el Wizard |
|-----------------|--------|----------------------|
| `wgServerId` | Seleccionar servidor WireGuard | Usar `DEFAULT_WIREGUARD_SERVER` automáticamente |
| `wgPeerId` | Crear peer WG manualmente | Lo hace el backend en `/start` |
| `assignedIp` | Asignar IP VPN manualmente | Lo hace el backend automáticamente |
| Private key WireGuard | Copiar y pegar clave | Embebida en el .rsc; nunca visible en UI |
| `enrollmentId` | Gestionar ID interno | Transparente para el usuario |
| Ir al módulo WG Manager | Navegar a otra pantalla | No necesario |
| Ir al módulo Templates | Navegar a otra pantalla | Selección integrada en wizard |
| `provisioningToken` | Token temporal de provisioning | Gestionado por backend |

---

## 4. Limitación actual del backend (Fase 4.9)

El endpoint `POST /api/router-enrollment/start` actualmente:
- **Usa siempre `router_base_wireguard`** como template del script WireGuard.
- Acepta `lanCidr`, `lanGateway`, `lanBridgeName`, `wanInterface` para personalizar la LAN.
- Ignora `templateId`, `routerType`, `model`, `siteName`, `lanInterfaces` (campos extra del body JSON son ignorados por Express, no causan error).

**Implicación:** La selección de plantilla en el wizard es UI/UX. El script generado siempre usa `router_base_wireguard` para el túnel WireGuard. En una fase futura, el backend puede consumir `templateId` para generar scripts más especializados.

Los campos extra (`routerType`, `model`, `siteName`, `templateId`) se envían en el payload y se pueden leer del `notes` para trazabilidad.

---

## 5. Propuesta final de experiencia (Fase 4.9)

### Punto de entrada
Botón **[ + Agregar Router ]** en el módulo MikroTik (visible para Super Admin, Administrador, Técnico).

### Wizard modal — 7 pasos

```
[1. Datos]  →  [2. Conectividad]  →  [3. Plantilla]  →  [4. LAN]
             →  [5. Generar]  →  [6. Descargar]  →  [7. Confirmar]
```

| Paso | Lo que ve el usuario | Lo que ocurre internamente |
|------|---------------------|---------------------------|
| 1 | Nombre, tipo (torre/core/etc), modelo, ROS versión, sitio | Valida campos requeridos |
| 2 | ✅ "Administrado por NugaCore VPN" (no toca nada) | Verifica que existe DEFAULT_WIREGUARD_SERVER |
| 3 | Elige plantilla por nombre amigable | Mapea a `templateId` interno |
| 4 | CIDR LAN, gateway, bridge, WAN interface | Prepara payload |
| 5 | Clic en "Generar Configuración" | POST /api/router-enrollment/start |
| 6 | Descarga .rsc + instrucciones paso a paso | GET /api/router-enrollment/:id/download |
| 7 | Clic "Verificar conexión" | POST /api/router-enrollment/:id/check-online |

### Lo que el usuario NUNCA ve
- Conceptos de WireGuard peers o servidores
- Claves privadas
- IDs internos (enrollmentId, peerId)
- Módulo WireGuard Manager
- Módulo RouterOS Templates (separado)

---

## 6. Módulos NO modificados

- `RouterEnrollmentWizard.tsx` — permanece intacto en su módulo
- `WireguardManagerModule` — sin cambios
- `RouterOsTemplatesModule` — sin cambios
- `MikrotikRoutersPanel` — sin cambios (provisioning avanzado sigue disponible)
- Ningún backend domain

---

## 7. Riesgos identificados

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| No existe DEFAULT_WIREGUARD_SERVER | Media | El wizard muestra error claro en Paso 2 |
| Template v7-only elegida con ROS v6 | Media | Advertencia visual en Paso 3 |
| El script contiene claves privadas | Siempre | Vista previa sanitizada, instrucciones de borrar .rsc |
| Router no conecta en Paso 7 | Alta en lab | Texto claro de reintentar; no bloquea el flujo |
