# Agent Skills for NugaCore

Canonical vendored skills for NugaCore. Any AI agent should load these from the repo instead of machine-local profiles or stale chat context.

**Entry point:** [`../README.md`](../README.md)  
**Machine catalog:** [`MANIFEST.json`](MANIFEST.json)  
**Repo guardrails:** [`../../AGENTS.md`](../../AGENTS.md)

## How agents should use this directory

1. Scan the skill list below or open `MANIFEST.json` for structured discovery.
2. Read relevant `SKILL.md` files before planning or editing.
3. Prefer these repo skills over chat history or `~/.hermes/skills`.
4. Never commit secrets, tokens, deployment IDs, passwords, JWTs, or private ops logs.
5. After upstream skill updates, run `../scripts/sync-skills.sh` and refresh this index if needed.

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

### Frontend UI / React / Tailwind
- `software-development/vercel-react-best-practices` (includes 72 `rules/` files)
- `software-development/vercel-composition-patterns`
- `software-development/web-design-guidelines`
- `software-development/tailwind-4-docs`
- `software-development/development-workflows`

### Testing / debugging / implementation
- `software-development/test-driven-development`
- `software-development/systematic-debugging`
- `software-development/development-workflows`
- `software-development/subagent-driven-development`

### GitHub / PR / handoff documentation
- `github/github-pr-workflow`
- `productivity/document-workflows`
- `software-development/writing-plans`

### WISP/NOC operations, MikroTik, RouterOS, Tailscale, webhooks
- `software-development/wisp-noc-saas-development`
- `devops/mikrotik-routeros-rsc`
- `devops/tailscale-service-exposure`
- `devops/webhook-subscriptions`
- `devops/kanban-multi-agent-workflows`

## Vendored skills (20)

| Category | Skill | Notes |
|----------|-------|-------|
| data-platform | `supabase` | CLI scripts + upstream references |
| devops | `kanban-multi-agent-workflows` | Multi-agent coordination |
| devops | `mikrotik-routeros-rsc` | RouterOS `.rsc` workflows |
| devops | `tailscale-service-exposure` | Tailscale exposure patterns |
| devops | `webhook-subscriptions` | Webhook subscription ops |
| github | `github-pr-workflow` | PR lifecycle + templates |
| productivity | `document-workflows` | PDF/OCR handoff docs |
| productivity | `workspace-databases` | Notion/Airtable references |
| software-development | `development-workflows` | TDD, spikes, API hardening refs |
| software-development | `plan` | Planning workflow |
| software-development | `subagent-driven-development` | Multi-agent implementation |
| software-development | `supabase-postgres-best-practices` | Full Postgres rule references |
| software-development | `systematic-debugging` | Debug methodology |
| software-development | `tailwind-4-docs` | Tailwind v4 local refs |
| software-development | `test-driven-development` | Red-green-refactor for Vitest |
| software-development | `vercel-composition-patterns` | React composition rules |
| software-development | `vercel-react-best-practices` | Full React performance rules |
| software-development | `web-design-guidelines` | UI/a11y review checklist |
| software-development | `wisp-noc-saas-development` | **NugaCore project guide** |
| software-development | `writing-plans` | Implementation plan format |

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

- `tailwind-4-docs`: lightweight local references only; full Tailwind doc snapshot is not vendored (upstream license).
- `vercel-react-best-practices`: sanitized repo copy; includes `rules/` from `vercel-labs/agent-skills`.
- `supabase-postgres-best-practices`: includes `references/` from `supabase/agent-skills`.
- Skills are workflow context — always run real repo verification (`npm run lint`, `npm test`, `npm run build`, staging checks).
