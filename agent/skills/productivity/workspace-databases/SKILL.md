---
name: workspace-databases
description: "Use when working with API-driven workspace databases such as Airtable and Notion, including schema discovery, CRUD, search, and content automation."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [airtable, notion, workspace, database, productivity, api, automation]
    related_skills: [google-workspace]
---

# Workspace Databases

## Overview

This is the umbrella for **workspace-database automation**: read/write/search/query operations against tools like Airtable and Notion, including schema discovery, content updates, and automation-safe CRUD.

Detailed absorbed playbooks live in:
- `references/airtable.md`
- `references/notion.md`
- `references/notion-block-types.md`

## When to Use

Load this skill when the user wants to:
- inspect a workspace database schema before changing records
- create, update, query, or delete entries in Airtable or Notion
- automate page/database content through an API or CLI
- choose between CLI-first and raw HTTP automation paths for workspace knowledge tools

## Shared Rules

1. **Discover schema before mutation.** Never guess field/property names when the platform can tell you the canonical shape.
2. **Read before write.** Resolve the target record/page/database first, then patch it.
3. **Prefer stable IDs in automation.** Names drift; IDs do not.
4. **Use the platform-native rate limits and pagination model.** These systems are APIs, not local files.
5. **Verify auth and sharing scope early.** A valid token without resource access is a common false-start.

## Airtable Path

Use Airtable when the user is clearly working with bases/tables/records.

High-level flow:
1. Confirm token availability and base access.
2. Inspect base/table schema first.
3. Use filtered reads to resolve record IDs.
4. Prefer `PATCH` and explicit batches.
5. Respect per-base throttling.

See `references/airtable.md` for the detailed REST patterns.

## Notion Path

Use Notion when the user is working with pages, data sources, blocks, markdown import/export, or hosted Workers.

High-level flow:
1. Confirm integration token and resource sharing.
2. Choose `ntn` CLI when available and appropriate; otherwise use HTTP.
3. Use markdown endpoints when agent-readable page content is the goal.
4. Distinguish page operations from data-source queries.
5. Preserve the platform’s block/property model instead of flattening everything into plain text.

See `references/notion.md` and `references/notion-block-types.md` for the detailed API surface.

## Decision Table

| Situation | Preferred platform behavior |
|---|---|
| User mentions bases/tables/records/formulas | Airtable workflow |
| User mentions pages/databases/blocks/markdown/workers | Notion workflow |
| User needs rich content structure, page blocks, or markdown round-tripping | Notion |
| User needs spreadsheet-like records, formulas, or base-scoped CRUD | Airtable |

## Common Pitfalls

1. Guessing a schema instead of reading it.
2. Confusing a valid token with resource access; both Airtable and Notion can fail due to scope/sharing, not auth syntax.
3. Using human-readable names in automations where stable IDs should be used.
4. Treating pagination and rate limits as optional.
5. Flattening Notion’s page/block structure when the task needs preserved semantics.

## Verification Checklist

- [ ] Auth and scope verified
- [ ] Schema or resource metadata inspected before writes
- [ ] Stable IDs used where automation durability matters
- [ ] Response checked after mutation
- [ ] Pagination/rate-limit behavior handled where relevant
