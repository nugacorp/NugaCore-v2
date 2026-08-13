# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

<!--
  Evaluate this plan against .specify/memory/constitution.md. Keep this short
  and actionable. Do not copy the Constitution in full.

  Status values:
  - PASS: plan complies or area is not affected
  - NEEDS DESIGN: plan must add concrete design before implementation
  - HUMAN DECISION REQUIRED: plan intentionally violates or may violate a principle
  - EXTERNAL_BLOCKED: real validation depends on unavailable external evidence
-->

| Check | Status | Evidence / Required Action |
|-------|--------|----------------------------|
| Existing architecture and brownfield boundaries | [PASS/NEEDS DESIGN] | [How the plan preserves the React SPA + Express API, hermetic local mode, and existing domain boundaries] |
| Production safety | [PASS/NEEDS DESIGN/HUMAN DECISION REQUIRED] | [No production operation, destructive data change, or live external write without explicit approval] |
| Auth, RBAC, RLS, and tenant isolation | [PASS/NEEDS DESIGN] | [Tenant context, deny-by-default behavior, service-role filtering, and tests] |
| Persistence and migrations | [PASS/NEEDS DESIGN/HUMAN DECISION REQUIRED/N/A] | [Migration need, preflight, rollback, drift impact, and DB verification] |
| Billing, payments, and idempotency | [PASS/NEEDS DESIGN/N/A] | [Invoice/balance/payment state, webhook retries, duplicate protection, audit] |
| MikroTik, RouterOS, workers, and external providers | [PASS/NEEDS DESIGN/HUMAN DECISION REQUIRED/N/A] | [Read-only vs write, worker path, dry-run, commit gate, retry/error handling] |
| Feature flags and runtime configuration | [PASS/NEEDS DESIGN/N/A] | [Flags route behavior without weakening accountability] |
| Secrets and sensitive data | [PASS/NEEDS DESIGN/N/A] | [No secrets in repo/logs/evidence; redaction/fingerprint approach] |
| Observability, audit, and restore evidence | [PASS/NEEDS DESIGN/EXTERNAL_BLOCKED/N/A] | [Logs/reports/evidence required; restore or external validation status] |
| Backwards compatibility | [PASS/NEEDS DESIGN] | [Existing user workflow, API/data contract, migration replay, or operator workflow compatibility] |
| Test strategy and CI gates | [PASS/NEEDS DESIGN] | [Unit, contract, DB, auth, billing, browser, readiness, audit, or build gates required by scope] |
| Deployment and rollback | [PASS/NEEDS DESIGN/EXTERNAL_BLOCKED/N/A] | [How release is staged, rolled back, or externally validated] |

**Constitution Violations**:

- [If none, state "None."]
- [If any principle is violated or may be violated: name it, justify why, classify as HUMAN DECISION REQUIRED, and describe the safer alternative rejected.]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/           # Phase 1 output ($speckit-plan command)
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
