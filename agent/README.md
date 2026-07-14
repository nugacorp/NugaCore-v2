# NugaCore Agent Context

This folder is the **single entry point** for any AI agent (Cursor, Claude Code, Copilot, Codex, etc.) working on NugaCore.

## Quick start

1. Read the repo root [`AGENTS.md`](../AGENTS.md) for guardrails and verification expectations.
2. Open [`skills/README.md`](skills/README.md) and pick the skill bundle for your task.
3. Read each relevant `SKILL.md` before planning or editing code.
4. Run real verification (`npm run lint`, `npm test`, `npm run build`) before claiming completion.

## Directory layout

```
agent/
├── README.md                 # This file — start here
├── skills-lock.json          # Upstream skill versions (from `npx skills`)
├── scripts/
│   ├── sync-skills.sh        # Refresh upstream skills into agent/skills/
│   └── link-agent-skills.sh  # Symlink .agents/skills/ for Cursor auto-discovery
└── skills/
    ├── README.md             # Human index + task bundles
    ├── MANIFEST.json         # Machine-readable skill catalog
    ├── data-platform/        # Supabase, Postgres
    ├── devops/               # MikroTik, Tailscale, webhooks, multi-agent
    ├── github/               # PR workflow
    ├── productivity/         # Docs, workspace databases
    └── software-development/ # NugaCore product, React, TDD, debugging
```

## Cursor / Agent Skills CLI

Skills are vendored under `agent/skills/`. For Cursor and other tools that auto-load from `.agents/skills/`, run:

```bash
./agent/scripts/link-agent-skills.sh
```

To refresh upstream content (Vercel React rules, Supabase Postgres references, etc.):

```bash
./agent/scripts/sync-skills.sh
```

## Minimum skills by task type

| Task | Read first |
|------|------------|
| Any NugaCore work | `software-development/wisp-noc-saas-development` |
| Supabase / Postgres / RLS | `data-platform/supabase`, `software-development/supabase-postgres-best-practices` |
| React / Tailwind UI | `software-development/vercel-react-best-practices`, `tailwind-4-docs`, `web-design-guidelines` |
| New feature / bugfix | `software-development/test-driven-development`, `systematic-debugging` |
| PR / handoff docs | `github/github-pr-workflow`, `productivity/document-workflows` |
| MikroTik / RouterOS | `devops/mikrotik-routeros-rsc`, `wisp-noc-saas-development` |

## Security

Never commit secrets, tokens, JWTs, passwords, private deployment IDs, or detailed private ops logs into skills or docs. Keep GitHub-facing content sanitized.
