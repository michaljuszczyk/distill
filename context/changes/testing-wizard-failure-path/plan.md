# Wizard Failure-Path & State Survival — Implementation Plan

## Overview

Land test-plan §3 **Phase 1 ("Wizard failure-path & state survival")** by turning
Risks #1, #2, and #7 into tests. Research (`research.md`) already ground each failure to
exact `file:line` seams. This plan establishes two test patterns new to the repo — a
component harness (per-step + seeded `WizardCtx` + mocked `useObject`) and a
provider-failure integration pattern (module-mock `getModel().doStream`) — and closes one
**live bug** found during research: `SocraticStep.retry()` is missing `stop()`, an unfixed
instance of the documented stream-race lesson.

## Current State Analysis

- **Test stack is configured and minimal.** Vitest `^4.1.7`, `happy-dom`, `globals: false`
  (tests import `vi`/`describe`/`it`/`expect` explicitly), setup `src/test/setup.ts`
  (`vitest.config.ts`). `@testing-library/react ^16.3.2` + `@testing-library/jest-dom ^6.9.1`
  installed; `@testing-library/user-event` is **not**. MSW `^2.14.6` is wired in `setup.ts`
  with an **empty** `setupServer()` and `onUnhandledRequest: "error"` — a guardrail, used by
  no current test.
- **7 tests today**, all happy-path-or-config: `reducer.test.ts` (4 reducer + `canAdvance`),
  `exporter.test.ts`, and five api-route tests that mock `@/lib/openrouter`'s `getModel` to
  return a `MockLanguageModelV3` streaming good chunks (`*.test.ts:42-57`). No component test
  exists anywhere under `src/components/`.
- **Risk #1 reducer happy-path is already proven** — `reducer.test.ts:16-34`
  (`"REQUEST_FAIL leaves data intact (FR-031)"`). The user-facing claim (typed text stays
  _rendered and editable_ after an error) is unproven.
- **Risk #2 server-side is structurally sound** — `llm-retry.ts` never returns a
  success-shaped value on failure (`:86`); `streamWithRetry` reads the first chunk before
  returning a `Response` (`:99-100`), so a connect/first-chunk failure becomes a JSON 500 in
  the route `catch`, never a deceptive 200. The provider-FAILURE path is simply untested.
- **Risk #7 has a live bug** — three steps comply with the `stop()`-before-`submit()`
  lesson; `SocraticStep.retry()` (`SocraticStep.tsx:68-72`) does not (`stop` is destructured
  at `:36`, never called).

## Desired End State

`npm run test` runs a suite that, in addition to today's tests:

1. Proves (component) that a step keeps previously-typed answers rendered with the error
   banner visible after a `REQUEST_FAIL`, and (unit) that `REQUEST_FAIL` preserves
   `description` and a multi-field `data`.
2. Proves (component) that a provider stream failure surfaces a visible error on `ArtifactStep`
   and commits/saves no fabricated artifact. (Re-scoped from the route during implementation —
   the route returns 200-empty on streamed provider errors; see the Phase 2 re-scope note.)
3. Proves (component) that a re-submit/re-pick on each of the four steps lands the reducer on
   the **fresh** request's data — a guard that currently **fails on SocraticStep** until its
   `stop()` is added.

Verify: `npm run test` green; the Risk #7 test demonstrably red without the SocraticStep
fix and green with it; `npm run lint` and `astro sync && tsc`/build clean.

### Key Discoveries:

- Sole error action `REQUEST_FAIL` preserves `data` (`reducer.ts:25-26`); **no reset/init
  action exists** — nothing can wipe `data` on error.
- Uniform error contract: every step dispatches only `REQUEST_FAIL` on failure
  (`SocraticStep.tsx:41,54`, `AlternativesStep.tsx:32,40`, `AntiBiasStep.tsx:122,134`,
  `ArtifactStep.tsx:89,102`) — one component test generalizes.
- Steps consume state via `useWizard()` (`context.ts:11-15`); a test seeds state with
  `<WizardCtx.Provider value={{ state, dispatch }}>`. When `stored` is set, SocraticStep's
  init effect early-returns (`SocraticStep.tsx:60`) — no submit/fetch fires at mount.
- Mock seam (component): `vi.mock("@ai-sdk/react")` exposing
  `experimental_useObject` (the steps' import, `SocraticStep.tsx:3`).
- Mock seam (api route): `vi.mock("@/lib/openrouter")` returning
  `getModel: () => new MockLanguageModelV3({ doStream })` from `ai/test` — the established
  pattern; reject `doStream` to force failure (`artifact.test.ts:42-57`).
- Error→HTTP translation lives in `artifact.ts:54-62` (mirrored across routes); `503` is
  retryable, `400` maps to `NonRetryableError` with echoed `status` (`llm-retry.ts:4-5,71-76`).
- Race defense is **ordering-only** — `*_LOADED` cases overwrite `data` unconditionally
  (`reducer.ts:28,52,66,77`); the test must assert _resulting state_, not spy on call order
  (test-plan §2 anti-pattern, `test-plan.md:71`).

## What We're NOT Doing

- **No CI wiring.** Adding `npm run test` to `.github/workflows/ci.yml` (test-plan §5) is
  deferred to a follow-up change per decision. Tests run locally via `npm run test` only.
- **No e2e / Playwright** — out of scope per test-plan §7 (PRD §Non-Goals).
- **No new test dependencies** — `@testing-library/user-event` is not added; the survival
  test seeds state and asserts rendered value (no live typing needed); `fireEvent` from RTL
  covers any interaction.
- **No assertions against the LLM's output content or Supabase RLS** — our side of the
  boundary only (test-plan §1, §7).
- **No MSW request handlers** — the empty `setupServer()` stays a guardrail; our seams make
  no real fetch.
- **No refactor of `llm-retry` / routes / steps** beyond the single one-line `stop()`
  addition to `SocraticStep.retry()`.
- **No server-side hardening of the silent-200** — implementation found the artifact route
  returns 200-empty on streamed provider errors (`streamObject` swallows them into `onError`);
  surfacing those as a visible server error is a route behavior change deferred to its own
  change (recorded in `lessons.md`). Phase 2 tests Risk #2 at the client, where the guarantee
  actually lives.

## Implementation Approach

Three phases, ordered so Phase 1 builds the component harness that Phase 3 reuses; Phase 2 is
independent and can land in any order relative to the others. Each phase carries a limited
happy-path anchor (per test-plan §3) where one doesn't already exist. Tests follow the
existing style: explicit vitest imports (`globals: false`), co-located `*.test.ts(x)` next to
the unit under test, mocks declared before the dynamic `import()` of the module under test.

## Critical Implementation Details

- **State sequencing (Risk #7 mock).** The `experimental_useObject` test double must capture
  the `onFinish` callback passed by the step and expose manual `submit`/`stop`/`fire-onFinish`
  controls. `stop()` must mark the in-flight invocation aborted so a subsequently-fired stale
  `onFinish` is suppressed — this faithfully models the AI SDK contract and is the _only_
  reason a compliant handler is safe. A handler that calls `submit()` without a preceding
  `stop()` therefore lets the stale `onFinish` dispatch win, which the final-state assertion
  catches. Drive resolution by invoking the captured callbacks directly — never
  `waitForTimeout` (test-plan §2 / lessons).
- **Mount lifecycle (Risk #1).** Seed `state.data.socratic1 = { questions, answers }` and
  `state.step = "socratic-1"` so `stored` is truthy and the init effect early-returns
  (`SocraticStep.tsx:60`); set `state.error` to a `REQUEST_FAIL`-shaped value so the banner
  renders. This isolates the survival assertion from any streaming.

## Phase 1: Risk #1 — State survival on step failure

### Overview

Establish the component test harness and prove typed answers survive an error, both at the
reducer (incremental) and component (the real gap) layers.

### Changes Required:

#### 1. Component test harness + survival test

**File**: `src/components/wizard/steps/SocraticStep.test.tsx` (new)

**Intent**: Prove the user-facing FR-031 claim — after a `REQUEST_FAIL`, a step still shows
the user's previously-typed answers and surfaces the error banner. Doubles as the reusable
harness pattern (seeded `WizardCtx` + mocked `useObject`) that Phase 3 builds on.

**Contract**: Render `<SocraticStep />` inside `<WizardCtx.Provider value={{ state, dispatch }}>`
with `state.step="socratic-1"`, `state.data.socratic1={ questions:["Q1"], answers:["my typed answer"] }`,
`state.error={ kind:"network", message:"…" }`. Mock `@ai-sdk/react`'s `experimental_useObject`
to return an idle shape (`{ object: undefined, submit, isLoading: false, error: undefined, stop }`).
Assert: the answer textarea has value `"my typed answer"` (via `getByRole("textbox")` / by its
`Label`), and the error banner is present (`getByRole`/`getByText` against `ErrorBanner` copy,
`aria-live="polite"`). Explicit vitest imports; no `user-event`.

#### 2. Incremental reducer assertions

**File**: `src/components/wizard/reducer.test.ts` (extend)

**Intent**: Harden the existing FR-031 proof beyond the single socratic-answers case —
`REQUEST_FAIL` must also preserve `data.description` and a richer multi-field `data`.

**Contract**: Add `it(...)` case(s) seeding a state with `description`, `socratic1`,
`alternatives`, and `antiBiasOutput`, dispatch `REQUEST_FAIL`, assert `next.data` is
referentially unchanged and each field intact, `pending===false`, `error` set. Match the
existing file's import/style (`reducer.test.ts:1-3`).

### Success Criteria:

#### Automated Verification:

- New component test passes: `npm run test`
- Extended reducer test passes: `npm run test`
- Type check / sync passes: `npx astro sync && npx tsc --noEmit` (or `npm run build`)
- Lint passes: `npm run lint`

#### Manual Verification:

- The survival test fails as expected if the assertion is inverted (sanity that it's real).
- Banner copy asserted matches what a user actually sees in `npm run dev`.

**Implementation Note**: After automated verification passes, pause for human confirmation of
the manual checks before Phase 2.

---

## Phase 2: Risk #2 — Provider-failure handling (client layer)

> **Re-scoped during implementation (user-approved).** The plan originally asserted a
> provider failure → JSON `500` at the artifact route. Implementation + AI SDK v6 docs proved
> this false: `streamObject` delivers stream errors to its `onError` callback (which the route
> only logs) and **closes `textStream` cleanly**, so `streamWithRetry`'s first read gets
> `{done:true}` and the route returns **HTTP 200 with an empty body**. The route's `catch`
> (NonRetryableError → 500) + retry are unreachable for _streamed_ provider errors — they only
> catch _pre-stream_ throws (the `getModel`/config case, already tested). The Risk #2 guarantee
> ("visible error, no fabricated artifact") therefore lives on the **client**: an empty/invalid
> stream makes `ArtifactStep`'s `onFinish` hit a schema error → `REQUEST_FAIL` → visible banner,
> with no `ARTIFACT_LOADED`/save. We test it there. The silent-200 is captured as a lesson.

### Overview

Prove the client surfaces a provider stream failure as a visible error and commits/saves no
fabricated artifact. Keep the existing server-side config-error → 500 test as the route anchor.

### Changes Required:

#### 1. Client provider-failure tests on ArtifactStep

**File**: `src/components/wizard/steps/ArtifactStep.test.tsx` (new)

**Intent**: Assert Risk #2 where the guarantee actually lives — on a provider stream failure
the user sees a visible error and no fabricated artifact is presented, committed, or saved.

**Contract**: Mock `@ai-sdk/react`'s `experimental_useObject` (per Phase 1 harness) with a
`vi.hoisted` holder that (a) exposes a settable `error` to drive the hook's error state and
(b) captures the registered `onFinish`/`onError`. Test A: hook `error` set + `state.error: null`
→ assert the llm-kind `ErrorBanner` copy is visible and no "Saved" UI renders. Test B: seed
full wizard data so the step submits on mount (asserting `REQUEST_START` dispatched), then fire
the captured `onFinish({ object, error: <schemaError> })` → assert dispatched actions contain
`REQUEST_FAIL`, never `ARTIFACT_LOADED`, never `SAVED`, and `globalThis.fetch` (the save call)
was not invoked.

#### 2. Server route anchor (unchanged)

**File**: `src/pages/api/wizard/artifact.test.ts`

**Intent**: No change — the existing happy-200 and config-error → 500 cases remain the route
anchors. The route's only reachable error-translation path (getModel throwing
`OpenRouterUnconfiguredError`) is already covered; no server failure-stream test is added
because the route cannot produce one (see the re-scope note).

### Success Criteria:

#### Automated Verification:

- Client provider-failure tests pass: `npm run test`
- Existing route tests still pass (happy-200 + config-500 anchors): `npm run test`
- Lint + type check pass: `npm run lint`, `npm run typecheck`

#### Manual Verification:

- Confirm the asserted banner copy (`"The AI service is having trouble. Try again?"`, llm-kind)
  matches what a user sees when an artifact generation fails in `npm run dev`.

**Implementation Note**: The silent-200 finding is recorded in `context/foundation/lessons.md`.
A server-side hardening (surface streamed provider errors instead of 200-empty) is explicitly
deferred — it is a route behavior change needing its own change/plan. After automated
verification, pause for human confirmation.

---

## Phase 3: Risk #7 — Stream-race regression + live SocraticStep fix

### Overview

Reuse the Phase 1 harness to prove the stream-race is closed on all four steps; the test is
red on SocraticStep until its missing `stop()` is added (test-first).

### Changes Required:

#### 1. Stream-race component test

**File**: `src/components/wizard/steps/streamRace.test.tsx` (new; or per-step `*.test.tsx`)

**Intent**: Prove that a re-submit/re-pick on a step lands the reducer on the **fresh**
request's data, never a stale `onFinish`'s — across AntiBias, Alternatives, Artifact, and
Socratic.

**Contract**: Mock `@ai-sdk/react`'s `experimental_useObject` with a controllable double that
captures the step's `onFinish` and exposes `submit`/`stop` plus a test-side `fireOnFinish(data)`;
`stop()` marks the current invocation aborted so a later `fireOnFinish` for it is a no-op.
For each step: render with seeded `WizardCtx`, trigger the retry/re-pick handler (which should
call `stop()` then `submit()`), then fire the **stale** stream's `onFinish` followed by the
**fresh** one (stale-resolves-after-fresh ordering), and assert the reducer's resulting
`state.data` (via a spy on `dispatch` or a real reducer-backed provider) carries the fresh
payload. AntiBiasStep additionally asserts technique↔markdown pairing
(`lastSubmittedTechnique`, `AntiBiasStep.tsx:143`). Drive purely by invoking callbacks — no
timers. Expect **SocraticStep to fail** before change #2.

#### 2. Fix SocraticStep.retry() — add the missing stop()

**File**: `src/components/wizard/steps/SocraticStep.tsx`

**Intent**: Abort the in-flight stream before re-submitting, per the `lessons.md` rule, so a
stale `onFinish` cannot overwrite the fresh request — the change that turns the Phase 3 test
green for Socratic.

**Contract**: In `retry()` (`SocraticStep.tsx:68-72`), call `stop()` as the **first**
statement, before the `submittedFor.current = null` reset / `REQUEST_START` / `submit()`.
`stop` is already destructured at `:36`. One-line addition; matches the pattern in
`AntiBiasStep.retry()`/`AlternativesStep.retry()`/`ArtifactStep.retryStream()`.

#### 3. Lessons addendum (optional, recommended)

**File**: `context/foundation/lessons.md`

**Intent**: Record that the "Abort the prior stream before re-submitting" rule had a third,
later-found instance (SocraticStep), closing the enumeration so a future reader knows all
step handlers are now covered.

**Contract**: Append a one-line note under the existing entry (append-only — do not rewrite
prior text). Per project convention, prefer `/10x-lesson` to add it.

### Success Criteria:

#### Automated Verification:

- Race test is red on SocraticStep **before** change #2 (capture/confirm), green **after**: `npm run test`
- All four steps pass the race assertion after the fix: `npm run test`
- Lint + type check pass: `npm run lint`, `npm run build`

#### Manual Verification:

- In `npm run dev`, exercise SocraticStep retry and confirm no stale-question flash
  (the user-visible symptom of the race).
- Confirm the other three steps still behave correctly (no regression from the shared harness).

**Implementation Note**: Write change #1 first and observe the SocraticStep failure before
applying change #2 — the red→green transition IS the proof the test catches the bug. After
automated verification, pause for human confirmation.

---

## Testing Strategy

### Unit Tests:

- Reducer `REQUEST_FAIL` preserves `description` + multi-field `data` (Phase 1).

### Integration Tests:

- `artifact.ts` POST: provider 503 → `500 code:"llm"` (no artifact body); provider 400 →
  `500 code:"llm"` with echoed `status` (Phase 2).

### Component Tests:

- SocraticStep keeps typed answers + shows banner on `REQUEST_FAIL` (Phase 1).
- All four steps: retry/re-pick lands reducer on fresh data; stale `onFinish` suppressed
  (Phase 3).

### Manual Testing Steps:

1. `npm run dev`; in the wizard, type Socratic answers, force a later-step failure, confirm
   answers remain and the banner shows.
2. Trigger SocraticStep retry rapidly; confirm no stale question/answer flash after the fix.
3. Temporarily break OpenRouter config / force a 5xx and confirm a visible error (no silent
   wait, no fabricated artifact).

## Performance Considerations

The only runtime concern is test-suite speed: Phase 2's retryable case must not incur real
`withRetry` backoff (multiple seconds). Use fake timers or lean on the immediate
non-retryable case; the suite must stay fast.

## Migration Notes

None — additive tests plus a one-line source fix. No schema, data, or API contract changes.

## References

- Research: `context/changes/testing-wizard-failure-path/research.md`
- Test strategy: `context/foundation/test-plan.md` (§3 Phase 1, §4 stack, §6 cookbook)
- Lesson: `context/foundation/lessons.md` — "Abort the prior stream before re-submitting"
- Reference test (style/mocks): `src/pages/api/wizard/artifact.test.ts:42-132`,
  `src/components/wizard/reducer.test.ts:1-34`
- Error translation: `src/pages/api/wizard/artifact.ts:54-62`; retry classification:
  `src/lib/llm-retry.ts:1-87`
- Live bug: `src/components/wizard/steps/SocraticStep.tsx:36,68-72`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #1 — State survival on step failure

#### Automated

- [x] 1.1 New component test passes (`npm run test`) — 19c1eba
- [x] 1.2 Extended reducer test passes (`npm run test`) — 19c1eba
- [x] 1.3 Type check / sync passes (`npx astro sync && npx tsc --noEmit`) — 19c1eba
- [x] 1.4 Lint passes (`npm run lint`) — 19c1eba

#### Manual

- [x] 1.5 Survival test fails when assertion inverted (sanity) — 19c1eba
- [x] 1.6 Asserted banner copy matches `npm run dev` — 19c1eba

### Phase 2: Risk #2 — Provider-failure handling (client layer)

#### Automated

- [x] 2.1 Client provider-failure tests pass (`npm run test`) — 240b42d
- [x] 2.2 Existing route tests still pass (happy-200 + config-500 anchors) — 240b42d
- [x] 2.3 Lint + type check pass — 240b42d

#### Manual

- [x] 2.4 Banner copy matches `npm run dev` (llm-kind on artifact failure) — 240b42d

### Phase 3: Risk #7 — Stream-race regression + live SocraticStep fix

#### Automated

- [x] 3.1 Race test red on SocraticStep before fix, green after (`npm run test`)
- [x] 3.2 All four steps pass the race assertion after the fix
- [x] 3.3 Lint + type check pass

#### Manual

- [x] 3.4 `npm run dev`: SocraticStep retry shows no stale flash
- [x] 3.5 Other three steps regression-free
