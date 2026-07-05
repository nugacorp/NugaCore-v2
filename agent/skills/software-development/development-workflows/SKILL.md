---
name: development-workflows
description: "Use when choosing or executing a software-development workflow such as spikes, TDD, cleanup passes, or debug-led implementation."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [software-development, workflows, tdd, spike, cleanup, debugging, implementation]
    related_skills: [systematic-debugging, plan, writing-plans, subagent-driven-development]
---

# Development Workflows

## Overview

This is the class-level umbrella for **how to approach software work**, not just what code to write. Use it when the user is implicitly choosing a mode of work: validate an idea, drive implementation by tests, clean up an existing diff, or decide which workflow is appropriate before touching code.

Detailed absorbed playbooks live in:
- `references/spike.md`
- `references/simplify-code.md`
- `references/test-driven-development.md`
- `references/api-auth-hardening.md`

## When to Use

Load this skill when the user asks to:
- spike or prototype an idea before committing to a build
- implement with strict TDD or write tests first
- simplify / clean up / review a recent diff
- choose the right implementation workflow for a bugfix or feature
- combine debugging, testing, and cleanup into one intentional delivery plan

Do **not** use this as the primary debugging playbook when the main task is root-cause investigation. In that case load `systematic-debugging` alongside or instead.

## Workflow Selection

| Situation | Mode | Detailed reference |
|---|---|---|
| Unknown feasibility, compare approaches, answer “is this viable?” | **Spike** | `references/spike.md` |
| Feature/bugfix should be driven by failing tests first | **TDD** | `references/test-driven-development.md` |
| User asks to simplify, clean up, or review recent changes | **Simplify pass** | `references/simplify-code.md` |
| Root cause unknown, symptoms unclear, failed fixes already piling up | **Debug first** | `systematic-debugging` |

## Mode A — Spike Before Build

Use a spike when research alone cannot answer the question and the code should be disposable.

High-level rules:
1. Break the idea into 1-5 explicit feasibility questions.
2. Build the smallest runnable artifact that produces observable evidence.
3. Prefer standalone directories and throwaway code.
4. End with a verdict: `VALIDATED`, `PARTIAL`, or `INVALIDATED`.
5. If multiple approaches are credible, compare them head-to-head rather than debating abstractly.

## Mode B — Test-Driven Development

Use TDD when the user wants implementation confidence, regression protection, or behavior-first development.

High-level rules:
1. Write the smallest failing test first.
2. Run it and watch it fail for the right reason.
3. Write the minimum production code to pass.
4. Re-run the narrow test, then the broader relevant suite.
5. Refactor only after green.

If the work involves API auth hardening, also consult `references/api-auth-hardening.md`.

## Mode C — Simplify / Cleanup Pass

Use this after a working diff exists and the user wants a deliberate cleanup rather than fresh implementation.

High-level rules:
1. Identify the exact diff scope first.
2. Review for reuse, code quality, and efficiency.
3. Prefer parallel review or parallel thinking when tool budget allows.
4. Apply only high-confidence fixes that materially improve the code.
5. Re-run the relevant tests/lint checks after each applied cleanup.

## Composition Rules

These modes often chain naturally:
- **Debug → TDD → Simplify** for a bugfix with cleanup afterward.
- **Spike → Plan / implement** when feasibility is proven.
- **TDD → Simplify** when the feature is correct but rough around the edges.

Default order of operations:
1. If root cause is unclear, debug first.
2. If behavior needs to be changed safely, use TDD.
3. If code already works and needs polish, run a simplify pass.
4. If the goal is still ambiguous or risky, spike before committing.

## Common Pitfalls

1. Treating a spike as production code. Throwaway experiments should not quietly become the shipping implementation.
2. Claiming TDD without a real RED step. If the test never failed, it did not drive the code.
3. Running cleanup before correctness is established. Simplification is not a substitute for understanding or tests.
4. Using workflow language too literally. The user may ask to “prototype”, “sanity-check”, “clean up”, or “make this safe” without naming the workflow explicitly.
5. Mixing all modes at once without deciding the lead mode. Pick the dominant workflow first, then compose deliberately.

## Verification Checklist

- [ ] Chosen workflow matches the user’s actual risk/goal
- [ ] Detailed absorbed reference loaded when needed
- [ ] Tests or runnable evidence exist for any claimed result
- [ ] Throwaway vs production intent is explicit
- [ ] Cleanup work was verified after edits
