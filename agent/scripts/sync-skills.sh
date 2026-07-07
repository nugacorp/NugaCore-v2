#!/usr/bin/env bash
# Sync upstream Agent Skills into agent/skills/ for NugaCore.
# Safe to re-run; overwrites upstream-managed files only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Installing upstream skills to .agents/skills (temp)..."
npx --yes skills add vercel-labs/agent-skills \
  --skill vercel-react-best-practices \
  --skill vercel-composition-patterns \
  --skill web-design-guidelines \
  -y

npx --yes skills add supabase/agent-skills \
  --skill supabase-postgres-best-practices \
  --skill supabase \
  -y

echo "==> Merging into agent/skills/..."

# Vercel React — rules + metadata
cp -r .agents/skills/vercel-react-best-practices/rules \
  agent/skills/software-development/vercel-react-best-practices/
cp .agents/skills/vercel-react-best-practices/metadata.json \
  agent/skills/software-development/vercel-react-best-practices/ 2>/dev/null || true
cp .agents/skills/vercel-react-best-practices/README.md \
  agent/skills/software-development/vercel-react-best-practices/ 2>/dev/null || true

# Supabase Postgres — references
cp -r .agents/skills/supabase-postgres-best-practices/references \
  agent/skills/software-development/supabase-postgres-best-practices/
cp .agents/skills/supabase-postgres-best-practices/CHANGELOG.md \
  agent/skills/software-development/supabase-postgres-best-practices/ 2>/dev/null || true

# Supabase platform skill — references/assets (keep local SKILL.md + scripts)
mkdir -p agent/skills/data-platform/supabase/references agent/skills/data-platform/supabase/assets
cp -r .agents/skills/supabase/references/. agent/skills/data-platform/supabase/references/
cp -r .agents/skills/supabase/assets/. agent/skills/data-platform/supabase/assets/ 2>/dev/null || true

# Additional frontend skills
mkdir -p agent/skills/software-development/web-design-guidelines \
         agent/skills/software-development/vercel-composition-patterns
cp -r .agents/skills/web-design-guidelines/. agent/skills/software-development/web-design-guidelines/
cp -r .agents/skills/vercel-composition-patterns/. agent/skills/software-development/vercel-composition-patterns/

# Preserve lock file next to agent context
if [[ -f skills-lock.json ]]; then
  mv -f skills-lock.json agent/skills-lock.json
fi

echo "==> Re-linking .agents/skills for Cursor..."
"$ROOT/agent/scripts/link-agent-skills.sh"

echo "Done. Review agent/skills/README.md for the catalog."
