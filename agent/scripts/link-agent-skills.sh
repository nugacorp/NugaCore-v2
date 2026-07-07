#!/usr/bin/env bash
# Create .agents/skills symlinks pointing at agent/skills/* for Cursor auto-discovery.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_SKILLS="$ROOT/agent/skills"
LINK_ROOT="$ROOT/.agents/skills"

mkdir -p "$LINK_ROOT"

# Remove prior symlinks or copied trees
find "$LINK_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

while IFS= read -r skill_md; do
  skill_dir="$(dirname "$skill_md")"
  skill_name="$(basename "$skill_dir")"
  rel_target="$(realpath --relative-to="$LINK_ROOT" "$skill_dir")"
  ln -s "$rel_target" "$LINK_ROOT/$skill_name"
  echo "  $skill_name -> $rel_target"
done < <(find "$AGENT_SKILLS" -name SKILL.md | sort)

echo "Linked $(find "$AGENT_SKILLS" -name SKILL.md | wc -l) skills into .agents/skills/"
