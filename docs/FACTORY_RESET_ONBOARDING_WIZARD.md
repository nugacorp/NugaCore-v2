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

- Identidad + LAN mínima (bridge, DHCP, NAT, firewall básico)
- Túnel WireGuard `NugaCoreWG` hacia el VPS
- Usuario API `nugacore_*` con permisos mínimos
- SNMP habilitado (comunidad v2c, solo lectura)
- Firewall: API y SNMP solo desde red VPN

## Verificación online

- `source=live` → router alcanzable vía API sobre VPN (`MIKROTIK_WORKER_LIVE=true`)
- `source=simulated` → flags live desactivados; el enrollment queda en `waiting_for_router`

## Referencias

- Runbook VPS: `docs/SNMP_LIVE_VPS_RUNBOOK.md`
- Arquitectura SNMP: `docs/SNMP_LIVE_ARCHITECTURE.md`
- Wizard UI: `src/components/RouterOnboardingWizard.tsx`
