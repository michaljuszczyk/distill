<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Decisions List View + Read-Only Artifact Re-open

- **Plan**: context/changes/decisions-list-view/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-05-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success Criteria note: lint clean, 43/43 tests pass, build succeeds, and all changed files type-check clean. `astro check` reports 4 errors — all pre-existing, in untouched wizard API test files (`*.test.ts`, AI-SDK-v6 mock typing); none introduced by this change.

## Findings

### F1 — ArtifactView shipped as client:only, contradicting the plan's "static, no client:*" contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/decisions/[id].astro:38 (original)
- **Detail**: Phase 3 specified rendering `<ArtifactView />` static (no `client:*`) for zero-JS SSR / instant first paint (200 ms NFR). Implementation used `client:only="react"` because server-rendering React throws `jsxDEV is not a function` in dev. Deviation is documented in lessons.md and parked in roadmap.md, but the plan text overstated what was built.
- **Decision**: RESOLVED — Standardized on `client:only="react"` across all React-bearing pages (the project's established working pattern). Created `DecisionDetail.tsx` as a single React root (matching `WizardApp`) instead of two sibling islands; switched `auth/signin.astro` and `auth/signup.astro` from `client:load` → `client:only`. Root-cause SSR fix intentionally left parked in roadmap.md under `main_goal: speed`. Plan annotated via addendum.

### F2 — Supabase query errors swallowed; DB error renders as "empty" / 404

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/dashboard.astro:18-23, src/pages/decisions/[id].astro:14-15
- **Detail**: Both pages destructured only `{ data }` and ignored `{ error }`, so a genuine query failure rendered as the empty-list state / a 404 — masking a server error as "nothing here".
- **Decision**: FIXED — Both pages now capture `error`. Dashboard shows a distinct "Couldn't load your decisions" card; detail page returns 500 + "Couldn't load this decision" instead of a misleading 404.

### F3 — Wizard title uses inline first-line split instead of the exported firstNonEmptyLine helper

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/wizard/steps/ArtifactStep.tsx:196
- **Detail**: ArtifactStep derived the title with `description.split("\n")[0]?.trim()`, while the new pages use the exported `firstNonEmptyLine()`. The helper skips blank leading lines; the split doesn't — divergent titling for descriptions starting with a newline.
- **Decision**: FIXED — ArtifactStep now imports and uses `firstNonEmptyLine(state.data.description) || "Untitled"`.
