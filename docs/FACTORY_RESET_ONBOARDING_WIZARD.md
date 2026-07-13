# Factory Reset Onboarding Wizard

## Flujo técnico

1. **Preparación** — Checklist factory-reset (backup, acceso Winbox, WAN operativo)
2. **Datos** — Nombre, tipo, modelo, sitio
3. **Conectividad** — Peer WireGuard automático (NugaCore VPN)
4. **Plantilla** — Por defecto `nugacore_factory_onboarding`
5. **LAN** — Parámetros dinámicos o defaults seguros
6. **Generar** — `POST /api/router-enrollment/start`
7. **Descargar** — Script `.rsc` + comunidad SNMP (una vez)
8. **Confirmar** — `POST /api/router-enrollment/:id/check-online`

## Import manual en MikroTik

```routeros
/system backup save name=pre-nugacore
/import file-name=nugacore-tpl-<router>.rsc
/file remove [find name~"nugacore-tpl-"]
```

## Qué incluye el script

- Identidad + LAN configurable desde UI (WAN, bridge, CIDR, DHCP, DNS)
- Túnel WireGuard `NugaCoreWG` hacia el VPS (**peer automático**, no editable en UI)
- Usuario API `nugacore_*` con permisos mínimos
- SNMP habilitado (comunidad v2c, solo lectura)
- Firewall: API y SNMP solo desde red VPN

## Parámetros configurables en UI (plantilla factory)

| Grupo | Campos |
|-------|--------|
| Red local | WAN, bridge, CIDR, puertos LAN, DHCP, pool, DNS |
| Sitio | Nombre zona (SNMP sysLocation) |
| API | Puerto API RouterOS |

**No configurable:** servidor WireGuard del VPS, endpoint, claves, IP VPN del peer — se crean al generar el script (`POST /start`).

## WireGuard (automático)

1. El servidor WG corre en el **host VPS** (`wg0`, puerto UDP 13231).
2. NugaCore usa el servidor WireGuard **default** registrado en la app.
3. Cada `POST /start` crea **un peer** con IP y claves únicas.
4. El cliente no puede enviar `wgServerId` ni parámetros `wg*` (ignorados/rechazados).

## Verificación online

- `source=live` → router alcanzable vía API sobre VPN (`MIKROTIK_WORKER_LIVE=true`)
- `source=simulated` → flags live desactivados; el enrollment queda en `waiting_for_router`

## Referencias

- Runbook VPS: `docs/SNMP_LIVE_VPS_RUNBOOK.md`
- Arquitectura SNMP: `docs/SNMP_LIVE_ARCHITECTURE.md`
- Wizard UI: `src/components/RouterOnboardingWizard.tsx`
