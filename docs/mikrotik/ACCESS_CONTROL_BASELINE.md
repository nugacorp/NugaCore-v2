# Control de acceso MikroTik (baseline NugaCore)

## Qué hace WispHub (referencia)

Al conectar el router, inyecta:

1. **Address lists** — autorizados / Moroso / Aviso / servers  
2. **Filter** — solo pasa quien está autorizado; el resto se niega  
3. **NAT dst-nat** — morosos/aviso redirigidos a portal de pago  
4. Ciclo de vida = **mover IP entre listas** (+ queues/PPP)

## Modelo NugaCore (mejor alineado)

| Lista RouterOS | Rol | Etiqueta UI opcional |
| --- | --- | --- |
| `nc-authorized` | Cliente al corriente | Autorizado |
| `nc-warning` | Aviso de pago (HTTP redirect) | Aviso |
| `nc-suspended` | Corte / redirect portal | Moroso |
| `nc-mgmt-servers` | IPs del portal NugaCore | Servers |

- Nombres estables en inglés (`nc-*`); no se copian strings `*_wisphub`.  
- Baseline ACL via plantillas RouterOS al conectar/enrollar el router.  
- Alta cliente → PPP/Queue + add a `nc-authorized`.  
- Aviso → deja `nc-authorized` y añade `nc-warning` (solo redirect HTTP).  
- Suspensión → move a `nc-suspended` + hard-cut PPP/queue + NAT redirect TCP/UDP.  
- Reactivación → vuelve a `nc-authorized` + enable PPP/queue.  
- En `existing_config` **no** se aplica drop global (evita cortar clientes legacy).  
- En `factory_reset` sí se niega forward no autorizado.

## Archivos

- Plantilla: `backend/domains/routeros-templates/generator.ts` (`sectionClientAccessControl`)  
- Comandos ciclo de vida: `backend/domains/mikrotik/access-control.ts`  
- Worker: `backend/domains/mikrotik/worker/worker.ts`  
- Alta cliente: `backend/domains/provisioning/customer-mikrotik-plan.ts`

## Operación

1. Conecta el MikroTik (onboarding / Routers → script plantilla).  
2. Añade la IP pública del portal a `nc-mgmt-servers` (o vía API futura).  
3. Crea planes y clientes por zona; el alta encola authorize + queue/PPP.  
4. El motor de suspensiones + worker mueve listas (commit gated).
