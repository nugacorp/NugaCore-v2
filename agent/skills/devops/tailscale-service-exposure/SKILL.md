---
name: tailscale-service-exposure
description: "Expose local admin dashboards and internal web services safely over Tailscale using interface-specific binds, systemd, authentication, and verification."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [tailscale, systemd, dashboard, internal-services, hardening, remote-access]
    related_skills: [hermes-agent, systematic-debugging]
---

# Tailscale Service Exposure

Use this skill when the user asks to make a local dashboard, admin UI, API, or internal service reachable from a tailnet without exposing it publicly.

This is a class-level workflow for Linux services such as dashboards, local web UIs, admin consoles, metrics UIs, and development tools. Keep service-specific details in `references/` rather than creating a new skill per product.

## Safety defaults

- Prefer binding the service to the node's Tailscale `100.x` IP, not `0.0.0.0`.
- Keep database/cache/internal ports on `127.0.0.1` unless the user explicitly asks otherwise.
- Require application authentication, reverse-proxy auth, or at minimum basic auth for human-facing admin dashboards.
- Never print credentials, tokens, generated passwords, session cookies, or full config files containing secrets.
- Store local generated credentials outside the repo with restrictive permissions such as `0600`.
- Avoid public DNS/public ingress unless the user explicitly asks for that broader exposure.

## Workflow

1. Load any product-specific skill first if the service is Hermes, NUGACORE, Home Assistant, OpenClaw, etc.
2. Identify the Tailscale IP:
   - `tailscale ip -4`
   - If multiple IPs appear, pick the one assigned to the current host and report the assumption.
3. If the task is remote access recovery, first prove the peer is online before debugging credentials:
   - `tailscale status | grep -E '<ip>|<hostname>'`
   - `tailscale ping --timeout=5s --c 5 <ip>`
   - `ping -c 3 -W 2 <ip>` when ICMP is useful
   - quick TCP probes for expected ports such as `22`, app ports, and admin dashboards.
   - If the node is offline, report `LastSeen`/online state and ask for a physical/network recovery path; retry the same probes after the user changes cabling or power.
4. Inspect existing process/port state before changing anything:
   - service manager status if known,
   - active listeners for the requested port,
   - existing config paths and environment files.
5. Configure the service to listen on the Tailscale IP and intended port only.
5. Add or update a tracked systemd service when persistence is needed:
   - use a system service for machine-level daemons,
   - use a user service for user-owned CLIs/dashboards,
   - enable linger only when a user service must survive logout and the environment requires it.
6. Restart the service and verify readiness from the host using the Tailscale IP URL.
7. Verify security behavior:
   - root path returns the expected redirect/login/status,
   - protected API endpoints return 401/403 without credentials,
   - logs show readiness without leaking secrets,
   - local listener is bound to the Tailscale IP, not wildcard.
8. For SSH-based repair, verify the privilege boundary early with `sudo -n true`. If sudo requires an interactive password, clearly separate what was verified from what remains blocked; do not claim system-level correction when you only have unprivileged access.
9. Final response should include the URL, service name, verification checklist, and credential-file path only if safe. Do not include actual credentials.

## Verification checklist

Use concrete checks before reporting success:

- Listener exists on `<tailscale-ip>:<port>`.
- No wildcard listener for that admin port unless explicitly approved.
- Service manager reports active/running or the tracked process is alive.
- HTTP(S) probe through the Tailscale IP reaches the app.
- Login/auth gate works, or a protected endpoint denies unauthenticated access.
- Recent logs include ready/startup markers and no obvious secret leakage.

## Common pitfalls

- A service can be healthy on `127.0.0.1` but unreachable over Tailscale if it is not bound to the tailnet IP.
- Binding to `0.0.0.0` may accidentally expose the dashboard on LAN/public interfaces; avoid this unless specifically requested.
- A root URL returning `302` to `/login` is often a success condition for authenticated dashboards, not a failure.
- An API endpoint returning `401` without credentials can be the desired proof that auth is active.
- An offline Tailscale peer can still appear in `tailscale status` with an IP and stale metadata; check `Online`, `LastSeen`, `tailscale ping`, and Rx/Tx before debugging SSH keys or app services.
- SSH `Permission denied (publickey,password)` after a node comes online can be caused by the agent using the wrong identity file; try known local keys explicitly with `-i <key> -o IdentitiesOnly=yes` before asking the user to reset accounts.
- A user in the `sudo` group may still require an interactive password. Confirm with `sudo -n true`; without NOPASSWD or a supplied password, systemd/log/service fixes may be blocked even though SSH works.
- Web UI build steps may not be necessary if a current `dist` already exists; prefer documented `--skip-build`/serve-existing options when available.
- Do not preserve operational UUIDs, internal hostnames, deployment IDs, tokens, or passwords in repo docs. If documentation is needed, write a sanitized version and keep detailed ops notes outside Git.

## References

- `references/hermes-dashboard-over-tailscale.md` — Hermes dashboard example: bind to Tailscale IP, user systemd service, basic auth, and verification probes.
