# NugaCore Agent Instructions

This repository vendors agent skills under `agent/skills/`. **Start at [`agent/README.md`](agent/README.md)** for the full catalog, sync scripts, and task bundles.

## Skill loading policy

Use [`agent/skills/README.md`](agent/skills/README.md) or [`agent/skills/MANIFEST.json`](agent/skills/MANIFEST.json) as the index. At minimum:

- For any WISP/NOC/SaaS work: read `agent/skills/software-development/wisp-noc-saas-development/SKILL.md`.
- For Supabase, Postgres, auth, RLS, REST, migrations, or database security: read:
  - `agent/skills/data-platform/supabase/SKILL.md`
  - `agent/skills/software-development/supabase-postgres-best-practices/SKILL.md`
- For frontend UI, React, Vite, or Tailwind work: read:
  - `agent/skills/software-development/vercel-react-best-practices/SKILL.md`
  - `agent/skills/software-development/tailwind-4-docs/SKILL.md`
  - `agent/skills/software-development/web-design-guidelines/SKILL.md`
- For new features and bug fixes: read `agent/skills/software-development/test-driven-development/SKILL.md`.
- For debugging: read `agent/skills/software-development/systematic-debugging/SKILL.md`.
- For PRs, branches, commits, or GitHub workflow: read `agent/skills/github/github-pr-workflow/SKILL.md`.
- For handoff docs: read `agent/skills/productivity/document-workflows/SKILL.md` and keep public docs sanitized.

## Cursor auto-discovery

`.agents/skills/` contains symlinks to `agent/skills/`. Regenerate after clone with:

```bash
./agent/scripts/link-agent-skills.sh
```

## Project guardrails

- Do not commit secrets, tokens, JWTs, host passwords, private deployment IDs, or detailed private ops logs.
- Keep GitHub-facing documentation sanitized and current: what exists, what is missing, production-readiness gates, roadmap direction, and handoff checklists.
- For NugaCore staging validations, confirm the requested commit is on `origin/main` first; if it is missing, report `NO APROBADA`.
- Do not change shared staging passwords unless explicitly requested.
- Respect strict no-router/no-live/no-migration boundaries unless explicitly authorized by the user.
- When safe and within guardrails, proactively fix validation blockers instead of only reporting them.

## Verification expectations

When building or changing code, provide real execution evidence. Prefer the narrowest relevant checks first, then broader checks when appropriate:

- `npm run lint`
- `npm test`
- `npm run build`
- Targeted Vitest commands where applicable
- Supabase REST/advisor checks when touching database/auth behavior
- Browser/staging checks when validating UI behavior

Do not claim completion from inspection alone if runnable verification is available.
