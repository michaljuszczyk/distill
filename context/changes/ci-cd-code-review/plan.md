# AI Code-Review CI/CD Pipeline Implementation Plan

## Overview

Add the repo's first AI code-review automation: a standalone GitHub Actions
workflow that, on every PR to `main`, computes the PR's title/body/diff and hands
them to a composite action which runs the existing `packages/code-reviewer` agent
(OpenRouter, structured `reviewSchema` output). The action posts a summary PR
comment and applies a colored pass/fail label. The pipeline is **advisory** — it
never blocks a merge; the verdict drives a label, not a check failure. The
existing `.github/workflows/ci.yml` is left untouched.

## Current State Analysis

- **Engine exists and is CI-ready**: `packages/code-reviewer/review.ts` reads a
  git diff on **stdin**, requires `OPENROUTER_API_KEY` from `process.env`
  (`review.ts:19`), and writes **JSON only to stdout** (2-space indented, trailing
  newline — `review.ts:45`). Diagnostics go to stderr. Exit 1 on missing key /
  empty stdin / thrown error; exit 0 on success. Schema keys: `correctness`,
  `security`, `maintainability`, `testCoverage`, `performance` (int 1-10),
  `verdict` (enum `"pass"`|`"fail"`, `schema.ts:36-40`), `summary` (markdown).
  No own `package.json`/`tsconfig` — relies on repo root; `ai`@6, `@openrouter/ai-sdk-provider`@2.9,
  `zod`@4 are root deps.
- **No tsx dependency**: `package.json` has no `tsx` (scripts use astro/vitest).
  `npx tsx` currently fetches it at runtime.
- **Existing CI**: `.github/workflows/ci.yml` — push/PR to `main`, build+test, reads
  `SUPABASE_URL`/`SUPABASE_KEY`. Read-only token (no explicit `permissions`). Must
  not be modified.
- **No composite actions** (`.github/actions/` absent). No label automation anywhere.
- **`OPENROUTER_API_KEY`** is declared server-secret in `astro.config.mjs` and read
  in app code via `astro:env/server`, but the CI agent reads it from `process.env`.
  It exists locally in `.dev.vars` but is **not yet a GitHub Actions secret** —
  a setup prerequisite.

See `context/changes/ci-cd-code-review/research.md` for the full pattern-donor
analysis (`.claude/skills/10x-impl-review-ci/references/workflow-template.yml`).

## Desired End State

Opening or updating a same-repo PR against `main` triggers `review.yml`. Within a
run the pipeline computes the diff, runs the agent, and leaves the PR with:

- exactly one (latest) AI-review summary comment carrying the verdict + markdown summary, and
- exactly one of `ai-cr:passed` (green) / `ai-cr:failed` (red).

Adding the `ai-cr:review` label re-runs the review and the label is consumed
(removed) afterward so it can be re-added to trigger again. A `workflow_dispatch`
run diffs the selected ref against `main` and prints the agent's JSON to the run
log without touching any PR. The workflow always exits 0 (advisory). `ci.yml` is
unchanged.

**Verify**: a test PR with a deliberate issue (e.g., a hardcoded secret) gets an
`ai-cr:failed` label and a comment naming it; a clean PR gets `ai-cr:passed`; a
manual dispatch prints valid JSON in the logs; both checks are green either way.

### Key Discoveries:

- Agent contract is a clean stdin→stdout filter (`review.ts:13-51`) — the action
  pipes `diff` to it and parses stdout with `jq` (`.verdict`, `.summary`).
- Template's `pull_request` `labeled` trigger (`workflow-template.yml:28-34`) is the
  mechanism for the `ai-cr:review` retry; its fork guard (`:47`) and `concurrency`
  (`:48-50`) port directly.
- Because we never commit back, the template's `[skip ci]` recursion guard,
  validate-commit step, and `contents: write` are all unnecessary —
  `pull-requests: write` is the only elevated permission needed.

## What We're NOT Doing

- **Not** blocking merges. Despite the "merge gate" wording in the planning
  request, the verdict is **advisory** (decision reaffirmed during planning,
  consistent with `requirements.md`): verdict → label, workflow exits 0. No
  failing/required check, no override label.
- **Not** modifying `.github/workflows/ci.yml`.
- **Not** supporting fork PRs — same-repo only (forks lack secrets + write token).
- **Not** committing any report file back to the branch.
- **Not** scoring business alignment or architectural fit (parked — need broader
  context than the diff).
- **Not** changing `packages/code-reviewer` source (it's already CI-ready); only
  its invocation environment is added.

## Implementation Approach

Two layers, matching the requirements' "composite action so the main workflow stays
simple":

- **Workflow (`review.yml`)** owns GitHub event handling: triggers, same-repo guard,
  label-event filtering, concurrency, permissions, secret wiring, checkout with
  `fetch-depth: 0`, and computation of the three inputs (`pr-title`, `pr-body`,
  `diff`). It decides PR-mode vs dispatch-print-only mode and calls the action.
- **Composite action (`.github/actions/ai-reviewer/action.yml`)** owns review
  mechanics: ensure labels exist (colored), run the agent over the (possibly
  truncated) diff, parse the structured output, and — in PR mode — post the marked
  comment and apply the pass/fail label. It exposes the verdict as a step output but
  never fails the job.

The agent runs via `npx tsx` resolving a pinned `tsx` devDependency (added in
Phase 1) after `npm ci`.

## Critical Implementation Details

- **Advisory invariant**: the agent exits 1 on internal failure (missing key, empty
  diff, provider error). The action must not let that fail the job in a way that
  reads as "review says fail" — capture the agent's exit code separately from the
  parsed `verdict`. A non-zero agent exit → post a neutral "review could not run"
  comment, apply neither pass nor fail label, and still exit 0.
- **stdout purity**: only the agent's stdout is JSON; `npx`/tsx notices go to
  stderr. Capture stdout alone (`"$(... 2>/dev/null)"` or redirect stderr to the
  log) before `jq`.
- **Diff truncation happens before the agent**, in the workflow's diff computation
  (the `diff` input is already the bounded string), so the action stays mode-agnostic.
- **Label-event recursion**: removing `ai-cr:review` in the action fires an
  `unlabeled` event; the workflow's label guard must only act on the `labeled`
  event whose `github.event.label.name == 'ai-cr:review'`, so the removal doesn't
  retrigger a run.

## Phase 1: Composite action + tsx provisioning

### Overview

Add `tsx` as a pinned devDependency and build the composite action that wraps the
agent end-to-end: ensure labels, run + parse the agent, and (conditionally) comment
and label.

### Changes Required:

#### 1. Pin tsx as a devDependency

**File**: `package.json`

**Intent**: Make `npx tsx` resolve a pinned local binary in CI (reproducible,
cache-friendly) instead of fetching at runtime. tsx is a dev tool, not an app
dependency.

**Contract**: Add `tsx` to `devDependencies` at a pinned caret version; `package-lock.json`
updated via `npm install`. No script changes required (`npx tsx` resolves the local
install).

#### 2. Composite action definition

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: A `using: composite` action that runs the review and produces all PR
side-effects, so `review.yml` only wires events. Advisory by contract — never exits
non-zero.

**Contract**: Inputs — `pr-title`, `pr-body`, `diff` (required strings),
`pr-number` (string, empty in dispatch mode), `post-results` (`"true"`/`"false"`),
`openrouter-api-key`, `github-token`. Output — `verdict` (`pass`|`fail`|`unknown`).
Steps (all `shell: bash`):

1. **Ensure labels** (only when `post-results == 'true'`): `gh label create --force`
   for `ai-cr:passed` (green, e.g. `0e8a16`), `ai-cr:failed` (red, e.g. `d73a4a`),
   `ai-cr:review` (neutral) — idempotent, sets colors.
2. **Run agent**: pipe `inputs.diff` on stdin to `npx tsx packages/code-reviewer/review.ts`,
   capturing stdout to a var and the exit code separately. `OPENROUTER_API_KEY` from
   `inputs.openrouter-api-key` via `env:`.
3. **Parse**: `jq -r '.verdict'` and `jq -r '.summary'` from captured stdout; guard
   against non-JSON (agent failure) → set `verdict=unknown`.
4. **Post (PR mode only)**: build a comment body containing the verdict, the markdown
   summary, and a hidden marker `<!-- ai-cr:marker -->`; `gh pr comment "$PR_NUMBER"`;
   then delete prior bot comments carrying the marker (post-new-then-delete-old, per
   the template's cleanup pattern). Apply `ai-cr:passed` or `ai-cr:failed` and remove
   the opposite via `gh pr edit --add-label/--remove-label`. On `verdict=unknown`,
   post a neutral "review could not run" comment and apply neither label.
5. **Dispatch mode** (`post-results == 'false'`): print the captured JSON to the log;
   skip ensure-labels, comment, and labeling.
   `GH_TOKEN` from `inputs.github-token` for all `gh` calls.

### Success Criteria:

#### Automated Verification:

- Action file parses as valid YAML: `npx js-yaml .github/actions/ai-reviewer/action.yml` (or `python -c 'import yaml,sys; yaml.safe_load(open("...")) '`)
- `tsx` present in lockfile: `node -e "require('./package-lock.json')" && grep -q '"tsx"' package-lock.json`
- Agent still runs locally through tsx: `printf '%s' "$(cat packages/code-reviewer/sample.diff 2>/dev/null || echo 'diff --git a/x b/x')" | OPENROUTER_API_KEY=$OPENROUTER_API_KEY npx tsx packages/code-reviewer/review.ts | jq -e '.verdict'` (skip if no key)
- Lint/typecheck unaffected: `npm run lint` and `npm run typecheck` pass
- `ci.yml` unchanged: `git diff --quiet -- .github/workflows/ci.yml`

#### Manual Verification:

- `action.yml` inputs/outputs read clearly and match what `review.yml` will pass
- Label colors render red/green as intended after first run
- Comment body is scannable (verdict header + summary) and carries the hidden marker

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Workflow wiring (review.yml)

### Overview

Add the standalone workflow that handles PR + dispatch events, guards forks and
label noise, computes the three inputs, and invokes the composite action.

### Changes Required:

#### 1. Review workflow

**File**: `.github/workflows/review.yml`

**Intent**: Thin event layer. Triggers the advisory review on same-repo PRs to
`main`, supports the `ai-cr:review` retry, and offers a print-only manual dispatch.

**Contract**:

- **Triggers**: `pull_request` to `main` with `types: [opened, synchronize, reopened, labeled]`; `workflow_dispatch`.
- **Top-level `permissions: {}`**; job `permissions: pull-requests: write`.
- **Job `if`** (same-repo + label filter): run when
  `github.event_name == 'workflow_dispatch'`, OR a non-label PR event, OR a
  `labeled` event with `github.event.label.name == 'ai-cr:review'` — AND, for PR
  events, `github.event.pull_request.head.repo.full_name == github.repository`.
- **`concurrency`**: `group: ai-review-${{ github.event.pull_request.number || github.ref }}`, `cancel-in-progress: true`.
- **Checkout**: `actions/checkout@v4` with `fetch-depth: 0` and (PR mode) `ref: head.ref`.
- **Setup**: `actions/setup-node@v4` node 22, npm cache; `npm ci`.
- **Compute inputs** (bash step, outputs): base = `origin/main`;
  `git fetch origin main`; `DIFF=$(git diff origin/main...HEAD)`; **truncate** to a
  byte cap (e.g. 200 KB) and append a `\n[diff truncated at N bytes]` notice when
  over; in PR mode read title/body via `gh pr view --json title,body`; in dispatch
  mode title/body are synthetic (`"manual dispatch: <ref>"`). Pass multi-line
  values to the action safely (heredoc/`$GITHUB_OUTPUT` delimiter).
- **Consume retry label** (PR mode, before or after review): `gh pr edit "$PR" --remove-label ai-cr:review` guarded so it only runs when the label is present.
- **Invoke action**: `uses: ./.github/actions/ai-reviewer` with `post-results: ${{ github.event_name != 'workflow_dispatch' }}`, `pr-number: ${{ github.event.pull_request.number }}`, `openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}`, `github-token: ${{ secrets.GITHUB_TOKEN }}`, and the computed title/body/diff.
- **Never fail on verdict**: no step keys off the action's `verdict` output to set job status.

#### 2. Setup prerequisite (documentation)

**File**: `context/changes/ci-cd-code-review/plan.md` (this plan's Migration Notes) + PR description at implementation time.

**Intent**: Record that `OPENROUTER_API_KEY` must be added as a GitHub Actions repo
secret before the workflow can succeed.

**Contract**: `gh secret set OPENROUTER_API_KEY` (value from `.dev.vars`) — a manual,
one-time step; no code.

### Success Criteria:

#### Automated Verification:

- Workflow parses as valid YAML and is well-formed: `npx js-yaml .github/workflows/review.yml`
- Action reference resolves (path exists): `test -f .github/actions/ai-reviewer/action.yml`
- `ci.yml` still unchanged: `git diff --quiet -- .github/workflows/ci.yml`
- Lint/typecheck/test unaffected: `npm run lint && npm run typecheck && npm test`

#### Manual Verification:

- After adding the `OPENROUTER_API_KEY` secret: open a test PR with a planted issue → `ai-cr:failed` + comment naming it; both checks green (advisory)
- A clean test PR → `ai-cr:passed` + comment; checks green
- Add `ai-cr:review` to a reviewed PR → review re-runs and the label is removed afterward
- A fork PR (if available) is skipped (no run, no error)
- `workflow_dispatch` on a branch → JSON printed in the run log, no PR comment/labels
- Re-running on a PR replaces the prior AI comment (only one marked comment remains)

**Implementation Note**: After automated verification passes, pause for manual
confirmation (requires the secret to be set and a test PR).

---

## Testing Strategy

### Unit Tests:

- None added — the agent already ran successfully this session; the new artifacts are
  YAML + shell glue, verified by YAML parse + live runs. No app code changes.

### Integration Tests:

- End-to-end exercised via real PRs in Manual Verification (planted-issue PR, clean
  PR, retry-label, dispatch, fork-skip).

### Manual Testing Steps:

1. Set `OPENROUTER_API_KEY` as a repo Actions secret.
2. Open a PR to `main` containing a hardcoded secret → expect `ai-cr:failed` + comment.
3. Open a clean PR → expect `ai-cr:passed`.
4. Add `ai-cr:review` to a PR → expect a fresh review and the label removed.
5. Run the workflow via Actions → workflow_dispatch on a branch → expect JSON in logs only.
6. Push a second commit to a reviewed PR → expect the old AI comment replaced, not duplicated.

## Performance Considerations

- One LLM call per PR push; `concurrency: cancel-in-progress` discards superseded runs.
- Diff truncation (byte cap) bounds token usage and prevents opaque provider errors on
  huge PRs, at the cost of reviewing only the leading portion (noted in the comment).

## Migration Notes

- **Prerequisite**: add `OPENROUTER_API_KEY` as a GitHub Actions repository secret
  (`gh secret set OPENROUTER_API_KEY`) — currently only in local `.dev.vars`. Until
  set, runs post a neutral "review could not run" comment (advisory; no red label,
  no failed check).
- The three `ai-cr:*` labels are auto-created with colors on first run (ensure-labels
  step); no manual label setup needed.

## References

- Related research: `context/changes/ci-cd-code-review/research.md`
- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Pattern donor: `.claude/skills/10x-impl-review-ci/references/workflow-template.yml:28-301`
- Engine: `packages/code-reviewer/review.ts:13-51`, `packages/code-reviewer/schema.ts:5-46`
- Existing CI (untouched): `.github/workflows/ci.yml:1-26`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Composite action + tsx provisioning

#### Automated

- [x] 1.1 Action file parses as valid YAML — 62753f5
- [x] 1.2 tsx present in lockfile — 62753f5
- [x] 1.3 Agent still runs locally through tsx (jq .verdict) — 62753f5
- [x] 1.4 Lint and typecheck pass — 62753f5
- [x] 1.5 ci.yml unchanged — 62753f5

#### Manual

- [ ] 1.6 action.yml inputs/outputs match what review.yml passes
- [ ] 1.7 Label colors render red/green
- [ ] 1.8 Comment body scannable + carries hidden marker

### Phase 2: Workflow wiring (review.yml)

#### Automated

- [x] 2.1 review.yml parses as valid YAML and is well-formed — fffc828
- [x] 2.2 Action reference path resolves — fffc828
- [x] 2.3 ci.yml still unchanged — fffc828
- [x] 2.4 Lint, typecheck, and test pass — fffc828

#### Manual

- [ ] 2.5 Planted-issue PR → ai-cr:failed + naming comment; checks green
- [ ] 2.6 Clean PR → ai-cr:passed + comment; checks green
- [ ] 2.7 Adding ai-cr:review re-runs review and removes the label
- [ ] 2.8 Fork PR is skipped (no run, no error)
- [ ] 2.9 workflow_dispatch prints JSON in log, no PR comment/labels
- [ ] 2.10 Re-run on a PR replaces prior AI comment (single marked comment)
