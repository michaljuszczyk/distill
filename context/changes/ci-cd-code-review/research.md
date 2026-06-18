---
date: 2026-06-18T11:46:50+0200
researcher: Michal Juszczyk
git_commit: 04c6a7fab38aaf6d3b8f981f3d5cdc15552ad28f
branch: main
repository: michaljuszczyk/distill
topic: "AI code-review CI/CD pipeline — reuse packages/code-reviewer + impl-review-ci patterns"
tags: [research, ci-cd, github-actions, code-review, openrouter, composite-action]
status: complete
last_updated: 2026-06-18
last_updated_by: Michal Juszczyk
---

# Research: AI Code-Review CI/CD Pipeline

**Date**: 2026-06-18T11:46:50+0200
**Researcher**: Michal Juszczyk
**Git Commit**: 04c6a7fab38aaf6d3b8f981f3d5cdc15552ad28f
**Branch**: main
**Repository**: michaljuszczyk/distill

## Research Question

How to build the first CI/CD workflow for AI PR code review on this repo
(Astro/React/Cloudflare/Supabase, base = `main`), per
`context/changes/ci-cd-code-review/requirements.md`. Specifically: how to reuse
the existing `packages/code-reviewer` agent as the review engine, and what to
borrow from the `.claude/skills/10x-impl-review-ci` skill and the CI/CD patterns
in `.claude/prompts/m5l3-cicd.md`.

## Summary

The pieces already exist; this change is **glue**, not new capability.

- **Engine**: `packages/code-reviewer` (built in the prior stage) is a standalone
  Node/tsx script: `git diff` on stdin → JSON on stdout (`reviewSchema`: 5 numeric
  criteria + `verdict` enum + `summary` markdown). It reads
  `process.env.OPENROUTER_API_KEY` and uses OpenRouter — **CI-ready as-is**, no
  Astro runtime, no `astro:env`.
- **Pattern donor, not engine**: `10x-impl-review-ci` and its
  `references/workflow-template.yml` are a rich source of GHA _mechanics_
  (PR triggers, label-gating, `concurrency`, fork guard, label-toggle re-eval,
  comment-cleanup markers, verdict→commit-status gate). But its **engine is
  `claude-code-action` + ANTHROPIC_API_KEY running a skill**, which is a
  different engine than the requirements mandate. We lift mechanics, not the engine.
- **Big simplification**: our pipeline only **comments + labels** — it does NOT
  commit a report back to the branch. That lets us drop the template's heaviest
  machinery: the `[skip ci]` recursion guard, the "validate bot commit" step,
  the skill-staging-into-`~/.claude` dance, and `contents: write`. We need only
  `pull-requests: write`.
- **Decisions locked this session**: verdict is **advisory only** (workflow exits
  0; `verdict=fail` just applies the red label + comment — matches requirements,
  no failing check). Fork PRs are **same-repo only** (guard
  `head.repo.full_name == github.repository`; skip forks so secrets stay safe).

The recommended shape: a thin workflow `.github/workflows/ai-code-review.yml`
(triggers, guards, secret) that calls a composite action
`.github/actions/ai-code-review/action.yml` (checkout-diff → `npm ci` →
`npx tsx` the agent → parse JSON → comment + labels). Do **not** touch
`.github/workflows/ci.yml`.

## Detailed Findings

### Area 1 — The review engine: `packages/code-reviewer`

Exact runtime contract (verified by reading, run successfully earlier this session):

- **Input**: raw git diff on **stdin**, trimmed (`review.ts:13-16`, `:25`).
- **Env**: requires `OPENROUTER_API_KEY` from `process.env` (`review.ts:19`). Missing
  → stderr `"OPENROUTER_API_KEY is not set — model will stay silent…"`, **exit 1**.
- **Empty stdin** → stderr usage line, **exit 1** (`review.ts:25-29`).
- **Output**: **stdout is JSON only**, 2-space indented, with a trailing newline
  (`review.ts:45`, writes `result.experimental_output`). All diagnostics go to stderr.
- **Success exit 0**; any thrown error → stderr + **exit 1** (`review.ts:48-51`).
- **Model/provider**: `deepseek/deepseek-v4-flash` via `@openrouter/ai-sdk-provider`,
  `ToolLoopAgent` with `stopWhen: stepCountIs(2)`, `tools: {}` (`review.ts:5,31-39`).
- **Schema** (`schema.ts:5-46`): keys `correctness`, `security`, `maintainability`,
  `testCoverage`, `performance` (all int 1-10, range in `.describe()` — no min/max),
  `verdict` (**enum: exactly `"pass"` | `"fail"`**, `schema.ts:36-40`), `summary`
  (markdown string).
- **jq extraction**: `.verdict` → `pass`/`fail`; `.summary` → markdown body.
- **No local `package.json`/`tsconfig`** — relies on repo root. Repo is
  `"type": "module"`; `import { reviewSchema } from "./schema.ts"` (explicit `.ts`)
  resolves under `npx tsx` from repo root. `ai`@6.0.191, `@openrouter/ai-sdk-provider`@2.9.0,
  `zod`@4.4.3 are all **root deps** (`package.json:25,32,44`).

Implication: in CI we need only `actions/setup-node` + `npm ci` at repo root, then
`git diff <base>...HEAD | npx tsx packages/code-reviewer/review.ts`. No build, no
Supabase secrets.

### Area 2 — Existing CI and what NOT to touch

`.github/workflows/ci.yml` (`ci.yml:1-26`): single `ci` job on push/PR to `main` —
checkout → setup-node 22 (npm cache) → `npm ci` → `npx astro sync` → lint → test →
`npm run build` (with `SUPABASE_URL`/`SUPABASE_KEY`). No explicit `permissions` (so
read-only token). **Requirements forbid modifying this file** — the new pipeline is a
separate workflow. `.github/actions/` does not exist yet (no composite actions in repo).

### Area 3 — `impl-review-ci` workflow template: what to lift, what to drop

From `.claude/skills/10x-impl-review-ci/references/workflow-template.yml`:

**Lift (directly applicable):**

- **Trigger shape** (`:28-34`): `pull_request` with
  `types: [opened, synchronize, reopened, labeled, unlabeled]`. The `labeled`
  type is exactly how we implement "retry when `ai-cr:review` is added". Add
  `workflow_dispatch` per requirements.
- **Fork guard** (`:47`): `github.event.pull_request.head.repo.full_name == github.repository`
  — our chosen same-repo-only policy.
- **`concurrency`** (`:48-50`): `group: ai-code-review-${{ pr.number }}`,
  `cancel-in-progress: true` — supersede stale runs on rapid pushes.
- **Label-event guard idea** (`:80-102`): distinguish "real" content events from
  label toggles. We need a _narrower_ version: on a `labeled` event, run only if
  the added label is `ai-cr:review` (`github.event.label.name`). On
  `opened`/`synchronize`/`reopened`/`workflow_dispatch`, always run.
- **`fetch-depth: 0`** (`:60-63`): needed so `git diff origin/<base>...HEAD`
  resolves the merge-base.
- **Comment-cleanup marker pattern** (`:337`, `:386-398`, `:486-499`): embed a
  hidden marker (e.g. `<!-- ai-cr:marker -->`) in the bot comment, then on re-run
  delete the prior marked comment so they don't accumulate. Summary comments live
  under `/issues/:n/comments`.
- **Label-toggle re-eval** (`:216-222`, the `if: always()` verdict step): the
  conceptual model for "retry on label" — re-running on a label event and
  reconciling state.

**Drop (not needed because we never commit back):**

- The entire `claude-code-action` step (`:124-161`) and ANTHROPIC_API_KEY — our
  engine is the OpenRouter tsx agent.
- Skill-staging into `~/.claude/skills` (`:104-122`).
- `[skip ci]` recursion guard + "Validate Claude's commit" step (`:163-214`) —
  we push no commit, so no recursion risk.
- `contents: write` and `statuses: write` permissions (`:52-57`) — advisory
  pipeline needs only `pull-requests: write`.
- The REJECTED commit-status gate (`:216-301`) — we chose advisory; verdict drives
  a label, not a check failure.

### Area 4 — `m5l3-cicd.md` and requirements

`.claude/prompts/m5l3-cicd.md` is just the lesson's command skeleton (the
`/10x-research` and `/10x-plan` invocations) — it carries no CI patterns itself;
it delegates to this research + the requirements file. `requirements.md` is the
binding spec: every-PR trigger + `workflow_dispatch`, composite action, inputs
(PR title/body/diff), the 5 criteria (which match `schema.ts` exactly), parked
items (business alignment, architectural fit), side-effects (comment + `ai-cr:failed`
/`ai-cr:passed` labels), retry on `ai-cr:review`.

### Area 5 — Secrets & labels (current state)

- `OPENROUTER_API_KEY` is declared server-secret in `astro.config.mjs` and read in
  app code via `astro:env/server` (`src/lib/openrouter.ts`). It is **present locally
  in `.dev.vars`** but **not yet wired as a GitHub Actions secret** — a setup
  prerequisite for this change. The CI agent reads it from `process.env`, not
  `astro:env`, so a plain `env:` injection in the workflow suffices.
- **No label automation exists** in any current workflow (grep found none). The
  three labels (`ai-cr:passed` green, `ai-cr:failed` red, `ai-cr:review` for retry)
  must be created in the repo (via `gh label create` or auto-created on first
  `--add-label`). `gh pr edit --add-label` / `--remove-label` is the mechanism.

## Code References

- `packages/code-reviewer/review.ts:13-51` — stdin read, env check, JSON-to-stdout, exit codes
- `packages/code-reviewer/schema.ts:5-46` — `reviewSchema`; `verdict` enum at `:36-40`
- `package.json:25,32,44` — `@openrouter/ai-sdk-provider`, `ai`, `zod` (root deps)
- `package.json:5-16` — scripts (no `tsx` dep; `npx tsx` fetches it)
- `.github/workflows/ci.yml:1-26` — existing CI (do not modify)
- `astro.config.mjs:27-29` — `SUPABASE_URL`/`SUPABASE_KEY`/`OPENROUTER_API_KEY` server-secret schema
- `src/lib/openrouter.ts` — app reads `OPENROUTER_API_KEY` via `astro:env/server` (CI path differs: `process.env`)
- `.claude/skills/10x-impl-review-ci/references/workflow-template.yml:28-301` — GHA pattern donor (see Area 3 for line-level lift/drop)
- `.claude/skills/10x-impl-review-ci/SKILL.md:281-508` — inline/summary comment + cleanup-marker patterns
- `context/changes/ci-cd-code-review/requirements.md:1-54` — binding spec

## Architecture Insights

- **Engine/orchestrator split**: the agent stays a pure stdin→stdout function; the
  workflow owns all GitHub I/O (diff computation, comment, labels). This is what
  makes the same engine reusable for promptfoo evals later (per the prior stage's
  intent) — keep the workflow from leaking review logic into YAML.
- **Composite action boundary** (per requirements): put diff→agent→parse→comment→label
  in `.github/actions/ai-code-review/action.yml` (`using: composite`) so the workflow
  YAML stays declarative (triggers, guards, secret wiring). The action's steps are
  Bash + `npx tsx` + `gh`/`jq`.
- **Advisory, not gating**: verdict maps to a _label_, never an exit code. Workflow
  exits 0 even on `verdict=fail`. (Decision this session.) If a hard gate is ever
  wanted, it's an additive verdict-check step like the template's `:216-301`, not a
  rewrite.
- **Trigger economics**: requirements say _every_ PR → the LLM runs on every PR push
  (cost + an `OPENROUTER_API_KEY`-shaped dependency on each run). `concurrency:
cancel-in-progress` limits waste from rapid pushes. Large diffs may exceed the
  model's context — needs a guardrail (see Open Questions).

## Historical Context (from prior changes)

- `context/changes/ci-cd-code-review/requirements.md` — the spec authored this session.
- `packages/code-reviewer/` — built in the prior stage (`m5l2-agent`), no own change
  folder; this change is its first consumer.
- No archived CI/CD changes exist (`context/archive/**` searched — only wizard/data
  changes). This is the repo's **first** automation workflow beyond `ci.yml`.

## Related Research

None — this is the first research artifact under
`context/changes/ci-cd-code-review/`.

## Open Questions

1. **`tsx` provisioning**: `npx tsx` fetches `tsx` on every CI run (~one network
   install). Add `tsx` as a **devDependency** (pinned, reproducible, cache-friendly)
   vs. accept the per-run `npx` fetch? Recommend devDependency — it's a dev tool, not
   an app dependency, so it respects the "no new _app_ deps" constraint. **(plan to decide)**
2. **Diff size guardrail**: how to handle very large diffs that blow the model's
   context window — truncate, cap by file count, or skip with a neutral comment?
   The agent itself has no guard today.
3. **Label lifecycle on retry**: after an `ai-cr:review`-triggered re-run, remove
   `ai-cr:review` so it can be re-added to trigger again (mirror the template's
   label-toggle handling). Confirm in plan.
4. **Label pre-creation**: create the three `ai-cr:*` labels (with colors) as a
   setup step / one-off `gh label create`, or rely on `--add-label` auto-create
   (which won't set the red/green colors the requirements ask for)? Recommend a
   small idempotent "ensure labels" step.
5. **`workflow_dispatch` diff source**: on manual dispatch there's no PR context —
   decide whether dispatch targets a branch/PR number input, or just diffs the
   selected ref against `main` for a smoke test.
6. **Secret prerequisite**: `OPENROUTER_API_KEY` must be added as a GitHub Actions
   repo secret before the workflow can run (currently only in local `.dev.vars`).
