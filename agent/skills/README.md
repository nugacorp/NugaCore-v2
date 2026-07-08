# Agent Skills for NugaCore

This directory vendors the reusable agent skills that are relevant for NugaCore development. They were copied from the active Hermes profile so future agents can work from the repository itself instead of relying on chat history or a specific machine-local `~/.hermes/skills` directory.

## How agents should use this directory

1. Before working on the repo, scan the skill names and descriptions below.
2. Load or read the relevant `SKILL.md` files from `agent/skills/<category>/<skill>/SKILL.md`.
3. Prefer these repo-vendored skills over stale chat context.
4. Do not commit secrets, project tokens, deployment IDs, passwords, JWTs, or private ops logs into skills.
5. If a workflow changes materially, update the corresponding repo skill and this index.
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
- `software-development/supabase-postgres-best-practices`
- `productivity/workspace-databases`
- `security/security-best-practices` when reviewing auth/RBAC/RLS/security-sensitive code

### Frontend UI / React / Tailwind
- `software-development/vercel-react-best-practices`
- `software-development/tailwind-4-docs`
- `software-development/development-workflows`
- `testing/playwright` for E2E/browser validation
- `security/security-best-practices` for frontend/auth security review

### Testing / debugging / implementation review
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

## Vendored skills

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
- `software-development/vercel-react-best-practices`
- `software-development/wisp-noc-saas-development`
- `software-development/writing-plans`
- `testing/playwright`

## Notes

- The `tailwind-4-docs` skill includes lightweight local references. Its full Tailwind documentation snapshot is intentionally not vendored unless explicitly initialized later, because the upstream documentation repository has its own license constraints.
- The `vercel-react-best-practices` skill is a sanitized local copy of the public Vercel React best-practices skill because the direct Hermes install path flagged the upstream `AGENTS.md` reference.
- `dashboarding`, `supabase-server`, and `vercel-composition-patterns` were reviewed but not vendored because Hermes blocked installation from the community source with a dangerous scanner verdict. Re-evaluate from official upstream docs before adding them later.
- `devops/watchers` can poll GitHub/API/RSS, but do not create recurring jobs or outbound notifications unless the user explicitly approves the destination and schedule.
- `security/oss-forensics` is for investigations only. Do not run untrusted repo code locally while using it.
- These skills are context and workflow docs. They are not a substitute for running the repo's actual commands (`npm run lint`, `npm test`, `npm run build`, staging checks, Supabase advisors, etc.).
