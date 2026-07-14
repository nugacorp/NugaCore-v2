# Agent Skills for NugaCore

Canonical vendored skills for NugaCore. Any AI agent should load these from the repo instead of machine-local profiles or stale chat context.

**Entry point:** [`../README.md`](../README.md)  
**Machine catalog:** [`MANIFEST.json`](MANIFEST.json)  
**Repo guardrails:** [`../../AGENTS.md`](../../AGENTS.md)

## How agents should use this directory

1. Before working on the repo, scan the skill names and descriptions below (or open `MANIFEST.json` for structured discovery).
2. Load or read the relevant `SKILL.md` files from `agent/skills/<category>/<skill>/SKILL.md` before planning or editing.
3. Prefer these repo-vendored skills over stale chat context or `~/.hermes/skills`.
4. Do not commit secrets, project tokens, deployment IDs, passwords, JWTs, or private ops logs into skills.
5. If a workflow changes materially, update the corresponding repo skill and this index. After upstream skill updates, run `../scripts/sync-skills.sh` and refresh this index if needed.
6. Treat vendored skills as workflow/context only: verify current behavior with repo code, tests, logs, staging, and official vendor docs.

## Recommended skill bundles by task

### General NugaCore product work
- `software-development/wisp-noc-saas-development`
- `software-development/development-workflows`
- `software-development/systematic-debugging`
- `software-development/writing-plans`
- `software-development/plan`

### Supabase / Postgres / auth / migrations
- `data-platform/supabase`
- `software-development/supabase-postgres-best-practices` (includes 34 `references/` rule files)
- `productivity/workspace-databases`
- `security/security-best-practices` when reviewing auth/RBAC/RLS/security-sensitive code

### Frontend UI / React / Tailwind
- `software-development/vercel-react-best-practices` (includes 72 `rules/` files)
- `software-development/vercel-composition-patterns`
- `software-development/web-design-guidelines`
- `software-development/tailwind-4-docs`
- `software-development/development-workflows`
- `testing/playwright` for E2E/browser validation
- `security/security-best-practices` for frontend/auth security review

### Testing / debugging / implementation
- `software-development/test-driven-development`
- `software-development/systematic-debugging`
- `software-development/development-workflows`
- `software-development/subagent-driven-development`
- `testing/playwright`
- `security/security-best-practices` when the review includes security hardening

### GitHub / PR / handoff documentation
- `github/github-pr-workflow`
- `productivity/document-workflows`
- `software-development/writing-plans`
- `security/oss-forensics` only for suspicious commits, force-pushes, supply-chain investigation, or evidence-backed repo forensics

### Docker / local stack / deployment support
- `devops/docker-management`
- `software-development/wisp-noc-saas-development`
- `devops/tailscale-service-exposure` when exposing admin surfaces over tailnet

### Observability / Prometheus / Grafana
- `observability/prometheus`
- `observability/promql`
- `software-development/wisp-noc-saas-development`
- `devops/docker-management` when validating the Compose monitoring stack

### WISP/NOC operations, MikroTik, RouterOS, Tailscale, webhooks
- `software-development/wisp-noc-saas-development`
- `devops/mikrotik-routeros-rsc`
- `devops/tailscale-service-exposure`
- `devops/webhook-subscriptions`
- `devops/kanban-multi-agent-workflows`
- `devops/watchers` only for approved GitHub/API/RSS polling workflows

## Vendored skills (27)

- `data-platform/supabase`
- `devops/docker-management`
- `devops/kanban-multi-agent-workflows`
- `devops/mikrotik-routeros-rsc`
- `devops/tailscale-service-exposure`
- `devops/watchers`
- `devops/webhook-subscriptions`
- `github/github-pr-workflow`
- `observability/prometheus`
- `observability/promql`
- `productivity/document-workflows`
- `productivity/workspace-databases`
- `security/oss-forensics`
- `security/security-best-practices`
- `software-development/development-workflows`
- `software-development/plan`
- `software-development/subagent-driven-development`
- `software-development/supabase-postgres-best-practices`
- `software-development/systematic-debugging`
- `software-development/tailwind-4-docs`
- `software-development/test-driven-development`
- `software-development/vercel-composition-patterns`
- `software-development/vercel-react-best-practices`
- `software-development/web-design-guidelines`
- `software-development/wisp-noc-saas-development`
- `software-development/writing-plans`
- `testing/playwright`

## Cursor / CLI discovery

Cursor and the Agent Skills CLI load from `.agents/skills/`. Those entries are symlinks to this directory. After cloning:

```bash
./agent/scripts/link-agent-skills.sh
```

To refresh upstream Vercel/Supabase content:

```bash
./agent/scripts/sync-skills.sh
```

## Notes

- The `tailwind-4-docs` skill includes lightweight local references. Its full Tailwind documentation snapshot is intentionally not vendored unless explicitly initialized later, because the upstream documentation repository has its own license constraints.
- The `vercel-react-best-practices` skill is a sanitized local copy of the public Vercel React best-practices skill; includes `rules/` from `vercel-labs/agent-skills`.
- The `supabase-postgres-best-practices` skill includes `references/` from `supabase/agent-skills`.
- `devops/watchers` can poll GitHub/API/RSS, but do not create recurring jobs or outbound notifications unless the user explicitly approves the destination and schedule.
- `security/oss-forensics` is for investigations only. Do not run untrusted repo code locally while using it.
- These skills are context and workflow docs. They are not a substitute for running the repo's actual commands (`npm run lint`, `npm test`, `npm run build`, staging checks, Supabase advisors, etc.).
