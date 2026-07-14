# NugaCore — Arquitectura SNMP Live

## Resumen

El monitoreo SNMP live complementa el poller RouterOS API (NOC) con lecturas UDP 161 sobre la red VPN WireGuard. El piloto v1 cubre routers MikroTik enrolados con la plantilla `nugacore_factory_onboarding`.

## Componentes

| Pieza | Ubicación | Rol |
|-------|-----------|-----|
| Plantilla factory | `backend/domains/routeros-templates/generator.ts` | Script `.rsc` con WG + API + SNMP |
| Enrollment | `backend/domains/router-enrollment/` | Comunidad SNMP cifrada en snapshot |
| Poller | `backend/domains/snmp-poller/` | Ciclo UDP gated por `SNMP_POLLER_ENABLED` |
| Dashboard | `backend/domains/dashboard/zone-status.ts` | `source: snmp-live` en equipos router |
| API | `GET /api/snmp/health`, `/api/snmp/targets` | Estado y targets (sin comunidades) |

## OIDs mínimos (piloto)

- `1.3.6.1.2.1.1.3.0` — sysUpTime
- `1.3.6.1.2.1.1.5.0` — sysName

Fase 2: IF-MIB (`ifOperStatus`), HOST-RESOURCES-MIB para switches/radios registrados en inventario.

## Seguridad

- Comunidad SNMP **solo lectura** en RouterOS
- Firewall: UDP 161 y API 8728/8729 solo desde CIDR VPN
- Comunidad mostrada **una vez** en `POST /api/router-enrollment/start`
- Snapshot cifrado con `MIKROTIK_CREDENTIALS_KEY`; nunca en logs
- `SNMP_POLLER_ENABLED=false` por defecto

## Flags runtime

```env
SNMP_POLLER_ENABLED=false
SNMP_POLLER_INTERVAL_MS=120000
NOC_POLLER_ENABLED=false
MIKROTIK_WORKER_LIVE=false
```

Activar live solo tras piloto documentado en `docs/SNMP_LIVE_VPS_RUNBOOK.md`.

## Límites v1

- Solo routers MikroTik con enrollment SNMP
- SNMPv2c (v3 en fase 2)
- Sin SNMP SET; control operativo vía API RouterOS
