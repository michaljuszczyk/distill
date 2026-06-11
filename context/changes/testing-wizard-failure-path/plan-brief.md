# Wizard Failure-Path & State Survival — Plan Brief

> Full plan: `context/changes/testing-wizard-failure-path/plan.md`
> Research: `context/changes/testing-wizard-failure-path/research.md`

## What & Why

Land test-plan §3 **Phase 1** — turn the three highest wizard risks (mid-flow state loss,
unhandled LLM provider errors, stream retry-race) into automated tests. The product currently
has only happy-path/config tests; the bad scenarios users actually hit are unguarded.

## Starting Point

Vitest is configured (`happy-dom`, `globals: false`, MSW guardrail wired but unused) with 7
tests today — reducer happy-paths and five api-route tests that mock `getModel` for the 200
case. No component test exists. Research ground every Phase-1 failure to exact seams and found
a **live bug**: `SocraticStep.retry()` is missing the `stop()` call the documented lesson
requires (the other three steps comply).

## Desired End State

`npm run test` additionally proves: (1) a step keeps typed answers rendered with an error
banner after a failure; (2) a provider failure on the artifact route returns a visible JSON
500 with no fabricated artifact; (3) a re-submit/re-pick on every step lands on the fresh
request's data — a guard that fails on SocraticStep until its one-line `stop()` is added.

## Key Decisions Made

| Decision              | Choice                                         | Why (1 sentence)                                                     | Source |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------- | ------ |
| SocraticStep live bug | Fix in scope, test-first                       | Close the recurring race where it was found, with a regression guard | Plan   |
| CI wiring (`ci.yml`)  | Deferred to follow-up                          | Keep this change test-focused; smaller diff, no pipeline risk now    | Plan   |
| Risk #2 failure cases | Retryable (503) + non-retryable (400)          | Exercises both branches of `llm-retry` classification at the route   | Plan   |
| Component mount       | Per-step + seeded `WizardCtx`                  | Lightest harness; uniform error contract means one step generalizes  | Plan   |
| Race test seam        | Mock `experimental_useObject`                  | Fully deterministic control of `onFinish`/`stop`; no timers/network  | Plan   |
| Risk #1 breadth       | Component (SocraticStep) + incremental reducer | Fills the real gap and hardens the reducer beyond the single case    | Plan   |
| Risk #2 layer         | Api route only (no client render)              | Keeps Risk #2 scoped; client banner covered incidentally by #1/#7    | Plan   |

## Scope

**In scope:** SocraticStep survival component test; incremental `REQUEST_FAIL` reducer
assertions; artifact-route provider-failure integration tests (503 + 400); four-step
stream-race component test; one-line `SocraticStep.retry()` `stop()` fix; lessons addendum.

**Out of scope:** CI wiring, e2e/Playwright, new test deps (`user-event`), MSW handlers,
LLM-output/RLS assertions, client-render layer for Risk #2, any refactor beyond the one-line fix.

## Architecture / Approach

Two new test patterns: a **component harness** (render a step inside `<WizardCtx.Provider>`
with seeded state; mock `@ai-sdk/react`'s `experimental_useObject`) and a **provider-failure
integration pattern** (extend the existing `vi.mock("@/lib/openrouter")` to reject
`doStream`). Phase 1 builds the harness via the Risk #1 survival test; Phase 3 reuses it for
the race test; Phase 2 is independent. The race defense is ordering-only (`stop()` before
`submit()`), so tests assert _resulting reducer state_, never call-order spies.

## Phases at a Glance

| Phase                       | What it delivers                                       | Key risk                                                        |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| 1. Risk #1 state survival   | Component harness + survival test + reducer assertions | Getting the seeded-state/mock-`useObject` harness shape right   |
| 2. Risk #2 provider-failure | Artifact-route 503 + 400 failure tests                 | Avoiding real retry backoff inflating suite runtime             |
| 3. Risk #7 race + fix       | Four-step race test; SocraticStep `stop()` fix         | Faithfully modelling `stop()`-suppresses-`onFinish` in the mock |

**Prerequisites:** None — stack installed and research complete.
**Estimated effort:** ~1-2 sessions across 3 phases.

## Open Risks & Assumptions

- The `experimental_useObject` mock must mirror the AI SDK's `stop()`-aborts-`onFinish`
  contract; verify the hook's return shape against `@ai-sdk/react ^3` at impl time.
- Phase 2 must neutralize `withRetry` backoff (fake timers or lean on the immediate
  non-retryable case) so the suite stays fast.
- Tests run locally only until the deferred CI-wiring follow-up lands.

## Success Criteria (Summary)

- A user's typed wizard answers provably survive a later-step failure, with a visible error.
- A provider failure provably surfaces as a visible error and never a fabricated artifact.
- The stream-race is provably closed on all four steps — and the test demonstrably catches
  the SocraticStep regression (red→green on the fix).
