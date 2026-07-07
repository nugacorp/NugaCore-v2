---
name: test-driven-development
description: "Use when implementing features, fixing bugs, or refactoring. Enforces strict red-green-refactor: write a failing test first, watch it fail, write minimal code to pass, then refactor."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [testing, tdd, vitest, quality]
    related_skills: [systematic-debugging, development-workflows, writing-plans]
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

## When to Use

**Always:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

**Exceptions (ask the user first):**
- Throwaway prototypes
- Generated code
- Configuration files

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

## Red-Green-Refactor Cycle

### RED — Write Failing Test

Write one minimal test showing what should happen. One behavior per test. Clear descriptive name. Prefer real code over mocks.

### Verify RED — Watch It Fail

**MANDATORY.** Run the specific test and confirm it fails for the expected reason (missing feature, not a typo).

### GREEN — Minimal Code

Write the simplest code to pass the test. Hardcoding and duplication are acceptable in this step.

### Verify GREEN — Watch It Pass

Run the specific test, then the full suite. Fix regressions immediately.

### REFACTOR — Clean Up

After green only: remove duplication, improve names, simplify. Keep tests green throughout.

## NugaCore Verification Commands

```bash
# Targeted Vitest (preferred for TDD loops)
npx vitest run tests/unit/<file>.test.ts

# Full suite
npm test

# Static checks after green
npm run lint
```

For API/RBAC changes, add failing security-matrix tests before wiring middleware. See `../development-workflows/references/api-auth-hardening.md`.

## Integration With Other Skills

- **systematic-debugging:** Reproduce bugs with a failing test before fixing.
- **development-workflows:** Use TDD inside feature spikes when behavior is known.
- **writing-plans:** Plans should name the first failing test for each task.

## Full Reference

For the complete TDD guide (rationalizations, red flags, Django notes, anti-patterns), read:

`../development-workflows/references/test-driven-development.md`
