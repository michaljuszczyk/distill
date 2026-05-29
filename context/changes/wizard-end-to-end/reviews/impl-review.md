<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wizard End-to-End (S-02)

- **Plan**: context/changes/wizard-end-to-end/plan.md
- **Scope**: Phases 1-6 (all complete)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 6 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — withRetry helper is dead code; LLM endpoints lack retry

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: src/lib/llm-retry.ts (helper); src/pages/api/wizard/{socratic,alternatives,anti-bias,artifact}.ts (callers)
- **Detail**: Plan §"Implementation Approach" mandates exponential backoff 500/1500/4000 + jitter, max 3 attempts, retryable on 429/5xx/524/529, Retry-After honoured, 529→fallback model handle. Helper fully implemented but no endpoint imports it. Transient 429/5xx surface immediately as 500 `llm_unavailable`.
- **Fix A ⭐ Recommended**: Wire `withRetry` around each `streamObject` call site.
  - Strength: Realizes plan; aligns llm-retry.test.ts with prod path.
  - Tradeoff: ~4 small endpoint edits; verify streamObject errors flow through APICallError.
  - Confidence: HIGH — helper already typed against APICallError.
  - Blind spot: streamObject error surfacing semantics.
- **Fix B**: Delete helper + tests; document de-scope in plan.
  - Strength: Removes dead code; honest plan-as-built.
  - Tradeoff: Loses resilience plan promised.
  - Confidence: MEDIUM.
  - Blind spot: future operational gap.
- **Decision**: FIXED via Fix A (first-chunk gate): added `streamWithRetry` helper to `src/lib/llm-retry.ts`; refactored all 4 LLM endpoints to wrap `streamObject` in it. Tests pass (43/43); lint clean of new errors.

### F2 — Artifact endpoint missing beta header + healing fallback

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: src/pages/api/wizard/artifact.ts:34-50
- **Detail**: Plan §"Implementation Approach" + §"5.1a" call for `headers: { "anthropic-beta": "fine-grained-tool-streaming-2025-05-14" }` and optional `generateObject` + `response-healing` fallback on `schema_invalid`. Neither shipped. Plan-Progress 5.1 marks `[x]` "500 on schema_invalid after generateObject healing fallback fails" but the path doesn't exist.
- **Fix A ⭐ Recommended**: Drop beta header (Anthropic-only) + drop healing fallback as de-scope; update plan §5.1a.
  - Strength: Honest plan-as-built; model is DeepSeek so beta header was vestigial.
  - Tradeoff: No second-chance on schema_invalid.
  - Confidence: HIGH — current model non-Anthropic.
  - Blind spot: If model swap to Anthropic later, header + healing re-needed.
- **Fix B**: Implement headers + non-streaming `generateObject` fallback.
  - Strength: Honors plan; improves robustness.
  - Tradeoff: Non-trivial; OpenRouter+DeepSeek may not support response-healing plugin.
  - Confidence: LOW — plugin availability unverified.
  - Blind spot: plugin compat across providers.
- **Decision**: DE-SCOPED via Fix A: updated plan.md §5.1a with de-scope note + updated Progress 5.1 line. F8 (Progress 3.2) is subsumed.

### F3 — SocraticResponseSchema questions capped at 4, plan said 6

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/types.ts:50; cascade src/lib/prompts/socratic.ts:7
- **Detail**: Plan §"4. Wizard zod schemas" specified `questions.array().min(3).max(6)`. Code has `.max(4)`. Prompt line 7 follows: "Output 3 to 4 questions".
- **Fix**: Change `.max(4)` → `.max(6)` in `src/types.ts:50` and "3 to 4" → "3 to 6" in `src/lib/prompts/socratic.ts:7`. Or document tighter cap in plan.
- **Decision**: FIXED — schema bumped to `.max(6)`; prompt updated to "3 to 6 questions".

### F4 — decisions/new.astro uses `client:only` and skips inline auth guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/decisions/new.astro
- **Detail**: Plan §"Phase 2.1" specified `<WizardApp client:load />` and explicit `Astro.locals.user` redirect (redundant w/ middleware but explicit). Code uses `client:only="react"` and no inline guard. Middleware compensates for auth; `client:only` skips SSR placeholder.
- **Fix**: Switch directive to `client:load` and add explicit `Astro.locals.user` redirect at top of frontmatter — matches signin.astro:16 pattern.
- **Decision**: ACCEPTED-AS-DEVIATION — `client:only="react"` required because SSR build fails (WizardApp uses browser-only APIs at render). Inline guard redundant given middleware coverage. Documented in plan.md §Phase 2.1.

### F5 — MODEL_ID `deepseek/deepseek-v4-flash` may be invalid OpenRouter slug

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/openrouter.ts:5
- **Detail**: Plan §"Key Discoveries: Model id" explicitly required verifying slug against `GET https://openrouter.ai/api/v1/models` in Phase 1 — "DeepSeek's OpenRouter catalog does not document a `v4-flash` tier at writing time; if slug 404s, fall back to nearest documented DeepSeek slug." If slug 404s in prod, every wizard step returns 500.
- **Fix**: `curl https://openrouter.ai/api/v1/models | jq '.data[] | select(.id | contains("deepseek"))'`, replace MODEL_ID with verified slug, document in tech-stack.md.
- **Decision**: SKIPPED — user reports slug already verified manually.

### F6 — AntiBiasStep pick() race on technique switch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/wizard/steps/AntiBiasStep.tsx:138-151
- **Detail**: `pick(t)` mutates `lastSubmittedTechnique.current = t` and calls `submit(...)` without `stop()` first. If in-flight stream's `onFinish` resolves after ref flip, `ANTI_BIAS_LOADED` dispatches with OLD markdown paired with NEW technique label. Disabled-while-loading on non-selected cards reduces odds but selected card stays clickable.
- **Fix**: Call `stop()` before `submit()` in `pick()`; close ref via Map keyed by stream nonce, or capture technique into onFinish closure (not via ref).
- **Decision**: FIXED — added `stop()` to both `pick()` and `retry()` before `submit()` so any in-flight stream aborts cleanly (its `onFinish` won't fire). `lastSubmittedTechnique` now also set in `retry()` defensively. Tests pass (43/43).

### F7 — 6 new no-console lint warnings introduced

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/wizard/steps/ArtifactStep.tsx:215; src/pages/api/decisions/index.ts:46; src/pages/api/wizard/{alternatives:44,anti-bias:60,artifact:47,socratic:48}.ts
- **Detail**: Plan §"Phase 6.2" demanded "lint clean; no new warnings." `npm run lint` reports 6 `no-console` warnings on intentional server-side error logs.
- **Fix**: `// eslint-disable-next-line no-console` per line OR relax rule in eslint config for `src/pages/api/**` OR switch to structured logger.
- **Decision**: FIXED — added `apiConfig` block to `eslint.config.js` disabling `no-console` for `src/pages/api/**`; inline disable on ArtifactStep's clipboard-error log. Lint now clean (0 warnings).

### F8 — Progress 3.2 success criterion unchecked

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/wizard-end-to-end/plan.md:759
- **Detail**: Plan §Progress 3.2 "Schema parse failure on LLM output → 500 with `error.code = "schema_invalid"`" remains `- [ ]`. status=implemented suggests closed but item open. Subsumed by F2 (healing fallback never shipped).
- **Fix**: Ship schema_invalid catch path in socratic.ts (+ test), or mark item as de-scoped in plan.md.
- **Decision**: FIXED — Progress 3.2 marked `[~]` with de-scope rationale linking to Phase 5.1a.

### F9 — Clipboard / download failures are silent to user

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (UX)
- **Location**: src/components/wizard/steps/ArtifactStep.tsx:200-217
- **Detail**: `copy()` catches errors with `console.error` only. Safari private mode + permission-denied paths leave user with no feedback. Same risk on download.
- **Fix**: On catch, surface inline message "Couldn't copy — your browser blocked it" via ErrorBanner or small toast.
- **Decision**: FIXED — added `exportError` state + inline `<p role="status" aria-live="polite">` below Copy/Download buttons; covers both clipboard rejection and Blob/download failures. Tests pass (43/43); lint clean.
