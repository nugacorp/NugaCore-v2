# MikroTik Worker Live CHR Read-Only Staging Result

Date: 2026-06-05T08:49:25+02:00
Status: APPROVED FOR READ-ONLY / DRY-RUN LAB VALIDATION
Validated repository commit: 3416a55
Feature commit under validation: a587578
Environment: NugaCore staging

## Scope and Guardrails

This validation was limited to a MikroTik CHR laboratory router and read-only RouterOS API access.

Confirmed guardrails:

- No destructive RouterOS command was executed.
- No CHR configuration was changed by this validation.
- No queues were created or deleted.
- No users were created or modified.
- No passwords were changed.
- No router reboot/reset/import/script execution was attempted.
- No production router was touched.
- No real suspension mode or commit mode was enabled.
- NugaCore worker remained dry-run only.
- Live mode was disabled again after validation.

No passwords, JWTs, service-role keys, credential keys, or tokens are included in this document.

## Connectivity

Requested CHR Tailscale IP:

```text
100.105.27.6
```

Direct probe from the VPS to that IP:

- Ping: PASS
- TCP 22: closed
- TCP 8728: closed
- TCP 8729: closed
- TCP 8291: closed

The usable path was through the OpenClaw server over Tailscale:

```text
Hermes VPS -> Tailscale -> openclaw-server 100.107.157.98 -> LAN -> CHR 192.168.1.131
```

From openclaw-server to the CHR:

- Ping: PASS
- TCP 22: open
- TCP 23: open
- TCP 80: open
- TCP 8291: open
- TCP 8728: open
- TCP 8729: open

RouterOS indicators:

- HTTP returned a RouterOS page.
- SSH banner returned RОSSSH.

A temporary SSH tunnel was used only for the validation and was closed afterward:

```text
NugaCore container -> 10.0.1.1:18728 -> SSH tunnel -> openclaw-server localhost:18728 -> CHR 192.168.1.131:8728
```

## Credentials

RouterOS API user used:

```text
hermes_01
```

The password was not printed, documented, or committed. Credentials were provided to NugaCore only through its encrypted router credential mechanism for the temporary staging router entry.

Recommendation: for future production-like validation, use a dedicated read-only RouterOS user, for example with policy read,api,test only.

## Temporary NugaCore Router Registration

A temporary lab router was registered in staging:

```text
name: CHR Lab Tailscale
connection_type: direct
management_ip: 100.105.27.6
api_port: 18728
notes: CHR laboratory router via OpenClaw/Tailscale SSH tunnel; read-only validation only
```

The route used by the worker was a temporary tunnel endpoint, not the public production network. The temporary router entry was deleted during cleanup.

## Live Mode Control

MIKROTIK_WORKER_LIVE was temporarily set to true for the staging validation and the application was redeployed.

Health checks after enabling live mode:

| Endpoint | Result |
| --- | --- |
| GET /api/health | HTTP 200 |
| GET /api/health/live | HTTP 200 |
| GET /api/health/ready | HTTP 200 |

At the end of validation, MIKROTIK_WORKER_LIVE was set back to false and staging was redeployed again.

Post-restore confirmation:

- Container environment showed MIKROTIK_WORKER_LIVE=false.
- Health checks remained HTTP 200.
- Worker snapshot source returned simulated after live mode was disabled.

## NugaCore Read-Only Snapshot

Endpoint executed:

```text
GET /api/mikrotik/routers/:id/worker/read
```

Result:

- HTTP 200
- source=live
- routerId present
- generatedAt present
- reads present

NugaCore worker commands used by commit a587578:

```text
/system/resource/print
/interface/print
/queue/simple/print
/ppp/secret/print
/ppp/active/print
/ip/address/print
```

All commands were print/read-only commands. The snapshot payload was checked for destructive RouterOS verbs and no destructive command was observed as an executed read.

Rows returned by NugaCore snapshot:

| Command | Rows |
| --- | ---: |
| /system/resource/print | 1 |
| /interface/print | 14 |
| /queue/simple/print | 1 |
| /ppp/secret/print | 0 |
| /ppp/active/print | 0 |
| /ip/address/print | 9 |

## Supplementary Read-Only RouterOS Probe

A direct read-only RouterOS API probe was also executed through the same tunnel to validate the broader expected inventory fields. These were print-only reads and did not modify the CHR.

Supplementary commands:

```text
/system/identity/print
/system/resource/print
/interface/print
/ip/address/print
/ip/route/print
/queue/simple/print
/ppp/secret/print
/ip/hotspot/user/print
```

Supplementary data observed:

- identity: NUGACORE-CHR-WISP-LAB
- version: 7.22.3 stable
- uptime: present
- cpu-load: present
- free-memory: present
- total-memory: present
- interfaces: 14 rows
- IP addresses: 9 rows
- routes: 14 rows
- simple queues: 1 row
- PPP secrets: 0 rows
- hotspot users: 1 row

Empty PPP lists are acceptable for this lab state.

Note: commit a587578 does not yet include identity, route, or hotspot-user commands in the NugaCore worker snapshot allowlist. The supplementary probe confirms the CHR can return those print-only datasets through RouterOS API, but adding them to the product snapshot would require a future code change and was intentionally not done in this validation.

## Before/After State Comparison

NugaCore worker snapshot row counts before and after dry-run remained stable:

| Dataset | Before | After |
| --- | ---: | ---: |
| system resource | 1 | 1 |
| interfaces | 14 | 14 |
| simple queues | 1 | 1 |
| PPP secrets | 0 | 0 |
| PPP active | 0 | 0 |
| IP addresses | 9 | 9 |

Confirmed no count changes for:

- interfaces
- PPP users/secrets
- simple queues
- IP addresses

Routes and hotspot users were checked by supplementary print-only probe; no RouterOS write command was issued during comparison.

## Dry-Run Suspension Order

A controlled Scenario A test fixture was created using suspension test-tools.

Validation result:

- SuspensionOrder created with status PENDING.
- invoiceId was present.
- POST /api/mikrotik/worker/run returned HTTP 201.
- dryRun=true.
- workerRunId was present.
- The test order became EXECUTED with dryRun=true.
- client.status did not change.
- CHR read-only snapshot counts remained unchanged after the dry-run.
- No destructive RouterOS command was sent.

## Secret Hygiene

Recent staging logs were scanned after the live CHR validation.

Not found:

- CHR password
- JWTs
- Supabase service-role key
- MIKROTIK_CREDENTIALS_KEY
- destructive RouterOS command execution
- complete RouterOS scripts

Result: PASS

## Cleanup

Cleanup performed:

- Test customer/facture/order fixture deleted via suspension test-tools.
- Temporary CHR lab router entry deleted from NugaCore staging.
- Temporary SSH tunnel closed.
- MIKROTIK_WORKER_LIVE restored to false and staging redeployed.

Post-cleanup:

- Health endpoints returned HTTP 200.
- Worker snapshot source returned simulated.

## Risks and Recommendations

Risks observed:

1. Direct API access to 100.105.27.6 was not open from the VPS. The successful lab path depends on OpenClaw/LAN reachability and a temporary SSH tunnel.
2. The RouterOS API over port 8728 is plaintext. This is acceptable only for the current lab/tunnel validation. Prefer API SSL on 8729 for future production-like testing.
3. The user used for this validation was hermes_01. A dedicated NugaCore read-only RouterOS API user is recommended before expanding this workflow.
4. Current worker allowlist in commit a587578 reads resource, interfaces, queues, PPP, and IP addresses. Identity, routes, and hotspot users were validated by supplementary print-only probe but are not yet part of the NugaCore worker snapshot.

Recommended next step:

- Keep live mode disabled.
- Create a dedicated read-only RouterOS API user for NugaCore lab/production validation.
- In a future code phase, extend the worker read-only allowlist to include identity, routes, and hotspot users if those datasets are required by the product.
- Do not proceed to commit mode or real suspension execution without a separate explicit approval.

## Final Decision

Phase 4.6.1 is approved for live RouterOS API read-only CHR lab validation and dry-run worker behavior only.

It is not approval for commit mode, real suspension, real activation, or production router changes.
