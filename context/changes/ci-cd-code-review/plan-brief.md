# AI Code-Review CI/CD Pipeline — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Give the repo its first automated PR code review. Every PR to `main` gets the
existing `packages/code-reviewer` agent run over its diff, leaving a summary
comment and a pass/fail label — so reviewers get an instant, structured first read
without anyone running the agent by hand.

## Starting Point

The review engine already exists (`packages/code-reviewer`, built last stage): a
stdin→stdout filter that emits structured JSON (5 scores + verdict + summary). The
repo has one workflow (`ci.yml`, build+test) and no composite actions, no label
automation, and `OPENROUTER_API_KEY` is not yet a GitHub Actions secret.

## Desired End State

Opening/updating a same-repo PR to `main` triggers `review.yml`; the PR ends up with
one AI summary comment and exactly one of `ai-cr:passed` (green) / `ai-cr:failed`
(red). Adding `ai-cr:review` re-runs the review (then the label is consumed). A
manual `workflow_dispatch` prints the agent JSON to the run log without touching any
PR. The workflow is advisory — always green — and `ci.yml` is unchanged.

## Key Decisions Made

| Decision            | Choice                                | Why (1 sentence)                                                                                                | Source        |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| Verdict semantics   | Advisory only (verdict→label, exit 0) | Matches requirements; avoids deadlock from flaky LLM output — overrides the "merge gate" wording in the request | Research/Plan |
| Engine              | Reuse `packages/code-reviewer` as-is  | Already a CI-ready stdin→stdout filter                                                                          | Research      |
| Fork PRs            | Same-repo only (guard `head.repo`)    | Forks lack secrets + write token                                                                                | Research      |
| tsx in CI           | Pin as devDependency                  | Reproducible, cache-friendly; dev tool, not an app dep                                                          | Plan          |
| Big diffs           | Cap + truncate with notice            | Always produce a review; bound tokens; transparent                                                              | Plan          |
| Labels              | Idempotent `gh label create --force`  | Self-bootstrapping with guaranteed red/green colors                                                             | Plan          |
| `workflow_dispatch` | Diff ref vs main, print-only          | Simple pipeline smoke test without a PR                                                                         | Plan          |
| Layering            | Thin workflow + composite action      | Requirements: keep the main workflow simple                                                                     | Requirements  |

## Scope

**In scope:** composite action `.github/actions/ai-reviewer/`; `.github/workflows/review.yml`
(`pull_request`→main + `workflow_dispatch`); pr-title/pr-body/diff inputs; `fetch-depth: 0`;
PR comment + `ai-cr:passed`/`failed` labels; `ai-cr:review` retry; tsx devDependency.

**Out of scope:** blocking/required check; editing `ci.yml`; fork-PR support;
commit-back of a report; business-alignment & architecture-fit scoring; changes to
the agent source.

## Architecture / Approach

`review.yml` (event layer): triggers, same-repo + label-event guards, concurrency,
`pull-requests: write`, checkout `fetch-depth: 0`, `npm ci`, compute
diff (`origin/main...HEAD`, truncated) + title/body, then call the action. The
composite action (review mechanics): ensure labels → pipe diff to
`npx tsx packages/code-reviewer/review.ts` → `jq` the verdict/summary → post marked
comment + apply label (PR mode) or print JSON (dispatch). Verdict is a step output,
never the job's exit status.

## Phases at a Glance

| Phase                     | What it delivers                                            | Key risk                                                                     |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Composite action + tsx | `action.yml` + pinned tsx; agent wrapped end-to-end         | Capturing agent stdout cleanly vs stderr; advisory-on-failure handling       |
| 2. Workflow wiring        | `review.yml` triggers/guards/inputs; retry + dispatch paths | Label-event recursion; multi-line input passing; same-repo guard correctness |

**Prerequisites:** add `OPENROUTER_API_KEY` as a GitHub Actions repo secret (manual, one-time).
**Estimated effort:** ~1-2 sessions across 2 phases (YAML + shell glue; no app code).

## Open Risks & Assumptions

- LLM cost/latency on every PR push (mitigated by `cancel-in-progress`).
- Truncated diffs review only the leading portion (noted in the comment).
- Until the secret is set, runs post a neutral "review could not run" comment.
- `gh`/`jq` are available on `ubuntu-latest` runners (they are by default).

## Success Criteria (Summary)

- A PR with a planted issue gets `ai-cr:failed` + a comment naming it; a clean PR gets `ai-cr:passed`.
- `ai-cr:review` re-runs the review and is consumed; `workflow_dispatch` prints JSON only.
- Both review checks stay green (advisory) and `ci.yml` is untouched.
