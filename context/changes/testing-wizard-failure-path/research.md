---
date: 2026-06-11T10:53:47+0200
researcher: Michal Juszczyk
git_commit: 32c992e58e76bdc2e57a1d4c853bb34b71c96142
branch: main
repository: distill
topic: "Wizard failure-path & state survival — grounding test-plan Phase 1 (Risks #1, #2, #7)"
tags: [research, codebase, wizard, reducer, llm-retry, stream-race, testing]
status: complete
last_updated: 2026-06-11
last_updated_by: Michal Juszczyk
---

# Research: Wizard failure-path & state survival (test-plan Phase 1)

**Date**: 2026-06-11T10:53:47+0200
**Researcher**: Michal Juszczyk
**Git Commit**: 32c992e58e76bdc2e57a1d4c853bb34b71c96142
**Branch**: main
**Repository**: distill

## Research Question

Ground test-plan §3 **Phase 1 — "Wizard failure-path & state survival"** in the live
codebase. Per `test-plan.md` §1 principle #3, the risk map does not claim where a
failure lives — research is the ground truth. Locate, with `file:line` precision, where
each Phase-1 risk lives so the cheapest test that gives real signal can be written:

- **Risk #1** — Mid-wizard step failure wipes prior typed answers (no in-memory recovery). → unit (reducer) + component.
- **Risk #2** — LLM provider error not handled as designed (fabricated/partial artifact, or silent success, instead of a visible error). → integration (api route, mocked provider failure).
- **Risk #7** — Stream retry race: a stale `onFinish` overwrites the new request's data after a re-submit/re-pick. → component/integration.

Scope boundary (test-plan §1, §7): we test **our side** of the boundary only — never
Supabase RLS, magic-link delivery, or the LLM's output content.

## Summary

- **Risk #1 (state survival): already protected at the reducer; the gap is the component proof.** The only error action is `REQUEST_FAIL`, which touches only `pending`/`error` and passes `data` through untouched (`reducer.ts:25-26`). There is **no reset/init action at all** — nothing can fire to wipe `data` on error. Both typed fields (`description`, socratic `answers[]`) commit to state on **every keystroke**, so real data is always present at the moment of failure. The reducer unit test _already_ proves the happy path (`reducer.test.ts:16`, "REQUEST_FAIL leaves data intact (FR-031)"). The genuine gap: **no component/RTL test exists** to prove the user-facing claim — that prior typed text stays rendered and editable after an error.

- **Risk #2 (provider errors): no silent-success or fabricated-artifact path found; the gap is a provider-FAILURE integration test.** `llm-retry.ts` never returns a success-shaped value on failure — every terminal path throws (`:86`). `streamWithRetry` eagerly reads the first chunk **before** returning a `Response` (`:99-100`), so a connect/first-chunk provider failure becomes a JSON `500 {error:"llm_unavailable", code:"llm"}` in the route `catch`, never a 200 stream. On the client, a malformed object (schema error in `onFinish`) dispatches `REQUEST_FAIL` and returns **before** any `*_LOADED` commit — never persisted/saved. Existing api tests cover only happy-path 200 and config-missing 500; **the provider-failure path (503 retryable / 400 non-retryable / mid-stream abort) is untested.**

- **Risk #7 (stream race): LIVE BUG FOUND, not just a test gap.** The entire defense against the race is the `stop()`-before-`submit()` ordering (`lessons.md` "Abort the prior stream before re-submitting"). Three steps comply (AntiBias, Alternatives, Artifact — F1/F6 fixes verified present). **`SocraticStep.retry()` (`SocraticStep.tsx:68-72`) does NOT call `stop()`** — `stop` is destructured at `:36` but the handler only resets a ref, dispatches `REQUEST_START`, and re-`submit()`s. The lesson enumerates only the other three steps; SocraticStep was missed. A Risk #7 regression test written across all four steps would **correctly fail on SocraticStep today.**

## Detailed Findings

### Risk #1 — State survival on step failure (unit + component)

**Reducer / state shape** — `src/components/wizard/types.ts:35-40` (`WizardState = { step, data, pending, error }`), `:21-33` (`WizardData`). Typed user answers live in `data.description` (string) and `data.socratic1/2.answers[]`. All actions enumerated at `types.ts:42-54`.

**Error path** — the sole error action is `REQUEST_FAIL` (`reducer.ts:25-26`):

```
case "REQUEST_FAIL":
  return { ...state, pending: false, error: action.error };
```

Only `pending`/`error` change; `data` passes through by reference. **No reset/init action exists** — `initialState` (`reducer.ts:3-8`) is consumed once by `useReducer` (`WizardApp.tsx:44`); no action returns it. The only state-narrowing action, `PICK_TECHNIQUE` (`reducer.ts:55-64`), clears `antiBiasOutput`/`acknowledgedAt` on a deliberate technique change — never on error, never touches description/socratic answers. `SOCRATIC_LOADED` is even preservation-aware: re-load reuses `prior?.answers` (`reducer.ts:30-31`).

**Verdict:** typed answers survive an error dispatch — definitively. No surprise wipe.

**Commit timing** — `description` commits on every keystroke via `SET_DESCRIPTION` (`DescribeStep.tsx:29-32`); each socratic answer commits on every keystroke via `SOCRATIC_ANSWER` (`SocraticStep.tsx:104-109` → reducer `:43-50`). So real data is always in state when a later step fails.

**Render-on-error** — `WizardApp.tsx:43-59` is purely state-driven: on error `state.step` is unchanged, so the same step component stays mounted with its data; `<ErrorBanner error={state.error} />` (`:53`) renders additively. `ErrorBanner.tsx:21-40` returns `null` with no error, else an `aria-live="polite"` red banner + optional Retry (`:32-37`).

**Uniform error contract (one test generalizes):** every generation step dispatches **only** `REQUEST_FAIL` on failure — `SocraticStep.tsx:41,54`, `AlternativesStep.tsx:32,40`, `AntiBiasStep.tsx:122,134`, `ArtifactStep.tsx:89,102`.

**Existing coverage / gap** — `reducer.test.ts` (vitest) already has `"REQUEST_FAIL leaves data intact (FR-031)"` (`:16-34`): seeds socratic answers + `pending:true`, dispatches `REQUEST_FAIL`, asserts `pending===false`, error set, `next.data === seeded.data` (referential, `:32`), `answers[0]==="a1"` (`:33`). **Gaps:** (a) incremental unit — `REQUEST_FAIL` also preserving `data.description` and a richer multi-field `data`; (b) **the real gap — a component/RTL test** proving prior typed text stays rendered + editable after an error, with the banner + Retry visible.

### Risk #2 — LLM provider error handling (integration)

**`llm-retry.ts`** — `withRetry` (`:56-87`), default `maxAttempts=3`, backoff `[500,1500,4000]` w/ jitter (`:1,:33-35`) or `Retry-After` (`:81`). Classification: `NonRetryableError` rethrown (`:68`); status in `{400,401,402,403,404,422}` → wrapped `NonRetryableError` (`:71-73`); unknown status rethrown raw (`:74-76`); `{429,500,502,503,504,524,529}` retried, `529`→fallback (`:79`); exhausted → `throw lastErr` (`:86`). **No silent-success path — every terminal path throws.** `streamWithRetry` (`:93-129`) eagerly reads the first chunk inside the retry body (`:99-100`) — connect/first-chunk failure throws _before_ a `Response` is built → propagates to route `catch`. Mid-stream abort after the first chunk is surfaced via `controller.error(err)` (`:117-118`) — body errors mid-flight (status already 200); handled, not silently truncated.

**API routes** — structurally identical: artifact `:17-63`, socratic `:17-64`, alternatives `:17-60`, anti-bias `:30-76`. All set `prerender = false`. Guard order: auth→`401`; `request.json()`→`400 invalid_json`; zod `safeParse`→`400 invalid_input` (socratic adds `422 round_cap_exceeded`). Provider call wraps `streamObject` in `streamWithRetry`; `onError` only `console.error`s (`artifact.ts:49-51`). `catch` translation (`artifact.ts:54-62`): `OpenRouterUnconfiguredError`→`500 code:"config"`; `NonRetryableError`→`500 {error:"llm_unavailable", code:"llm", status}`; else→`500 {error:"llm_unavailable", code:"llm"}`. **No empty/partial-object-as-200 path.** Exemplar for the integration test: **`artifact.ts`** (highest stakes; behavior identical across routes).

**Mock seam** — `src/lib/openrouter.ts`: `getModel` (`:26-31`) → `getOpenRouter()` (`:16-20`, throws `OpenRouterUnconfiguredError` if key missing), model `deepseek/deepseek-v4-flash` (`:5`). Cleanest seam (matches existing tests): `vi.mock("@/lib/openrouter")` returning `getModel: () => new MockLanguageModelV3({ doStream })` from `ai/test`. Force failure with `doStream: () => Promise.reject(Object.assign(new Error("upstream"), { statusCode: 503 }))` (retryable → `500 code:"llm"`), and a second case `statusCode: 400` (→ `NonRetryableError`, `status` echoed).

**Client render-on-error** — `useObject.onError` (transport/non-200/mid-stream) → `REQUEST_FAIL {kind:"network"}` (Socratic `:53-55`, Alternatives `:39-41`, Artifact `:101-103`). `onFinish` schema-error branch (malformed object) → `REQUEST_FAIL {kind:"llm"}` and **returns before any loaded dispatch** (Socratic `:39-43`, Alternatives `:30-34`, Artifact `:87-91`) — malformed object never committed. ⚠️ **Partial-display nuance (ArtifactStep):** during streaming it renders the live partial object (`:137-201`); on error the partial **stays on screen under the banner** — but `ARTIFACT_LOADED` + auto-save fire **only** in `onFinish` with non-null `final` and no `schemaError` (`:92-100`); save is gated on the committed artifact, never on `partial`. So **no fabricated artifact is persisted/saved** on error; the test assertion should be "error visible AND no committed/saved artifact," tolerating that streamed partial text may remain rendered.

**Existing coverage / gap** — `*.test.ts` style: top-level `vi.mock("astro:env/server")` + `vi.mock("@/lib/openrouter")` with `doStream` resolving `goodChunks` (artifact `:42-55`), then `const { POST } = await import("./artifact")` after mocks (`:57`); `makeContext` fakes `locals.user` + `Request` (`:59-69`). Asserts: `401`, `400` (bad json / missing field / bad enum), `200` happy stream; separate `describe` for `500 code:"config"` via `vi.resetModules()`+`vi.doMock` (`:103-132`). **GAP: the provider-FAILURE path is entirely untested** — no retryable-503-then-500, no non-retryable-400 with echoed status, no mid-stream abort. Only happy-200 and config-500 exist.

### Risk #7 — Stream retry race (component / integration)

**`stop()`-before-`submit()` compliance per stream-retriggering handler:**

| Component        | Handler         | file:line    | `stop()` first?                                                                       | Races dispatch        |
| ---------------- | --------------- | ------------ | ------------------------------------------------------------------------------------- | --------------------- |
| AntiBiasStep     | `pick(t)`       | `:138-152`   | **YES** (`stop()` `:141`, `submit()` `:151`)                                          | `ANTI_BIAS_LOADED`    |
| AntiBiasStep     | `retry()`       | `:154-166`   | **YES** (`:156` / `:165`)                                                             | `ANTI_BIAS_LOADED`    |
| AlternativesStep | `retry()`       | `:54-60`     | **YES** (`:56` / `:59`)                                                               | `ALTERNATIVES_LOADED` |
| ArtifactStep     | `retryStream()` | `:155-173`   | **YES** (`:163` / `:172`)                                                             | `ARTIFACT_LOADED`     |
| ArtifactStep     | `retrySave()`   | `:148-153`   | n/a (re-POSTs `/api/decisions`, no stream)                                            | —                     |
| **SocraticStep** | **`retry()`**   | **`:68-72`** | **NO — `stop()` MISSING** (only resets ref `:69`, `REQUEST_START` + `submit()` `:71`) | `SOCRATIC_LOADED`     |

Initial-load `useEffect`s (Alternatives `:45-52`, Artifact `:106-135`, Socratic `:59-66`) are first-submission-only (guarded by a `submitted`/`submittedFor` ref) — no in-flight stream to abort, so `stop()` n/a.

**Confirmed first-hand:** `SocraticStep.tsx:36` destructures `stop` from `useObject`, but `retry()` (`:68-72`) never calls it. **Live unfixed instance of the documented race** — `lessons.md` enumerates only AntiBias (F6), Alternatives + Artifact (F1).

**Race seam (what a test observes)** — there is **no request-id / abort guard** in the reducer or handlers; `*_LOADED` cases (`reducer.ts:28,52,66,77`) unconditionally overwrite `data` — last dispatch wins. The _entire_ defense is `stop()` aborting the prior stream so its `onFinish` never fires. Cleanest observable per test-plan §2 guidance (assert resulting state, not handler mirroring; `test-plan.md:71`): drive two overlapping streams (stale resolves after fresh) and assert reducer `state.data` carries the **fresh** request's payload. AntiBiasStep has a second observable — `lastSubmittedTechnique.current` (`:143`): re-pick A→B mid-stream, assert `antiBiasOutput` matches **B**'s markdown (stale-pairing surface).

**Existing coverage / gap** — `reducer.test.ts` has **zero** race/`*_LOADED`/`onFinish` coverage; no component test exists under `src/components/wizard/`. Risk #7 is a **complete test gap** (test-plan §6.3 TBD). Test stack: vitest ^4.1.7 + @testing-library/react ^16.3.2 + jest-dom, `happy-dom`, setup `src/test/setup.ts` (`vitest.config.ts`, `package.json:47-68`).

## Code References

- `src/components/wizard/reducer.ts:25-26` — `REQUEST_FAIL`: only error action; preserves `data`.
- `src/components/wizard/reducer.ts:3-8` — `initialState`; no action ever returns it (no reset).
- `src/components/wizard/reducer.ts:28,52,66,77` — `*_LOADED` cases; unconditional `data` overwrite (last-dispatch-wins, the race surface).
- `src/components/wizard/types.ts:21-54` — `WizardData`, `WizardState`, all action types.
- `src/components/wizard/WizardApp.tsx:43-59` — state-driven render; error is additive, no unmount.
- `src/components/wizard/ErrorBanner.tsx:21-40` — visible `aria-live` error + Retry.
- `src/components/wizard/reducer.test.ts:16-34` — existing FR-031 reducer proof (happy path of Risk #1).
- `src/components/wizard/steps/DescribeStep.tsx:29-32` — `description` commits per keystroke.
- `src/components/wizard/steps/SocraticStep.tsx:36` — `stop` destructured; `:68-72` — `retry()` **missing `stop()`** (Risk #7 live bug); `:104-109` — answer commits per keystroke.
- `src/components/wizard/steps/AntiBiasStep.tsx:138-166` — `pick()`/`retry()` comply; `:143` technique ref (stale-pairing surface).
- `src/components/wizard/steps/AlternativesStep.tsx:54-60` — `retry()` complies.
- `src/components/wizard/steps/ArtifactStep.tsx:155-173` — `retryStream()` complies; `:87-100` — commit/save only on clean `onFinish`; `:137-201` — partial render stays on error but never committed.
- `src/lib/llm-retry.ts:56-129` — `withRetry`/`streamWithRetry`; no silent-success; first-chunk eager read at `:99-100`.
- `src/pages/api/wizard/artifact.ts:54-62` — error→HTTP translation (integration-test exemplar); mirrored in socratic/alternatives/anti-bias.
- `src/lib/openrouter.ts:16-31` — `getModel`/`getOpenRouter`; mock seam for forced provider failure.
- `src/pages/api/wizard/artifact.test.ts:42-132` — existing vitest mock pattern; covers happy-200 + config-500 only.

## Architecture Insights

- **Single error contract.** All four generation steps funnel failure into exactly one reducer action (`REQUEST_FAIL`), and the reducer keeps `data` immutable across it. This makes Risk #1 cheap to prove once (reducer unit + one component) and have it generalize.
- **The race has no guard — only ordering.** There is no request-id/sequence token distinguishing which stream produced a `*_LOADED`. Correctness depends entirely on the per-handler `stop()`-before-`submit()` discipline, which is exactly why the lesson recurred and why SocraticStep slipped. A test asserting _resulting state_ (not `stop()` spy order) is the durable guard the codebase lacks.
- **Error visibility is structurally sound server-side.** `streamWithRetry`'s eager first-chunk read is the linchpin that turns a connect-time provider failure into a JSON 500 rather than a deceptive 200 stream — the mechanism Risk #2's "no silent waits" depends on.
- **Cost×signal lands where the test-plan predicted:** Risk #1 → unit+component, Risk #2 → integration (route, mocked provider edge), Risk #7 → component. None need e2e.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "Abort the prior stream before re-submitting": the F6 (AntiBias) then F1 (Alternatives, Artifact) recurrence. **This research adds a third, still-unfixed instance: SocraticStep.retry().**
- `context/foundation/lessons.md` — "Default to client:only='react'": wizard mounts as a `client:only` island; relevant to how any component test mounts steps (no SSR).
- `context/foundation/test-plan.md` §2–§3 — risk map + Phase 1 definition this research grounds; §1 principle #3 makes this doc the ground truth for where the failures live.

## Related Research

- None prior. This is the first research artifact for the test rollout; Phase 2 (`/10x-research` for Risks #3/#4/#5) and Phase 3 (Risk #6) will follow per `test-plan.md` §3.

## Open Questions

1. **Fix SocraticStep.retry() inside this change, or split it out?** It's a one-line `stop()` addition plus a regression test. Cleanest: write the Risk #7 test across all four steps (it fails on Socratic), then add `stop()` to make it green — test-first, within Phase 1. Decide at plan time.
2. **How deterministically can `experimental_useObject` be driven in a component test** to simulate two overlapping streams resolving stale-then-fresh? Likely mock `@ai-sdk/react`'s `useObject` so the test controls each `onFinish` resolution and whether `stop()` suppresses it. Validate the exact mock shape against AI SDK docs at plan time (Context7).
3. **Component-test mount strategy** — mount individual steps with a seeded `WizardCtx` provider vs. mounting `WizardApp`. Per-step + seeded context is lighter and matches the uniform error contract; confirm `context.ts` exposes what a test needs.
4. **CI wiring** — test-plan §5 says wiring `npm run test` into `.github/workflows/ci.yml` (currently lint+build only) is part of Phase 1's landing. Confirm scope inclusion at plan time.
