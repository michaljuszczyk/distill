# AI Code-Review Pipeline — Requirements

Repo: Astro / React / Cloudflare Workers / Supabase. Default branch: `main`.
Review engine: the `packages/code-reviewer` agent built in the prior stage
(Vercel AI SDK `ToolLoopAgent` + OpenRouter, zod-schema structured output).

## Overall concept

- GitHub Actions workflow triggers on every `pull_request` targeting `main`,
  plus `workflow_dispatch` for manual test runs.
- Review logic lives in a **composite action** so the main workflow stays thin
  (checkout → compute diff → call action → publish results).
- Do **NOT** modify the existing `.github/workflows/ci.yml`. This is a separate,
  standalone workflow.

## Input parameters

- PR title
- PR description (body)
- git diff — computed against the base branch (`main`)

## Code Review Criteria (1-10, 1 = worst / 10 = best)

These match the `reviewSchema` in `packages/code-reviewer/schema.ts`:

1. **correctness** — does the code do what it intends? Logic errors, edge cases,
   off-by-one, null handling.
2. **security** — injection, secrets in code, authz/authn gaps, unsafe input
   handling.
3. **maintainability** — naming, structure, duplication, complexity, comments.
4. **testCoverage** — are changed paths covered by tests with meaningful
   assertions and edge cases?
5. **performance** — needless allocations, N+1 queries, blocking I/O,
   algorithmic cost.

Plus a binding **pass/fail verdict** and a short **markdown summary**.

## Parked for later

- Business alignment — needs product/PRD context beyond the diff.
- Architectural fit — needs broader codebase context than the diff alone.

## Expected side-effects

- PR comment containing the review summary.
- Labels applied to the PR:
  - `ai-cr:failed` (red) when verdict = fail
  - `ai-cr:passed` (green) when verdict = pass

## Expected behavior

- On-demand retry: re-run the review when the label `ai-cr:review` is added to
  the PR.
