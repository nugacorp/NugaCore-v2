# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## Scope & Boundaries *(mandatory)*

<!--
  Keep this section focused on WHAT and WHY. Do not include technical design,
  schemas, APIs, file paths, or implementation strategy here.
-->

**Problem**: [User/business problem this feature solves]

**Primary Actors**: [Users, roles, or systems affected]

**In Scope**:

- [Behavior or outcome included in this feature]

**Out of Scope**:

- [Behavior, integration, migration, or production operation intentionally excluded]

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases, including retries/failures when relevant.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## NugaCore Impact Review *(mandatory)*

<!--
  Mark each row as Applicable, N/A, or EXTERNAL_BLOCKED.
  - N/A requires a short reason.
  - EXTERNAL_BLOCKED means the requirement depends on external validation or
    evidence that is not available during local development. It is not PASS.
  - Do not use EXTERNAL_BLOCKED for deterministic local tests or requirements.
-->

| Area | Status | Requirement Impact |
|------|--------|--------------------|
| Security / Authorization | [Applicable/N/A] | Does this change authentication, authorization/RBAC, RLS, exposed data, or secrets? |
| Data / Financial | [Applicable/N/A] | Does this modify persistence, invoices, balances, payments, subscriptions, or idempotency requirements? |
| Infrastructure / External Systems | [Applicable/N/A] | Does this touch MikroTik/RouterOS, workers, providers, queues, webhooks, or public deployment behavior? |
| External Evidence | [N/A/EXTERNAL_BLOCKED] | Which acceptance criteria require staging, production, CHR, sandbox provider, remote SQL, or restore evidence? |
| Backwards Compatibility | [Applicable/N/A] | What existing behavior, API contract, data contract, or operator workflow must remain compatible? |

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(include if feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

### External Validation Requirements *(include if any NugaCore Impact row is EXTERNAL_BLOCKED)*

- **EV-001**: [External system/evidence required, why it cannot be proven locally, and what result will count as real evidence]

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- [Assumption about target users, e.g., "Users have stable internet connectivity"]
- [Assumption about scope boundaries, e.g., "Mobile support is out of scope for v1"]
- [Assumption about data/environment, e.g., "Existing authentication system will be reused"]
- [Dependency on existing system/service, e.g., "Requires access to the existing user profile API"]
