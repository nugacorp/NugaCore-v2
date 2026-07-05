---
name: github-pr-workflow
description: "Use when working with GitHub repos end-to-end: auth, repo setup, issues, reviews, PR lifecycle, and codebase inspection."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [GitHub, Pull-Requests, CI/CD, Git, Automation, Merge]
    related_skills: [github-auth, github-code-review]
---

# GitHub Pull Request Workflow

Complete guide for managing the PR lifecycle. Each section shows the `gh` way first, then the `git` + `curl` fallback for machines without `gh`.

## Prerequisites

- Authenticated with GitHub (see `github-auth` skill)
- Inside a git repository with a GitHub remote

### Quick Auth Detection

```bash
# Determine which method to use throughout this workflow
if command -v gh &>/dev/null && gh auth status &>/dev/null; then
  AUTH="gh"
else
  AUTH="git"
  # Ensure we have a token for API calls
  if [ -z "$GITHUB_TOKEN" ]; then
    if [ -f ~/.hermes/.env ] && grep -q "^GITHUB_TOKEN=" ~/.hermes/.env; then
      GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" ~/.hermes/.env | head -1 | cut -d= -f2 | tr -d '\n\r')
    elif grep -q "github.com" ~/.git-credentials 2>/dev/null; then
      GITHUB_TOKEN=$(grep "github.com" ~/.git-credentials 2>/dev/null | head -1 | sed 's|https://[^:]*:\([^@]*\)@.*|\1|')
    fi
  fi
fi
echo "Using: $AUTH"
```

### Extracting Owner/Repo from the Git Remote

Many `curl` commands need `owner/repo`. Extract it from the git remote:

```bash
# Works for both HTTPS and SSH remote URLs
REMOTE_URL=$(git remote get-url origin)
OWNER_REPO=$(echo "$REMOTE_URL" | sed -E 's|.*github\.com[:/]||; s|\.git$||')
OWNER=$(echo "$OWNER_REPO" | cut -d/ -f1)
REPO=$(echo "$OWNER_REPO" | cut -d/ -f2)
echo "Owner: $OWNER, Repo: $REPO"
```

---

## 1. Branch Creation

This part is pure `git` — identical either way:

```bash
# Make sure you're up to date
git fetch origin
git checkout main && git pull origin main

# Create and switch to a new branch
git checkout -b feat/add-user-authentication
```

Branch naming conventions:
- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — code restructuring
- `docs/description` — documentation
- `ci/description` — CI/CD changes

## 2. Making Commits

Use the agent's file tools (`write_file`, `patch`) to make changes, then commit.

### Checkpoint cadence for active development

For long-running active development sessions, prefer small verified checkpoint commits and push them regularly instead of accumulating a large unpushed diff. If the user gives a cadence such as "commit and push every 20 minutes," treat it as part of the workflow for that project: before continuing to the next block, run the relevant tests/checks, commit a coherent slice, push, and verify `git status --short --branch` is clean/synced.

```bash
# Verify first
pytest -q
python manage.py check  # Django projects, when applicable

# Then checkpoint
git add <changed_files>
git commit -m "feat: describe coherent slice"
git push origin $(git branch --show-current)
git status --short --branch
```

### Integrating changes pushed by the user from another tool

When the user says they changed code locally elsewhere (VS Code, Claude Code, Cursor, etc.) and pushed it to GitHub, treat it as a review-and-integration task rather than blindly pulling:

1. Inspect local state first: `git status --short --branch`, recent `git log`, and remotes.
2. Fetch, do not pull immediately: `git fetch --prune origin`.
3. Compare divergence: `git rev-list --left-right --count HEAD...origin/<branch>`.
4. Review incoming diff before integrating: `git diff --stat HEAD..origin/<branch>`, `git diff --name-status`, and targeted diffs for auth/security/build files.
5. Preserve untracked/local files before merge if they exist and are unrelated.
6. Prefer `git merge --ff-only origin/<branch>` when local is only behind; if branches diverged, stop and inspect conflicts before choosing merge/rebase.
7. Run the project’s normal verification suite plus any targeted regression checks for the area changed.
8. Distinguish repository integration from deployment: do not trigger staging/production deploys unless the user asks or has authorized that scope.


### Final staging approval / revalidation passes

When the user asks for a final approval or revalidation against staging after a specific commit, treat it as a gated release check, not just a local test run:

1. Resolve the repository identity before fetching: if the user uses a short/project name (for example "nugacore") or corrects the repo name, search likely local checkouts, require an actual `.git` directory, inspect `git remote -v`, and test read access with `git fetch`/`git ls-remote` without printing credentials. Do not treat a similarly named directory without `.git` as the repo.
2. Fast-forward the staging checkout exactly as requested (`git fetch`, `git checkout <branch>`, `git pull --ff-only`) and verify the requested commit appears in `git log --oneline -5` or is an ancestor of the remote branch. If the requested commit cannot be fetched or does not exist locally/remotely, stop with `NO APROBADA` rather than validating a different HEAD.
3. Run local gates before API probing: typecheck, tests, and build. Keep raw output grounded, but summarize pass/fail rather than pasting huge logs.
3. If the user explicitly authorizes redeploy, trigger the known deploy mechanism and poll until the running container image includes the expected commit context and reports healthy. For Coolify-backed apps, use only sanitized deployment identifiers in docs/final replies, never print API tokens, and document clearly whether the running artifact exactly matches the requested commit or a later `main` HEAD that includes it.
4. For secret-redaction checks, write probes that inspect booleans/pattern presence only. Never print full scripts, tokens, private keys, passwords, or JWTs; print only PASS/FAIL and pattern names.
5. For staging auth/RBAC checks, do not rotate shared fixture-user passwords just to get JWTs. Prefer temporary users; if shared staging users must be touched, preserve or restore the agreed password before finishing and never commit passwords to docs.
6. If staging auth is required, prefer a temporary fixture user/credential scoped to the validation and delete it after the run. Do not reuse or print shared staging passwords.
6. For payment/webhook/reactivation approvals, check persistence-mode mismatches (`customers`/`billing` on DB while `payments` or actions are in-memory), request-vs-implementation contract mismatches such as `amount` vs `amountCents`, and whether logical reactivation resolves customers through the real domain service rather than mock store state.
7. For Router Enrollment / RouterOS template-engine approvals, verify more than successful creation: compare template-specific script fingerprints for create and download, confirm detail metadata, probe invalid-template requests for orphan peers/routers/enrollments, and drive the wizard far enough to prove the selected template propagates to the summary/payload.
7. For UI RBAC release gates, do not stop at API checks. Create temporary real-auth users for every relevant role, log in through the browser, and verify both navigation visibility and action-control visibility/absence. Also hit the write endpoints with non-writer roles and require 403.
8. For wizard/template-selection release gates, verify the deployed JS bundle or image commit first, then validate the real browser state and the actual fetch payload. A visible selected card is not enough: require `aria-pressed`, summary label, request `templateId`, response `templateId`, filename/script boolean markers, and default-template behavior.
9. For dynamic RouterOS template-parameter release gates, validate both runtime behavior and persistence/migration readiness. Parameter endpoints, UI payloads, redaction, and script boolean markers can all pass against in-memory stores while the required Supabase table/column migration is still unapplied or unverified; if the DB schema check fails (for example PostgREST `PGRST205` on `router_enrollment.template_parameters`) mark the phase blocked and document exact endpoint/status/code.
10. Clean up test artifacts through public APIs where possible; if a resource has no physical delete endpoint, use the safest lifecycle operation available (for example revoke). If artifacts are in-memory only, a container restart plus healthcheck can be the cleanup verification. Explicitly preserve official/default infrastructure.
10. For read-only dashboard/module approvals, validate the whole release gate: requested HEAD plus included feature commit, container image SHA, runtime flags, real JWT RBAC across roles, blocked write methods, UI navigation/action absence, payload secret scans, polling/rate-limit behavior when relevant, and sanitized docs.
11. For architecture-hardening / build-artifact-policy approvals, validate each requested diff range separately, classify documentation-only dangerous-word matches separately from executable paths, prove build artifacts such as `dist/` are ignored/not tracked and rebuilt from source, then run broad smoke tests plus deploy/health/log gates.
11. For customer onboarding / IPAM / Client 360 quick-actions approvals, validate the requested commit plus any later Client 360 HEAD on `origin/main`, deploy and health, IPAM backend revalidation, WISP Core mock/read-only endpoints, real browser UI, role-specific quick-action visibility, static no-RouterOS-call scans, logs/payload secret scans, and sanitized docs.
11. For WISP sidebar/dashboard/navigation simplification approvals, verify simplified section hierarchy, hidden-but-intact internal modules, Manual de Usuario role visibility, dashboard KPI hierarchy, browser navigation of critical modules, and visual identity preservation. If browser console shows broad `429 Too Many Requests` bursts across unrelated endpoints, investigate frontend request fan-out before changing backend rate-limit settings.
12. For dry-run/audit foundation approvals, first confirm the requested SHA is in `origin/main`; then inspect state transitions, audit records, RBAC, UI affordances, docs, and static safety patterns. Treat documentary/test `FORBIDDEN` matches as guards, not live execution.
13. For WISP UI polling/rate-limit hotfixes, verify the deployed bundle, reproduce/count `/api/` resource fan-out per module, scope shell/root data fetching to the active tab, keep module-local loaders isolated, add a regression test against global dataset polling, then redeploy and require browser console plus logs to show no real 429 spam.
12. If only documentation changes as a result, commit and push a docs-only commit with a conventional message. Never amend or force-push unless the user explicitly asks.
12. If only documentation changes as a result, commit and push a docs-only commit with a conventional message. Never amend or force-push unless the user explicitly asks. If the docs-only commit is pushed after staging validation, state whether the running artifact was rebuilt from that docs commit or remains on the previously validated functional HEAD; do not overclaim exact deployed HEAD.

General commit command:

```bash
# Stage specific files
git add src/auth.py src/models/user.py tests/test_auth.py

# Commit with a conventional commit message
git commit -m "feat: add JWT-based user authentication

- Add login/register endpoints
- Add User model with password hashing
- Add auth middleware for protected routes
- Add unit tests for auth flow"
```

Commit message format (Conventional Commits):
```
type(scope): short description

Longer explanation if needed. Wrap at 72 characters.
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`, `perf`

## 3. Pushing and Creating a PR

### Push the Branch (same either way)

```bash
git push -u origin HEAD
```

### Create the PR

**With gh:**

```bash
gh pr create \
  --title "feat: add JWT-based user authentication" \
  --body "## Summary
- Adds login and register API endpoints
- JWT token generation and validation

## Test Plan
- [ ] Unit tests pass

Closes #42"
```

Options: `--draft`, `--reviewer user1,user2`, `--label "enhancement"`, `--base develop`

**With git + curl:**

```bash
BRANCH=$(git branch --show-current)

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$OWNER/$REPO/pulls \
  -d "{
    \"title\": \"feat: add JWT-based user authentication\",
    \"body\": \"## Summary\nAdds login and register API endpoints.\n\nCloses #42\",
    \"head\": \"$BRANCH\",
    \"base\": \"main\"
  }"
```

The response JSON includes the PR `number` — save it for later commands.

To create as a draft, add `"draft": true` to the JSON body.

## 4. Monitoring CI Status

### Check CI Status

**With gh:**

```bash
# One-shot check
gh pr checks

# Watch until all checks finish (polls every 10s)
gh pr checks --watch
```

**With git + curl:**

```bash
# Get the latest commit SHA on the current branch
SHA=$(git rev-parse HEAD)

# Query the combined status
curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/commits/$SHA/status \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f\"Overall: {data['state']}\")
for s in data.get('statuses', []):
    print(f\"  {s['context']}: {s['state']} - {s.get('description', '')}\")"

# Also check GitHub Actions check runs (separate endpoint)
curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/commits/$SHA/check-runs \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for cr in data.get('check_runs', []):
    print(f\"  {cr['name']}: {cr['status']} / {cr['conclusion'] or 'pending'}\")"
```

### Poll Until Complete (git + curl)

```bash
# Simple polling loop — check every 30 seconds, up to 10 minutes
SHA=$(git rev-parse HEAD)
for i in $(seq 1 20); do
  STATUS=$(curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    https://api.github.com/repos/$OWNER/$REPO/commits/$SHA/status \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
  echo "Check $i: $STATUS"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failure" ] || [ "$STATUS" = "error" ]; then
    break
  fi
  sleep 30
done
```

## 5. Auto-Fixing CI Failures

When CI fails, diagnose and fix. This loop works with either auth method.

### Step 1: Get Failure Details

**With gh:**

```bash
# List recent workflow runs on this branch
gh run list --branch $(git branch --show-current) --limit 5

# View failed logs
gh run view <RUN_ID> --log-failed
```

**With git + curl:**

```bash
BRANCH=$(git branch --show-current)

# List workflow runs on this branch
curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/actions/runs?branch=$BRANCH&per_page=5" \
  | python3 -c "
import sys, json
runs = json.load(sys.stdin)['workflow_runs']
for r in runs:
    print(f\"Run {r['id']}: {r['name']} - {r['conclusion'] or r['status']}\")"

# Get failed job logs (download as zip, extract, read)
RUN_ID=<run_id>
curl -s -L \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/actions/runs/$RUN_ID/logs \
  -o /tmp/ci-logs.zip
cd /tmp && unzip -o ci-logs.zip -d ci-logs && cat ci-logs/*.txt
```

### Step 2: Fix and Push

After identifying the issue, use file tools (`patch`, `write_file`) to fix it:

```bash
git add <fixed_files>
git commit -m "fix: resolve CI failure in <check_name>"
git push
```

### Step 3: Verify

Re-check CI status using the commands from Section 4 above.

### Auto-Fix Loop Pattern

When asked to auto-fix CI, follow this loop:

1. Check CI status → identify failures
2. Read failure logs → understand the error
3. Use `read_file` + `patch`/`write_file` → fix the code
4. `git add . && git commit -m "fix: ..." && git push`
5. Wait for CI → re-check status
6. Repeat if still failing (up to 3 attempts, then ask the user)

## 6. Merging

**With gh:**

```bash
# Squash merge + delete branch (cleanest for feature branches)
gh pr merge --squash --delete-branch

# Enable auto-merge (merges when all checks pass)
gh pr merge --auto --squash --delete-branch
```

**With git + curl:**

```bash
PR_NUMBER=<number>

# Merge the PR via API (squash)
curl -s -X PUT \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER/merge \
  -d "{
    \"merge_method\": \"squash\",
    \"commit_title\": \"feat: add user authentication (#$PR_NUMBER)\"
  }"

# Delete the remote branch after merge
BRANCH=$(git branch --show-current)
git push origin --delete $BRANCH

# Switch back to main locally
git checkout main && git pull origin main
git branch -d $BRANCH
```

Merge methods: `"merge"` (merge commit), `"squash"`, `"rebase"`

### Enable Auto-Merge (curl)

```bash
# Auto-merge requires the repo to have it enabled in settings.
# This uses the GraphQL API since REST doesn't support auto-merge.
PR_NODE_ID=$(curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['node_id'])")

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/graphql \
  -d "{\"query\": \"mutation { enablePullRequestAutoMerge(input: {pullRequestId: \\\"$PR_NODE_ID\\\", mergeMethod: SQUASH}) { clientMutationId } }\"}"
```

## 7. Complete Workflow Example

```bash
# 1. Start from clean main
git checkout main && git pull origin main

# 2. Branch
git checkout -b fix/login-redirect-bug

# 3. (Agent makes code changes with file tools)

# 4. Commit
git add src/auth/login.py tests/test_login.py
git commit -m "fix: correct redirect URL after login

Preserves the ?next= parameter instead of always redirecting to /dashboard."

# 5. Push
git push -u origin HEAD

# 6. Create PR (picks gh or curl based on what's available)
# ... (see Section 3)

# 7. Monitor CI (see Section 4)

# 8. Merge when green (see Section 6)
```

## Useful PR Commands Reference

| Action | gh | git + curl |
|--------|-----|-----------|
| List my PRs | `gh pr list --author @me` | `curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$OWNER/$REPO/pulls?state=open"` |
| View PR diff | `gh pr diff` | `git diff main...HEAD` (local) or `curl -H "Accept: application/vnd.github.diff" ...` |
| Add comment | `gh pr comment N --body "..."` | `curl -X POST .../issues/N/comments -d '{"body":"..."}'` |
| Request review | `gh pr edit N --add-reviewer user` | `curl -X POST .../pulls/N/requested_reviewers -d '{"reviewers":["user"]}'` |
| Close PR | `gh pr close N` | `curl -X PATCH .../pulls/N -d '{"state":"closed"}'` |
| Check out someone's PR | `gh pr checkout N` | `git fetch origin pull/N/head:pr-N && git checkout pr-N` |

## Adjacent GitHub Workflows That Belong in This Umbrella

### Pre-commit verification and local review

The old `requesting-code-review` skill is absorbed here. Treat local diff verification, security scanning, regression checks, and independent review before commit as part of the same GitHub/PR workflow class, not a separate micro-skill.

Use this umbrella when the user asks for any of the following before or during PR work:
- review my changes before commit
- verify this diff
- run the pre-merge quality gate
- do a security sanity check before push

The workflow shape is: inspect diff → run project checks → surface security / logic findings → iterate before opening or merging the PR.


### Authentication and transport setup
- Decide early whether the machine will use `gh`, HTTPS+token, or SSH.
- For agent work, verify both **git transport** and **API auth** before assuming later GitHub failures are repository problems.
- Prefer one fast detection pass up front: `command -v gh`, `gh auth status`, `git remote -v`, and whether `GITHUB_TOKEN` is available.
- For private repos where Hermes needs repo-scoped pull/push but no GitHub credentials are configured, prefer an SSH deploy key with a host alias and `git push --dry-run` verification before doing any real push.

### Repository management
- Treat clone/create/fork/remote wiring as part of the same GitHub workflow class, not a separate discovery problem.
- Before opening issues or PRs, verify `owner/repo`, default branch, and whether you're on the correct fork.
- For release/admin tasks, keep a distinction between local git state and hosted-repo settings/state.

### Issues management
- Use issues when the user wants capture/triage/assignment work before code exists.
- Good issue operations in the same session often lead directly into branch/PR work; keep templates, labels, and assignees explicit.
- When filing bugs, include repro steps, expected behavior, actual behavior, and scope/impact.

### Code review
- Review can happen either **before pushing** (local diff review) or **on an open PR** (hosted review comments/checks).
- Always separate factual findings from stylistic suggestions.
- Anchor review comments to concrete files, lines, and failure modes; don't produce vague "looks risky" feedback.

### Codebase inspection
- When the user asks repo-sizing or language-mix questions before planning work, use a quick inspection pass first.
- LOC/language breakdown is an adjacent intake workflow that helps estimate PR size, test surface, and ownership.
- Exclude generated/vendor/build directories before drawing conclusions from repository stats.

## Umbrella Decision Rule

If the user asks for any GitHub task that naturally touches **auth, repo setup, issues, review, or PR execution**, load this umbrella skill first instead of hunting for a narrower sibling skill name.
