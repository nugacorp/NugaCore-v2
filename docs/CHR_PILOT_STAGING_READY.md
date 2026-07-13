# CHR Piloto — Staging listo (2026-07-13)

Infraestructura preparada en VPS `5.180.151.109` para el piloto factory-reset + SNMP live.

## Estado infra

| Componente | Estado |
|------------|--------|
| SSH Cloud Agent | OK (`ssh nugacore-vps`) |
| `wg0` host UDP 13231 | OK |
| Servidor WG NugaCore (API) | OK (`GET /api/wireguard/servers` → 1 default) |
| Staging deploy | `main` @ `0af05aa`+ (deploy #118 finished 2026-07-13) |
| `GET /api/snmp/health` | OK con JWT; `enabled:false` (esperado) |
| `USE_DB_WIREGUARD` | `true` en contenedor |
| Servidor WG en DB | OK (`wgs-*`, `isDefault=true`, pool `10.70.0.0/16`) |
| `SNMP_POLLER_ENABLED` | `false` hasta CHR validado |
| `MIKROTIK_WORKER_LIVE` | `false` hasta CHR online |

## Pasos operador (CHR físico requerido)

1. **Factory-reset** CHR de laboratorio.
2. **Wizard NugaCore** → plantilla `nugacore_factory_onboarding` → enrollment `/start`.
3. **Importar** `.rsc` en CHR; verificar túnel: `ping 10.70.0.1` desde CHR.
4. **Sincronizar peer en host:**
   ```bash
   bash scripts/vps/sync-wireguard-peers.sh
   ```
5. **`POST /api/router-enrollment/:id/check-online`** → esperar `source=live` (requiere `MIKROTIK_WORKER_LIVE=true`).
6. **Activar flags** en Coolify (solo tras paso 5 OK):
   - `MIKROTIK_WORKER_LIVE=true`
   - `SNMP_POLLER_ENABLED=true`
7. **Validar:**
   ```bash
   AUTH_BEARER=<jwt> APP_URL=https://nugacore-staging.5.180.151.109.sslip.io bash scripts/vps/validate-snmp-live.sh
   ```

## Rollback piloto

1. `MIKROTIK_WORKER_LIVE=false`, `SNMP_POLLER_ENABLED=false`
2. Redeploy Coolify
3. Revocar peer WG del CHR de prueba
4. `sync-wireguard-peers.sh`
