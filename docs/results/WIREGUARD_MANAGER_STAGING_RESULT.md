# WireGuard Manager — Staging Validation Result

Date: 2026-06-05T18:08:12+02:00
Status: APPROVED
Validated commit: 05d2ae5
Feature: feat(wireguard): add central WireGuard manager (servers/peers/IPAM/keys)
Environment: NugaCore staging

## Scope

This validation covered the WireGuard Manager in staging only.

Guardrails observed:

- No real routers were touched.
- No MikroTik scripts were pasted or executed on any router.
- Live MikroTik read-only mode remained disabled.
- No commit mode or real provisioning execution was enabled.
- No source code was modified.
- No private keys, preshared keys, JWTs, service role keys, credential keys, or scripts are included in this document.

## Deployment and Health

The staging repository was updated to commit 05d2ae5 and deployed in Coolify.

Health checks after deploy:

| Endpoint | Result |
| --- | --- |
| GET /api/health | HTTP 200 |
| GET /api/health/live | HTTP 200 |
| GET /api/health/ready | HTTP 200 |

MIKROTIK_WORKER_LIVE was confirmed false during this validation.

## Tests

Local verification in /opt/nugacore-staging:

| Command | Result |
| --- | --- |
| npm run typecheck | PASS |
| npm test | PASS: 322 passed, 34 skipped |
| npm run build | PASS |

## RBAC

Validated against staging API with real staging auth sessions.

| Role | GET /api/wireguard/servers | GET /api/wireguard/peers | Mutations |
| --- | ---: | ---: | --- |
| Técnico | 403 | 403 | Not allowed |
| Cobranza | 403 | 403 | Not allowed |
| Solo lectura | 403 | 403 | Not allowed |
| Admin | 200 | 200 | POST server 201, POST peer 201, rotate 201, delete peer 200 |
| SuperAdmin | 200 | 200 | POST server 201, POST peer 201, rotate 201, delete peer 200 |

Result: PASS

## WireGuard Server

A temporary staging server was created:

```text
name: WG Staging Test
endpointHost: staging-vpn.nugacore.test
endpointPort: 51820
vpnCidr: 10.70.0.0/16
```

Validation:

- Server creation returned HTTP 201.
- server.id was present.
- server.publicKey was present.
- serverPrivateKey was returned only in the creation response.
- endpointHost matched staging-vpn.nugacore.test.
- vpnCidr matched 10.70.0.0/16.
- Server list did not expose serverPrivateKey or other secret fields.

Result: PASS

## WireGuard Peer

A temporary staging peer was created:

```text
name: CHR Lab Peer Test
routerId: router-test-wireguard
```

Validation:

- Peer creation returned HTTP 201.
- assignedIp was 10.70.0.2/32.
- assignedIp was inside 10.70.0.0/16.
- .1 was not assigned because it is reserved for the server side.
- privateKey was returned only in the creation response.
- presharedKey was returned only in the creation response.
- publicKey was present.
- hasSecrets=true appeared in sanitized peer listings.
- GET /api/wireguard/peers did not return privateKey or presharedKey.

Result: PASS

## IPAM

Validated by creating multiple peers, deleting one, and creating another.

Observed allocation:

| Peer | IP |
| --- | --- |
| Peer 1 | 10.70.0.2 |
| Peer 2 | 10.70.0.3 |
| Peer 3 after deleting Peer 1 | 10.70.0.2 |

Validation:

- Peer 2 received a different IP from Peer 1.
- No IP duplication occurred while peers were active.
- 10.70.0.1 was not assigned.
- Released IP was reused according to the current design.
- IPAM remained consistent after delete/recreate.

Result: PASS

## Rotation

A peer rotation was executed.

Validation:

- POST /api/wireguard/peers/:id/rotate returned HTTP 201.
- New one-time privateKey was returned in the rotation response only.
- New one-time presharedKey was returned in the rotation response only.
- publicKey changed.
- GET /api/wireguard/peers/:id/rotations returned at least one rotation event.
- Sanitized peer listings still did not expose privateKey or presharedKey.

Result: PASS

## MikroTik Provisioning Integration

A temporary test router was created only in NugaCore staging memory. No real router was contacted.

Provisioning request:

```text
POST /api/mikrotik/routers/:id/provisioning-script
connectionType: wireguard_managed
wireguardServerId: <staging test server id>
```

Validation:

- Response returned HTTP 201.
- response.wireguard.managed=true.
- response.wireguard.assignedIp was present.
- script contained NugaCoreWG.
- script contained the assigned WireGuard peer IP.
- script contained endpoint host staging-vpn.nugacore.test and port 51820.
- script contained the server public key.
- script contained the peer private key inside the script, as one-time script material.
- scriptHash was present.
- Response did not expose privateKey, presharedKey, or serverPrivateKey as loose top-level fields outside the script.
- The script was not pasted into any router.

Result: PASS

## UI

Validated deployment bundle and UI module presence in staging.

Observed UI markers in the deployed frontend bundle:

- WireGuard Manager
- Crear servidor WireGuard
- Crear peer WireGuard
- Rotar
- Revocar
- Servidor creado — clave privada
- Peer creado — claves
- Server private key
- Peer private key
- Preshared key
- /api/wireguard/servers integration
- /api/wireguard/peers integration

CSS and JS assets loaded successfully from staging.

RBAC and mutation behavior for the same UI flows were validated through the staging API. The UI code shows secrets only in the create/rotate modal and list data comes from sanitized API responses.

Result: PASS

## Secret Hygiene

Recent staging container logs were scanned after validation.

Not found:

- privateKey fields
- presharedKey fields
- serverPrivateKey fields
- private-key or preshared-key script assignments
- MIKROTIK_CREDENTIALS_KEY values
- JWTs
- service_role values
- complete RouterOS scripts

Result: PASS

## Cleanup

Cleanup performed:

- Test peers were revoked/deleted.
- Test router was deleted.
- Staging was redeployed/restarted so in-memory WireGuard server test records were cleared because this release has no DELETE /api/wireguard/servers endpoint.

Post-cleanup confirmation:

```text
WG staging test servers remaining: 0
WG staging test peers remaining: 0
WG staging test routers remaining: 0
```

Health checks remained HTTP 200 after cleanup.

Result: PASS

## Notes and Recommendations

- Current release intentionally exposes serverPrivateKey, peer privateKey, and presharedKey only once in create/rotate responses.
- Current release has peer revoke/delete but no DELETE endpoint for WireGuard servers. In staging with memory persistence, redeploy/restart clears temporary test servers. If database persistence is enabled later, add or validate a safe server cleanup/deactivation path before production workflows.
- Do not advance to live router execution or commit mode based on this validation.

## Final Result

Phase 4.6.1 WireGuard Manager staging validation is approved.

This approval is limited to the manager/API/UI/provisioning-script generation behavior in staging. It is not approval to run scripts on real MikroTik routers or enable commit mode.
