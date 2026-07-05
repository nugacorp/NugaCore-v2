# Tailwind Engineering Playbook

Use this reference for implementation, refactor, and review tasks where you need practical engineering judgment in addition to the official Tailwind docs. Its purpose is to help you make good architectural decisions quickly when you are writing, reviewing or refactoring Tailwind code.

## Default workflow

1. Inspect the repo first.
2. Find the Tailwind entrypoint CSS and any split files.
3. Identify existing theme tokens, breakpoints, component classes, custom utilities, and formatting conventions.
4. Prefer using the project's existing design language over inventing a new one.
5. Keep the implementation as close to markup as possible.
6. Only add new abstraction when repetition or lack of a design primitive actually justifies it.

## Core mindset

- The default move is to compose UI in markup with utilities.
- Custom CSS is still valuable for tokens, utilities, component classes, rich text, and third-party markup.

## The abstraction ladder

Use this order by default:

1. Compose with existing utilities in markup.
2. If markup repeats, extract the markup into the project's native reusable abstraction, such as a component, partial, include, or template.
3. If repeated values are missing from the system, add tokens with `@theme`.
4. If a repeated low-level behavior is missing, add a custom utility with `@utility`.
5. If a stable named visual primitive is justified, add a small component class in `@layer components`.
6. Use `@apply` only as a narrow adapter, not as the main architecture.

## Review checklist

Before finalizing a Tailwind change, check:

- Are utilities sufficient here, or did I abstract too early?
- If repetition exists, would extracting markup be better than adding CSS?
- Should repeated values become tokens?
- Are custom utilities truly low-level?
- Are component classes small, stable, and override-friendly?
- Are state and motion rules consistent across similar UI?
- Will Tailwind detect every class I used?
- Are dynamic classes mapped to full strings?
- Is uncontrolled markup scoped instead of styled globally?
- Is the responsive behavior mobile-first and intentional?
- Can any CSS be deleted now?

## Practical defaults

When in doubt:

- keep styling in markup first
- reuse markup before reusing CSS
- use tokens before arbitrary repetition
- use custom utilities before semantic CSS wrappers
- keep component classes few and durable
- keep state behavior inside the shared abstraction if the abstraction exists
- verify that rendered DOM matches your selectors
- prefer deleting complexity over introducing a clever abstraction
