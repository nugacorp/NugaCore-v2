---
name: kanban-multi-agent-workflows
description: "Use when routing work through Hermes Kanban: worker lifecycle, orchestrator decomposition, and optional external implementation lanes."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [kanban, multi-agent, worker, orchestrator, routing, codex]
    related_skills: [hermes-agent, autonomous-coding-clis]
---

# Kanban Multi-Agent Workflows

## Overview

This umbrella skill covers the class of "Hermes uses the Kanban board as the durable coordination boundary." It combines three previously separate concerns that belong together for discoverability: the worker lifecycle, the orchestrator's decomposition rules, and the special case where a worker opens an isolated external coding lane.

## When to Use

- The task is being dispatched through Hermes Kanban
- You are acting as a Kanban worker and need lifecycle guidance
- You are acting as a Kanban orchestrator and need decomposition/assignment guidance
- A worker wants to spin up Codex or another coding CLI as one implementation lane while Hermes keeps task ownership

## Core Principle

**The board owns coordination. Hermes owns judgment. External agents never own the task lifecycle.**

## Worker Lifecycle

1. Orient on the card and linked context
2. Confirm workspace/tenant boundaries
3. Execute the scoped work only
4. Send useful heartbeats when progress or blockage changes
5. Complete with a concise, actionable handoff or block with a precise blocker

### Worker quality rules
- Do not claim cards you cannot advance
- Do not produce vague block reasons
- Do not treat heartbeat spam as progress
- Keep summaries concrete enough for the next worker/user to act immediately

## Orchestrator Playbook

1. Decompose work into independently completable cards
2. Route rather than doing the implementation yourself when the board is the intended control plane
3. Prefer small dependency-aware tasks over one giant omnibus card
4. Use links/comments to preserve state transitions visibly on the board
5. Recover stuck workers by clarifying scope, splitting blockers, or reassigning — not by silently bypassing the board

### Anti-temptation rule
If you are the orchestrator, your default job is **decomposition and routing**, not sneaking in as the implementer unless the task truly should not be on the board.

## External Implementation Lanes

Sometimes a worker should open a Codex/Claude/OpenCode lane for a bounded coding subtask. In that case:

1. Hermes remains task owner
2. Use an isolated worktree/branch when parallel edits are plausible
3. Give the external agent a narrow implementation brief
4. Reconcile the diff yourself
5. Run verification before `kanban_complete`

## Decision Rule: When to Use an External Coding Lane

Use one when:
- the work is a contained coding task
- the external CLI is available and authenticated
- the worker can still verify and reconcile results

Do not use one when:
- the task is mostly coordination or investigation
- the workspace is too ambiguous
- verification cannot be done by the worker

## Common Pitfalls

1. Orchestrators doing the work instead of decomposing.
2. Workers sending status chatter without actionable signal.
3. Losing tenant/workspace isolation when multiple repos or customers are involved.
4. Letting an external coding CLI become the de facto owner of the card.
5. Completing a card without a usable summary, diff description, or blocker reason.

## Verification Checklist

- [ ] Card scope and linked context reviewed
- [ ] Correct workspace/tenant selected
- [ ] Worker vs orchestrator role kept distinct
- [ ] Any external lane kept isolated and verified
- [ ] Final complete/block handoff is concrete and actionable
