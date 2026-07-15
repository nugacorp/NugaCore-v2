# RouterOS `.rsc` — endurecimiento de import (julio 2026)

> Cambios en el generador de plantillas y enrollment para que `/import` en CHR
> / RouterOS 7 sea fiable. Sin secretos en este documento.

## Objetivos

1. Que el script generado se importe sin abortar a mitad.
2. Que WireGuard quede con private-key válida y peer del servidor.
3. Que la LAN sea opt-in segura (bridge vacío; el WISP agrega ports).
4. Nombres de archivo cortos compatibles con Terminal (`/import file-name=`).

## Decisiones técnicas

### Private key WireGuard top-level

RouterOS suele romper `private-key=` dentro de bloques `:if do={ … }` al pegar
o al parsear líneas largas (“failure: invalid private key”).  
**Patrón:** crear la interfaz y luego:

```
/interface wireguard set [find where name="NugaCoreWG"] private-key="…"
```

a nivel superior del script.

### Sin placeholders inválidos

Si faltan `wgServerPublicKey`, endpoint o IP del peer, el generador:

- crea la iface `NugaCoreWG` (y opcionalmente set de private-key),
- **omite** address/peer/route inválidos,
- emite warning en logs/metadata.

Evita que `/import` falle por `public-key=""` o `endpoint-address=""`.

### Bridge + LAN sin ports automáticos

Enrollment usa `enableLanStack: true` con `lanInterfaces: []` por defecto:

- crea bridge LAN + IP/DHCP según parámetros,
- **no** hace `bridge port add` automático (evita meter WAN al bridge).

El WISP añade ports LAN manualmente tras el import.

### `/ip service` y ROS 7.19+

Usar `find where name=… and dynamic=no` al setear/disable servicios estáticos.
Evita fallos con entradas dinámicas del sistema.

### Nombre de archivo

| Antes (ejemplo) | Ahora |
| --- | --- |
| `nugacore-tpl-router_base_wireguard-chr-12-….rsc` | `nc-wg.rsc` |

Implementación: `backend/domains/routeros-templates/rsc-filename.ts`.

### applyMode

- `factory_reset` — onboarding limpio (system note, más secciones).
- `existing_config` — no pisa notas/stacks agresivos; idempotente donde aplica.

## Archivos

- `backend/domains/routeros-templates/generator.ts`
- `backend/domains/routeros-templates/types.ts`
- `backend/domains/routeros-templates/rsc-filename.ts`
- `backend/domains/router-enrollment/template-mapper.ts`
- Tests: `tests/unit/routeros.templates.test.ts`, contratos de templates

## Uso recomendado en el router

Preferir archivo + import:

```
/import file-name=nc-wg.rsc
```

Evitar pegar el script completo en Terminal (líneas largas / concatenación).

## Verificación post-import (operador)

```
/interface wireguard print detail where name=NugaCoreWG
/interface wireguard peers print
/ip address print where interface=NugaCoreWG
/ping <IP-VPN-servidor>
```

El servidor debe tener el peer aplicado (host-apply automático); ver
[`docs/wireguard/WIREGUARD_HOST_APPLY.md`](../wireguard/WIREGUARD_HOST_APPLY.md).
