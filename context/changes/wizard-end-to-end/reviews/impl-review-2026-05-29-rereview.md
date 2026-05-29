<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Wizard End-to-End (S-02) — re-review

- **Plan**: context/changes/wizard-end-to-end/plan.md
- **Scope**: Phases 1-6 (all complete)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION (borderline — all findings low-impact polish)
- **Findings**: 0 critical · 2 warnings · 3 observations
- **Note**: Re-review after the first impl-review (`impl-review.md`) and its fix commit `de68390`. All prior findings F1–F9 confirmed fixed/de-scoped in code.

## Verdicts

| Dimension           | Verdict                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Plan Adherence      | WARNING                                                                                               |
| Scope Discipline    | WARNING                                                                                               |
| Safety & Quality    | WARNING                                                                                               |
| Architecture        | PASS                                                                                                  |
| Pattern Consistency | WARNING                                                                                               |
| Success Criteria    | WARNING (not re-run locally — node_modules absent; git evidence: 43/43 tests + lint clean at de68390) |

## Findings

### F1 — Retry handlers omit stop() before re-submit (F6 fix not propagated)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Safety & Quality (reliability)
- **Location**: src/components/wizard/steps/AlternativesStep.tsx:54; src/components/wizard/steps/ArtifactStep.tsx:182
- **Detail**: Prior F6 fixed a same-class race in AntiBiasStep by calling stop() before submit(). AlternativesStep.retry() and ArtifactStep.retryStream() called submit() directly — overlapping streams possible on retry, later onFinish wins. Risk lower than F6 (retries are error-gated).
- **Fix**: Call stop() as the first statement of both handlers, mirroring AntiBiasStep.
- **Decision**: FIXED — added stop() to AlternativesStep.retry() and ArtifactStep.retryStream().

### F2 — Retryable status set excludes 504

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Safety & Quality (reliability)
- **Location**: src/lib/llm-retry.ts:2
- **Detail**: RETRYABLE_STATUS = {429,500,502,503,524,529}. Plan said "retryable on 429/5xx/524/529". 504 Gateway Timeout (common transient upstream error) was not retried.
- **Fix**: Add 504 to RETRYABLE_STATUS; comment that 501/505 are deliberately excluded.
- **Decision**: FIXED — 504 added; intent comment added.

### F3 — Dead response-healing branch after F2 de-scope

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/openrouter.ts (getModel healing opt + plugin branch)
- **Detail**: Prior review de-scoped response-healing, but getModel() still carried a `healing` opt and a `plugins: [{ id: "response-healing" }]` branch no caller exercised — unreachable dead code.
- **Fix**: Remove the healing opt + plugin branch (keep allowFallbacks for the 529 path).
- **Decision**: FIXED — healing opt + branch removed; allowFallbacks retained.

### F4 — User description interpolated verbatim into prompts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security)
- **Location**: src/lib/prompts/\*.ts (all user() builders)
- **Detail**: `description` interpolated raw; NewDecisionInputSchema.description has no .max(). Accepted risk for a single-tenant authenticated wizard (user can only steer own output). Matters if multi-tenant or output feeds downstream automation.
- **Fix**: None required now. Optionally add .max() + accepted-risk comment.
- **Decision**: SKIPPED — accepted risk under current single-tenant threat model.

### F5 — Payload builders duplicated across 3 step components

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AlternativesStep.tsx:12; AntiBiasStep.tsx:31; ArtifactStep.tsx:19
- **Detail**: toSocraticPayload / alternativesForPayload copy-pasted across three steps. Not a bug; a maintenance surface. Plan did not ask for a shared helper.
- **Fix**: Optionally extract to src/lib/wizard/payloads.ts and import.
- **Decision**: SKIPPED — within plan scope; not worth churn now.
