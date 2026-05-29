# Wizard End-to-End (S-02) Implementation Plan

## Overview

Build the 6-step Distill wizard on top of F-01 (`decisions` table + RLS + DTOs). User describes a decision, answers up to 2 rounds of Socratic questions, reviews 3 alternatives, picks and acknowledges an anti-bias technique, and lands on a streamed artifact that auto-saves and can be copied or downloaded as Markdown. LLM calls go through `@openrouter/ai-sdk-provider` + Vercel `ai` SDK with `streamObject` to satisfy NFR ">2s shows progress." Wizard state lives in a single mounted React island via `useReducer`; FR-031 is satisfied by the reducer surviving in-step LLM failures. No new tables.

## Current State Analysis

- F-01 (archived `2026-05-28-data-foundation`) shipped the `decisions` table (`supabase/migrations/20260528082724_create_decisions.sql:6-35`) with `id`, `user_id`, `description`, `summary`, `artifact` (JSONB), `anti_bias_technique` (CHECK enum), `acknowledged_at default now()`, `created_at default now()`. RLS on; `decisions_select_own` + `decisions_insert_own` only — UPDATE/DELETE deliberately absent for immutability.
- Shared DTOs live in `src/types.ts` (lines 3-29): `AntiBiasTechniqueSchema`, `ArtifactSchema` (5 required non-empty arrays), `NewDecisionInputSchema`, `Decision`.
- SSR Supabase client cookie-bridged in `src/lib/supabase.ts`; reads `SUPABASE_URL`/`SUPABASE_KEY` via `astro:env/server`.
- Middleware (`src/middleware.ts`) resolves user to `context.locals.user` and gates page routes in `PROTECTED_ROUTES = ['/dashboard']`.
- Auth pattern: FormData-based, redirect-style (`src/pages/api/auth/signin.ts`). Wizard endpoints diverge to JSON in/out with status codes — payloads are structured (nested arrays in artifact).
- Reusable React-island scaffolding: `src/components/auth/{SignInForm,SubmitButton,ServerError,FormField}.tsx`.
- shadcn inventory in `src/components/ui/`: only `button.tsx` + `LibBadge.astro`. Need to add card, textarea, label, radio-group via `npx shadcn@latest add`.
- `astro.config.mjs:17-22` env schema declares `SUPABASE_URL`/`SUPABASE_KEY` only; needs `OPENROUTER_API_KEY`.
- `wrangler.jsonc` has `nodejs_compat` enabled (per LLM agent report), covering any incidental Node shims in the SDK; OpenRouter provider itself stays on Web `fetch` + `ReadableStream`.
- No `src/hooks/`, no AI SDK, no `wizard_runs` table. Zod 4.4.3 present.

## Desired End State

A signed-in user navigates from `/dashboard` to `/decisions/new`, completes the 6-step wizard, sees a structured artifact rendered on screen, copies it to clipboard or downloads it as `.md`, and finds the decision row in Supabase Studio scoped to their `user_id` with `anti_bias_technique` populated and `acknowledged_at` stamped. Mid-wizard LLM failures show an inline Retry banner without wiping prior step answers. The "Continue" button on step 4 is disabled until the user clicks the acknowledgment affordance with copy `I've read this — and I've decided what to do with it.`. A second-round Socratic prompt fires only when the LLM's `needsFollowUp` flag is true; the server caps total rounds at 2. The Astro page `/decisions/new` is gated by middleware (`PROTECTED_ROUTES` now contains `/decisions`); wizard API routes self-gate with inline `context.locals.user` checks returning JSON 401.

Verification: `npm run build` clean; `npx supabase start` + manual end-to-end run in a browser; Supabase Studio confirms one row per completed wizard; closing the tab mid-wizard is acceptably lossy.

### Key Discoveries

- **Two enforcement layers for the FR-030 wedge.** UI gate (reducer refuses `GO_TO "artifact"` until `acknowledgedAt` set) and DB layer (`anti_bias_technique` CHECK + `acknowledged_at default now()` at `supabase/migrations/20260528082724_create_decisions.sql:12-14`). Both ship; either alone is insufficient.
- **One-island design satisfies FR-031 mechanically.** Astro page mounts `<WizardApp client:load />` once; step UIs are sub-components rendering off `state.step`. Astro re-renders between steps would tear down the React tree → reducer state lost → contradicts FR-031.
- **API vs page auth split.** Pages use `PROTECTED_ROUTES` middleware redirect. Do NOT add `/api/*` to `PROTECTED_ROUTES` — middleware returns 302 HTML to `/auth/signin`, wrong for a fetch caller. APIs self-gate inline.
- **Auth idiom for endpoints.** `context.locals.user` already populated by middleware for ALL requests (incl. API). Inline check returns JSON 401 with no extra setup.
- **Terminal endpoint must stream artifact AND report save outcome.** Resolved by AI SDK data-stream protocol: `result.toDataStreamResponse({ onFinish })` where `onFinish` performs the INSERT and appends a custom data part `{ savedId }` (or `{ saveError }`). Client `useObject` reads schema; a `data:` channel exposes the save outcome. One endpoint, no on-screen-but-unsaved window.
- **Retry path needs `mode: "save"`.** Re-streaming the artifact on save retry is wasteful and produces drift. The terminal endpoint accepts a discriminated union body: `{ mode: "stream", … }` for the happy path; `{ mode: "save", artifact, summary, … }` for retry. Single endpoint, two code paths.
- **Model id.** User selected `deepseek/deepseek-v4-flash`. This diverges from PRD/tech-stack references to "Sonnet 4.6". Slug must be verified against `GET https://openrouter.ai/api/v1/models` in Phase 1 before merge — DeepSeek's OpenRouter catalog does not document a `v4-flash` tier at writing time; if the slug 404s, fall back to the nearest documented DeepSeek slug or the closest model. PRD + tech-stack docs get updated in Phase 6 to whatever ships.

## What We're NOT Doing

- No `wizard_runs` table, no `localStorage` snapshot, no `sessionStorage`. Refresh blows in-progress state by design (PRD accepts this; research §Open decision #3).
- No magic-link migration (S-01).
- No decisions list view or read-only artifact route (S-03).
- No edit/delete of saved decisions (PRD Non-Goals).
- No CSRF middleware. Supabase cookies are `HttpOnly` + `SameSite=Lax`; JSON-only endpoints reject form-encoded posts as a weak shield.
- No per-step DB autosave.
- No `requireUser` helper extraction yet. 4 inline auth checks are below the threshold for refactor pressure (research §Open decision #4).
- No domain packs / profile quiz / live search / observability tooling (Parked in roadmap).
- No automated E2E tests; manual smoke per PRD §Non-Goals.
- No collaboration / sharing.

## Implementation Approach

**Single React island, `useReducer`, discriminated `step` union.** State shape per research §2. The reducer's `REQUEST_FAIL` action explicitly does NOT clear `data` — that one line *is* FR-031 in code.

**5 API endpoints, all `prerender = false`, all JSON in/out, all inline auth-gated.**

```
POST /api/wizard/socratic       streamObject → { questions, needsFollowUp }
POST /api/wizard/alternatives   streamObject → { alternatives: 3 × {title, pros, cons} }
POST /api/wizard/anti-bias      streamObject → { markdown }
POST /api/wizard/artifact       streamObject → { ...Artifact, summary }
POST /api/decisions             JSON save: NewDecisionInputSchema → 201 { id }
```

Each LLM endpoint validates input with zod, gates on `context.locals.user`, reads `OPENROUTER_API_KEY` from `astro:env/server`, calls `streamObject` with the matching zod response schema, and returns `result.toTextStreamResponse()`. The save endpoint is plain JSON in / JSON out (mirrors `src/pages/api/auth/signin.ts`'s shape but JSON instead of FormData). Retry policy: exponential backoff 500/1500/4000 ms with jitter, max 3 attempts, retryable on 429/5xx + 524/529, non-retryable on 4xx; on 529 reconstruct the model handle with `provider: { allow_fallbacks: true }` for the retry; honour `Retry-After` on 429. `response-healing` is only available on non-streaming `generateObject` (provider constraint), so it ships only on an optional `generateObject` fallback if a stream errors with `schema_invalid` — not on the primary stream path. Beta header `anthropic-beta: fine-grained-tool-streaming-2025-05-14` (or equivalent provider beta) opt-in on `/api/wizard/artifact` to reduce TTFB.

**Streaming UX.** Each LLM-bound step renders a structural skeleton immediately (3 cards for alternatives, N rows for Socratic, H1+5×H2 for artifact). `useObject` from `@ai-sdk/react` produces a growing partial object; sections fill as token chunks land.

**Anti-bias gate.** Step 4 renders the picker as 3 cards. Click triggers the LLM call. After the streamed markdown lands, an Acknowledge button with copy `I've read this — and I've decided what to do with it.` becomes the only path forward; click stamps `data.acknowledgedAt = Date.now()`. Reducer's `canAdvance` selector refuses `GO_TO "artifact"` while `acknowledgedAt` is undefined. Defense in depth: DB `anti_bias_technique` CHECK + `acknowledged_at default now()` ensures any INSERT carries both fields.

**Markdown export.** Pure function `artifactToMarkdown(input)` produces:

```
# Decision: <first line of description>

## Needs
- ...

## Criteria
- ...

## Options
- ...

## Risks
- ...

## Open questions
- ...

---
> Summary: <summary>
```

Copy uses `navigator.clipboard.writeText`; download produces a `Blob` + `<a download="<slug>.md">`.

**Markdown rendering on the anti-bias step.** Use `react-markdown` for the LLM-generated markdown. Tree-shakeable, well-trodden, sanitizes by default.

## Critical Implementation Details

**Stream-then-save ordering (split endpoints).** `/api/wizard/artifact` runs `streamObject` and returns `result.toTextStreamResponse()` — pure schema stream, no data parts. Client `useObject` consumes the stream; its `onFinish({ object })` callback fires once the full artifact has materialized client-side, at which point the client POSTs the assembled `NewDecisionInputSchema` payload (`{ description, summary, artifact, anti_bias_technique }`) to `/api/decisions`. The save window between "last token rendered" and "Saved indicator" is bounded by one Supabase INSERT (~100-300 ms). If `/api/decisions` returns non-201, the artifact stays on screen with a Retry-save banner; Retry re-POSTs the same `NewDecisionInputSchema` payload to `/api/decisions`, no LLM call involved. This avoids the AI-SDK data-parts protocol (which is `useChat`/`streamText`-only) and matches both `useObject`'s actual surface and the OpenRouter `response-healing` non-streaming constraint.

**Reducer must preserve `data` on `REQUEST_FAIL`.** Single rule: any error action sets `pending=false` + `error=<typed>`; `data` is never touched in the failure branch. Cover this in a unit test (`reducer.test.ts`) — it is the FR-031 contract.

**Server-enforced Socratic round cap.** `/api/wizard/socratic` accepts an optional `priorAnswers: { round1?: QAPair[]; round2?: QAPair[] }` (each `QAPair` = `{ question, answer }`). If `round2` is present the endpoint returns 422 — cap protected at the boundary regardless of client behaviour. Carrying the question alongside each answer lets the round-2 prompt deepen specific Q/A pairs and lets the `needsFollowUp` heuristic compare answers against the questions they responded to.

**No imperative LLM trigger from the picker.** `useObject` is request-driven via `submit({ ... })`. The anti-bias step's picker click calls `submit({ technique, description, socratic, alternatives })`; React's strict mode + the hook's idempotence prevent double-submit. Document this so the implementer doesn't reach for a separate `useEffect`-on-mount call.

## Phase 1: Foundations

### Overview

Install deps, register env secret, extend middleware + types, add shadcn primitives, surface a dashboard CTA. No wizard logic yet; build passes; `/decisions` is gated.

### Changes Required

#### 1. AI SDK + provider deps

**File**: `package.json`

**Intent**: Add Vercel `ai` SDK + React hooks + OpenRouter provider. These enable Workers-compatible streaming with zod schemas without hand-rolled SSE.

**Contract**: `dependencies` gains `ai`, `@ai-sdk/react`, `@openrouter/ai-sdk-provider`, `react-markdown`. Run `npm install`. Versions: latest stable at install time. `npm run build` must succeed unchanged otherwise.

#### 2. Env schema entry

**File**: `astro.config.mjs`

**Intent**: Register `OPENROUTER_API_KEY` so it is reachable via `astro:env/server` and surfaced in `.dev.vars` typing. Server-only, secret access, optional (so build does not fail before the dev sets it).

**Contract**: append inside the existing `env.schema` block (lines 17-22):
```
OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```
Add the same key to `.env.example` (or create one) with an empty placeholder.

#### 3. Page route gating

**File**: `src/middleware.ts`

**Intent**: Protect `/decisions` and `/decisions/new` with the existing redirect-to-signin behaviour. Do NOT add any `/api/*` entries — APIs self-gate.

**Contract**: `PROTECTED_ROUTES` becomes `["/dashboard", "/decisions"]`. `startsWith` semantics already cover the nested route.

#### 4. Wizard zod schemas

**File**: `src/types.ts`

**Intent**: Single source of truth for wizard DTOs. Both server endpoints and the React island import from here.

**Contract**: append below the existing block:
- `QAPairSchema = z.object({ question: z.string().min(1), answer: z.string().min(1) })`
- `SocraticRequestSchema = z.object({ description: z.string().min(1), priorAnswers: z.object({ round1: QAPairSchema.array().optional(), round2: QAPairSchema.array().optional() }).optional() })` — round-2 prompt + the `needsFollowUp` heuristic both need question context, so each entry carries the matching Q.
- `SocraticResponseSchema = z.object({ questions: z.string().min(1).array().min(3).max(6), needsFollowUp: z.boolean() })`
- `AlternativeSchema = z.object({ title: z.string().min(1), pros: z.string().min(1).array().min(1), cons: z.string().min(1).array().min(1) })`
- `SocraticPayloadSchema = z.object({ round1: QAPairSchema.array().min(1), round2: QAPairSchema.array().optional() })` — the shape downstream endpoints reuse to refer to the answered Socratic context
- `AlternativesRequestSchema = z.object({ description: z.string().min(1), socratic: SocraticPayloadSchema })`
- `AlternativesResponseSchema = z.object({ alternatives: AlternativeSchema.array().length(3) })`
- `AntiBiasRequestSchema = z.object({ description: z.string().min(1), socratic: SocraticPayloadSchema, alternatives: AlternativeSchema.array().length(3), technique: AntiBiasTechniqueSchema })`
- `AntiBiasResponseSchema = z.object({ markdown: z.string().min(1) })`
- `ArtifactRequestSchema = z.object({ description: z.string().min(1), socratic: SocraticPayloadSchema, alternatives: AlternativeSchema.array().length(3), technique: AntiBiasTechniqueSchema, antiBiasMarkdown: z.string().min(1) })` — request to streaming `/api/wizard/artifact`
- `ArtifactResponseSchema = ArtifactSchema.extend({ summary: z.string().min(1) })` (streamed shape)
- Save endpoint reuses existing `NewDecisionInputSchema` (`src/types.ts:15-20`) as its request body — no new wrapper schema.

Export inferred `type` aliases alongside each schema. Place all wizard additions under a `// --- wizard ---` divider comment so they read as a coherent block.

#### 5. shadcn primitives

**Command**: `npx shadcn@latest add card textarea label radio-group`

**Intent**: Bring in the primitives the wizard UI needs without hand-rolling them. They land in `src/components/ui/` per `components.json`.

**Contract**: 4 new files in `src/components/ui/`. No changes to existing components.

#### 6. Dashboard CTA

**File**: `src/pages/dashboard.astro`

**Intent**: Make the wizard reachable from the only protected page that exists today. S-03 will replicate this CTA on the eventual list view.

**Contract**: add an `<a href="/decisions/new">New decision</a>` styled to match the existing sign-out button. Place it above the sign-out form. Keep the file otherwise unchanged.

#### 7. Test runner setup

**Files**: `package.json`, `vitest.config.ts` (new), `src/test/setup.ts` (new), `.github/workflows/ci.yml`

**Intent**: Establish the Vitest + Testing Library + MSW baseline that Phases 2–5 depend on for the reducer unit tests, exporter snapshot, and endpoint integration tests. Without this, ~15 promised Success Criteria across later phases have no place to run.

**Contract**:
- Add devDeps: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`, `msw`
- `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`
- `vitest.config.ts`: `environment: "happy-dom"`, `setupFiles: ["./src/test/setup.ts"]`, `globals: false`, alias `@` → `src/` matching `tsconfig.json`
- `src/test/setup.ts`: imports `@testing-library/jest-dom/vitest`; sets up MSW `server` (`beforeAll(() => server.listen({ onUnhandledRequest: "error" }))`, `afterEach(() => server.resetHandlers())`, `afterAll(() => server.close())`); exports a `server` for per-test handler overrides
- `.github/workflows/ci.yml`: add a `npm test` step between lint and build so test failures gate merges

### Success Criteria

#### Automated Verification

- `npm install` succeeds without peer-warning errors that block CI
- `npm run build` passes
- `npm run lint` is clean
- `astro sync` regenerates `.astro/env.d.ts` and `OPENROUTER_API_KEY` appears in the generated types
- New schemas in `src/types.ts` type-check (build covers this)

#### Manual Verification

- Visiting `/decisions/new` while signed-out redirects to `/auth/signin`
- Dashboard renders a "New decision" link to `/decisions/new`
- Setting `OPENROUTER_API_KEY` in `.dev.vars` produces no runtime warning on `npm run dev`

**Implementation Note**: Pause after Phase 1 for manual confirmation before Phase 2.

---

## Phase 2: Wizard shell + step 1 (Describe)

### Overview

Stand up the single Astro page, the React island, the reducer, the chrome (numbered step header + Back), the error banner scaffold, the streaming skeleton scaffold, and a fully functional Description step. No LLM calls yet; the user can type a description and advance to a placeholder step 2.

### Changes Required

#### 1. Astro page mount

**File**: `src/pages/decisions/new.astro` (new)

**Intent**: Layout + signed-in guard + island mount. Mirrors `src/pages/auth/signin.astro:16` pattern.

**Contract**: imports `Layout`, renders `<WizardApp client:only="react" />`. No props.

**Deviation accepted at impl-review (2026-05-29)**:
- Directive is `client:only="react"`, not `client:load` — SSR build of `WizardApp` failed (hooks reach into browser-only APIs at render). `client:only` is the correct directive for islands that can't SSR.
- The explicit `Astro.locals.user` inline guard is omitted. Middleware (`PROTECTED_ROUTES` includes `/decisions`) already redirects unauth users at the network boundary, so the inline check would be redundant. Trade-off: a future change that removes `/decisions` from `PROTECTED_ROUTES` would silently expose this page.

#### 2. Wizard state types

**File**: `src/components/wizard/types.ts` (new)

**Intent**: Discriminated `WizardStep`, `WizardError`, `WizardData`, `WizardState`, `Action` per research §2. Reuse `Artifact`, `AntiBiasTechnique` from `@/types`.

**Contract**: per research §2 type block, exported as named types. `WizardData` carries optional fields filled monotonically per step; `WizardError` is a discriminated union of `"llm" | "network" | "validation"`; `Action` enumerates the minimal action surface.

#### 3. Reducer + selector

**File**: `src/components/wizard/reducer.ts` (new)

**Intent**: Pure reducer covering all actions; `REQUEST_FAIL` must not clear `data`. Export `canAdvance(state)` selector.

**Contract**:
- `initialState: WizardState = { step: "describe", data: { description: "" }, pending: false, error: null }`
- `reducer(state, action): WizardState` — switch on action type; `REQUEST_FAIL` updates `pending` + `error` only
- `canAdvance(state): boolean` — true iff the current step's exit conditions hold (e.g. step "anti-bias" requires `data.acknowledgedAt !== undefined`)

#### 4. Wizard root component

**File**: `src/components/wizard/WizardApp.tsx` (new)

**Intent**: Mount point. `useReducer(reducer, initialState)`. Switch on `state.step` to render one of six step components. Provide a context-or-prop channel for `dispatch` to children.

**Contract**: default-export `WizardApp`. Internally renders `<StepHeader>` + `<ErrorBanner error={state.error}>` + `<StepX ...>`. State sharing: pass `{state, dispatch}` via React `Context` (single provider; cheap; alternative is prop drilling 5 levels).

#### 5. Step header

**File**: `src/components/wizard/StepHeader.tsx` (new)

**Intent**: Show "Step N of 6 — <title>". Back button disabled on step 1; otherwise dispatches `GO_TO previous`. No forward skip.

**Contract**: props `{ step: WizardStep }`. Map step id to ordinal and title. Render a `<Button variant="ghost" size="sm">` styled Back arrow (or `<button>` matching `src/components/auth/`). Use lucide `ArrowLeft`.

#### 6. Description step

**File**: `src/components/wizard/steps/DescribeStep.tsx` (new)

**Intent**: Single `<Textarea>` bound to `state.data.description`; Continue dispatches `SET_DESCRIPTION` + `GO_TO "socratic-1"`. Validates `description.trim().length > 0`.

**Contract**: uses shadcn `Textarea`. Inline validation: empty → red border + helper text below; no dispatch. Continue button uses the lifted `PendingButton` from §9.

#### 7. Error banner

**File**: `src/components/wizard/ErrorBanner.tsx` (new)

**Intent**: Lift the `ServerError.tsx` pattern but accept `WizardError | null` and optional `onRetry` callback. Renders a Retry button when present.

**Contract**: props `{ error: WizardError | null, onRetry?: () => void }`. Map `error.kind` to copy: `llm` → "The AI service is having trouble. Try again?", `network` → "Connection lost — try again", `validation` → `error.message`. `aria-live="polite"` for accessibility.

#### 8. Streaming skeleton scaffold

**File**: `src/components/wizard/Skeleton.tsx` (new)

**Intent**: Reusable shimmer-rows component. Variants per step shape will be created in their phases; this file ships the base `SkeletonRow`, `SkeletonCard`, `SkeletonBlock` primitives.

**Contract**: exports `SkeletonRow({ width })`, `SkeletonCard({ rows })`, `SkeletonBlock({ heading })`. Uses Tailwind `animate-pulse` with translucent fills consistent with the cosmic theme.

#### 9. Pending-button primitive

**File**: `src/components/wizard/PendingButton.tsx` (new)

**Intent**: Lift `auth/SubmitButton.tsx`'s spinner idiom but driven by a `pending` prop instead of `useFormStatus`. Wizard buttons aren't inside a `<form>` action.

**Contract**: props `{ pending: boolean, onClick: () => void, children, icon?, pendingText?, disabled? }`. Renders a `<Button>` with the existing spinner span when `pending`.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes
- A unit test `src/components/wizard/reducer.test.ts` covers: `SET_DESCRIPTION` updates description; `GO_TO` transitions step; `REQUEST_FAIL` leaves `data` unchanged; `canAdvance` is false on "anti-bias" until `acknowledgedAt` is set

#### Manual Verification

- Visiting `/decisions/new` while signed-in renders the wizard with "Step 1 of 6 — Describe"
- Typing a paragraph and clicking Continue advances to a placeholder step 2 (`StepHeader` reads "Step 2 of 6 — …")
- Empty description shows inline validation error and does not advance
- Clicking Back from step 2 returns to step 1 with the description preserved in the textarea
- ErrorBanner placeholder renders correctly when state has a synthetic error (devtools)

**Implementation Note**: Pause after Phase 2 for manual confirmation before Phase 3.

---

## Phase 3: Socratic endpoint + steps 2a/2b

### Overview

Wire the first LLM endpoint and the Socratic UI. Steps 2a (round 1) and 2b (round 2 if `needsFollowUp` is true) share the same component and endpoint. Server enforces cap=2. Proves the AI SDK + zod-schema streaming pattern that the rest of the wizard reuses.

### Changes Required

#### 1. OpenRouter client factory

**File**: `src/lib/openrouter.ts` (new)

**Intent**: Single place that constructs an OpenRouter model handle from `OPENROUTER_API_KEY`. Returns `{ model }` for use by `streamObject`. Centralizes the model id so swapping it is a one-line change.

**Contract**: exports `getModel()` returning `provider("<model-id>")`. Model id: `deepseek/deepseek-v4-flash` per user selection — verify against `GET https://openrouter.ai/api/v1/models` in Phase 1; if 404 at impl time, swap to the verified DeepSeek slug and document the change. Throws a typed error if `OPENROUTER_API_KEY` is unset.

#### 2. Retry helper

**File**: `src/lib/llm-retry.ts` (new)

**Intent**: Wrap an LLM call (or the underlying provider call) with retry: 500/1500/4000 ms backoff + jitter, max 3 attempts, retryable on 429/500/502/503/524/529, non-retryable on 400/401/402/403/404/422. On 429 honour `Retry-After`. On 529 swap to a fallback-enabled model handle for the retry. Surface the original error code so the route can map to a typed `WizardError`.

**Contract**:
- `withRetry<T>(fn: (attemptIndex: number, fallback: boolean) => Promise<T>, opts?): Promise<T>` — the second arg tells the caller whether to construct the model handle with `provider: { allow_fallbacks: true }` for this attempt (set to `true` only on the retry following a 529).
- The OpenRouter provider exposes error metadata via the AI SDK's `APICallError` type — the helper switches on that.
- The fallback handle is constructed at the call site via `openrouter(slug, { provider: { allow_fallbacks: true } })`. Plugin / provider options live on the model handle, not on a `providerOptions` body field.

#### 3. Socratic endpoint

**File**: `src/pages/api/wizard/socratic.ts` (new)

**Intent**: POST. Validates `SocraticRequestSchema`. Inline auth check. Server enforces 2-round cap: 422 if `priorAnswers.round2` is present. Builds prompt from description + prior answers. Calls `streamObject({ model, schema: SocraticResponseSchema, system, prompt })`. Returns `result.toTextStreamResponse()`.

**Contract**:
- `export const prerender = false;`
- `POST: APIRoute` → returns `Response`
- Status code map: 200 (streaming), 400 (invalid JSON or schema parse fail), 401 (no user), 422 (cap exceeded), 500 (LLM after retries exhausted, or healing failed)

#### 4. Socratic prompt

**File**: `src/lib/prompts/socratic.ts` (new)

**Intent**: System + user-template builder. System enforces 3–6 questions, second person, Socratic style ("What would change your mind?", "What evidence …"), and the `needsFollowUp` rule: true only if at least one round-1 answer is < 20 words OR contradicts another, else false. Round-2 prompt instructs deepening rather than repetition.

**Contract**: `socraticSystem(): string`, `socraticUser({ description, priorAnswers }): string`.

#### 5. Socratic step component

**File**: `src/components/wizard/steps/SocraticStep.tsx` (new)

**Intent**: Use `useObject({ api: "/api/wizard/socratic", schema: SocraticResponseSchema })`. On mount + state shape changes, call `submit({ description, priorAnswers })`. Render `<SocraticSkeleton>` until `object.questions` populates; then render N `<Textarea>` rows (label = question, value = `data.socratic1.answers[i]` or `data.socratic2.answers[i]` depending on `state.step`). Continue dispatches `SOCRATIC_LOADED` (if first time) + `SOCRATIC_ANSWER` per row + transitions to `socratic-2` iff round 1 had `needsFollowUp` else `alternatives`.

**Contract**:
- Props: none (reads `state` + `dispatch` from context)
- Distinct local handling per `state.step` value (`"socratic-1"` vs `"socratic-2"`)
- On useObject error → dispatch `REQUEST_FAIL` with typed error; ErrorBanner shows `Retry`; Retry re-calls `submit(...)`
- On useObject completion → dispatch `SOCRATIC_LOADED` with `{ round, questions }`

#### 6. Socratic skeleton variant

**File**: `src/components/wizard/Skeleton.tsx`

**Intent**: Add an exported `SocraticSkeleton({ approxN = 4 })` that renders 4 `SkeletonRow`s in a column.

**Contract**: appended export; no change to existing primitives.

### Success Criteria

#### Automated Verification

- Endpoint integration test (Vitest + MSW or against a local mock) confirms: 200 streaming body for valid request, 401 without session cookie, 400 on malformed JSON, 422 with `priorAnswers.round2` present
- Schema parse failure on LLM output is treated as 500 with `error.code = "schema_invalid"`
- `npm run lint` + `npm run build` pass

#### Manual Verification

- Step 2 (round 1) streams questions with visible token-by-token reveal
- Skeleton (4 rows) renders immediately on entry to step 2
- Answering all questions and clicking Continue advances to round 2 iff `needsFollowUp` true, else directly to step 3
- Force `needsFollowUp = false` (via prompt tweak) and confirm direct jump to step 3
- Round 2 cap: simulate a manual POST with `priorAnswers.round2` set → 422
- Kill the network mid-stream → ErrorBanner with Retry; description + step state preserved
- Click Retry → fresh stream, eventual success

**Implementation Note**: Pause after Phase 3 for manual confirmation before Phase 4. Capture an informal TTFB + total wall-clock measurement here (one number is enough) — informs whether p95 work in Phase 6 will need prompt trimming.

---

## Phase 4: Alternatives + Anti-bias gate

### Overview

Two endpoints, two step components. Alternatives streams 3 cards; anti-bias streams markdown and enforces the FR-030 acknowledgment wedge. `canAdvance` selector + UI button disable + reducer guard form the UI-side of the two-layer enforcement (DB layer ships with F-01).

### Changes Required

#### 1. Alternatives endpoint

**File**: `src/pages/api/wizard/alternatives.ts` (new)

**Intent**: POST. Same scaffold as socratic.ts. Validates `AlternativesRequestSchema`. `streamObject({ schema: AlternativesResponseSchema })`. No healing (small schema).

**Contract**: same status code map as Socratic; no cap logic.

#### 2. Alternatives prompt

**File**: `src/lib/prompts/alternatives.ts` (new)

**Intent**: System: "Produce exactly 3 alternatives covering distinct strategic axes (do nothing / status quo always one if applicable). Each has 2–4 pros and 2–4 cons stated as concrete consequences, not abstractions."

**Contract**: `alternativesSystem(): string`, `alternativesUser({ description, socratic }): string`.

#### 3. Anti-bias endpoint

**File**: `src/pages/api/wizard/anti-bias.ts` (new)

**Intent**: POST. Validates `AntiBiasRequestSchema`. Selects prompt by `technique` enum. `streamObject({ schema: AntiBiasResponseSchema })`.

**Contract**: 422 if `technique` not in enum (caught by zod earlier; defensive). Maps `technique` → prompt builder.

#### 4. Anti-bias prompts (per technique)

**File**: `src/lib/prompts/anti-bias/devils-advocate.ts`, `pre-mortem.ts`, `unknown-unknowns.ts` (3 new files)

**Intent**: One file per technique. System enforces Nemeth's authenticity rule (no "I am playing"), past-tense pre-mortem, Rumsfeld-matrix structure for unknown unknowns. Each closes with `If you still want to proceed, here is what changed: ___.` per research §4.

**Contract**: each exports `system(): string` and `user(payload): string`. Output: `{ markdown: string }` matching `AntiBiasResponseSchema`. Markdown contains `## <Technique title>` + orienting line + 3–5 `###` items + closing line.

#### 5. Alternatives step component

**File**: `src/components/wizard/steps/AlternativesStep.tsx` (new)

**Intent**: `useObject` against `/api/wizard/alternatives`; on mount call `submit({ description, socratic })`. Render `<AlternativesSkeleton>` (3 cards) until `object.alternatives` populates; then render 3 `<Card>`s with title + pros bullets + cons bullets. Continue dispatches `ALTERNATIVES_LOADED` + `GO_TO "anti-bias"`.

**Contract**: as Socratic; standard streaming error/retry flow.

#### 6. Anti-bias step component

**File**: `src/components/wizard/steps/AntiBiasStep.tsx` (new)

**Intent**: Two phases inside one step:
1. **Picker**: 3 `<Card>`s (Devil's Advocate / Pre-mortem / Unknown unknowns) with a one-line description. Click sets local `pickedTechnique` and calls `submit({ ... , technique })` on the `useObject`.
2. **Output + acknowledge**: stream the markdown into a `<ReactMarkdown>` block (prose styling). Below it, `<Button>` with copy `I've read this — and I've decided what to do with it.` is the only path forward. Click dispatches `ACKNOWLEDGE_ANTI_BIAS` + `ANTI_BIAS_LOADED({ output, technique })`.

Continue button is `disabled={!canAdvance(state)}` — and the reducer also refuses `GO_TO "artifact"` while `acknowledgedAt` is undefined (defense in depth).

**Contract**:
- 3 card descriptions (short copy):
  - Devil's Advocate: "Strongest case against your direction, argued in earnest."
  - Pre-mortem: "Imagine it has already failed. Write the failure story."
  - Unknown unknowns: "Surface hidden assumptions, blind spots, and unasked questions."
- Markdown rendered via `react-markdown` — raw HTML is disabled by default; do not enable `rehype-raw` without also adding `rehype-sanitize`
- Acknowledge button stamps `data.acknowledgedAt = Date.now()` exactly once

#### 7. Alternatives + AntiBias skeleton variants

**File**: `src/components/wizard/Skeleton.tsx`

**Intent**: Add `AlternativesSkeleton()` (3 cards in a row/grid) and `AntiBiasSkeleton()` (large prose block — H2 + 3 H3 + paragraphs).

**Contract**: appended exports.

### Success Criteria

#### Automated Verification

- Alternatives endpoint: 200/400/401/500 paths covered
- Anti-bias endpoint: 200/400/401/500 paths covered; technique validation rejects out-of-enum values with 400
- Reducer unit test: `GO_TO "artifact"` is a no-op (or refused) when `acknowledgedAt === undefined`
- Reducer unit test: `ACKNOWLEDGE_ANTI_BIAS` stamps `data.acknowledgedAt`
- `npm run lint` + `npm run build` pass

#### Manual Verification

- Step 3 streams 3 alternative cards; skeleton visible immediately
- Step 4 picker renders 3 cards; picking one streams markdown into the prose block
- Each technique produces visibly distinct output (sample one decision through all three)
- Continue stays disabled until Acknowledge clicked
- After Acknowledge, Continue advances to step 5
- Bypass attempt: in devtools, dispatch `GO_TO "artifact"` directly → state.step does not change
- Mid-stream failure on either endpoint → Retry path works; prior step data preserved

**Implementation Note**: Pause after Phase 4 for manual confirmation before Phase 5.

---

## Phase 5: Artifact stream endpoint + save endpoint + exports

### Overview

Two endpoints: `/api/wizard/artifact` streams the artifact + summary via `streamObject`; `/api/decisions` saves the assembled payload as a plain JSON POST. Client renders the artifact progressively, then on `useObject` `onFinish` fires the save POST and exposes Copy + Download. Save failure shows a Retry banner; Retry re-POSTs to `/api/decisions` without re-streaming. The split matches `streamObject`'s actual surface (no data-parts protocol) and the OpenRouter `response-healing` non-streaming constraint. This covers the entire FR-027 + FR-028 + FR-029 surface.

### Changes Required

#### 1a. Artifact streaming endpoint

**File**: `src/pages/api/wizard/artifact.ts` (new)

**Intent**: POST. Validates `ArtifactRequestSchema`. Inline auth. Runs `streamObject({ model, schema: ArtifactResponseSchema, system, prompt })` and returns the streaming Response.

**De-scoped at impl-review (2026-05-29)**: the Anthropic-only `anthropic-beta: fine-grained-tool-streaming-2025-05-14` header was dropped — the shipped model is DeepSeek (non-Anthropic), so the header is vestigial. The optional `generateObject` + `response-healing` plugin fallback on `schema_invalid` was also dropped — `response-healing` plugin compatibility with OpenRouter+DeepSeek is unverified and Phase 5.1's healing-test criterion was checked but never implemented. If the model swap to Anthropic later, restore both.

**Contract**:
- `export const prerender = false;`
- `POST: APIRoute` → returns `Response`
- Status code map: 200 (streaming), 400 (invalid JSON / schema parse fail of request), 401 (no user), 500 (LLM after retries exhausted, healing fallback also failed)

#### 1b. Save endpoint

**File**: `src/pages/api/decisions/index.ts` (new)

**Intent**: POST. Inline auth. Validates `NewDecisionInputSchema`. INSERTs into `public.decisions` with `user_id` injected from `context.locals.user`. JSON in / JSON out (mirrors `src/pages/api/auth/signin.ts` shape but JSON not FormData).

**Contract**:
- `export const prerender = false;`
- Status codes: 201 (success, JSON `{ id }`), 400 (invalid body / zod fail), 401 (no user), 500 (insert failed)
- Body: `NewDecisionInputSchema` payload `{ description, summary, artifact, anti_bias_technique }`; `user_id`, `id`, `acknowledged_at`, `created_at` all server- / DB-supplied

#### 2. Artifact prompt

**File**: `src/lib/prompts/artifact.ts` (new)

**Intent**: System: produce the 5-section artifact (needs / criteria / options / risks / open_questions) plus a 1-2 sentence `summary` consolidating the decision. Each array has at least 1 item; items are concrete, not abstract.

**Contract**: `artifactSystem(): string`, `artifactUser({ description, socratic, alternatives, technique, antiBiasMarkdown }): string`.

#### 3. Markdown exporter

**File**: `src/lib/wizard/exporter.ts` (new)

**Intent**: Pure function converting `NewDecisionInput` → markdown string per the H1+H2+bullets+summary template above.

**Contract**: `artifactToMarkdown(input: NewDecisionInput): string`. Also exports `artifactToFilename(input): string` → kebab-case of the first non-empty line of description, truncated to 60 chars, suffix `.md`.

#### 4. Artifact step component

**File**: `src/components/wizard/steps/ArtifactStep.tsx` (new)

**Intent**: `useObject({ api: "/api/wizard/artifact", schema: ArtifactResponseSchema })`; on mount call `submit({ ... ArtifactRequestSchema payload })`. Render `<ArtifactSkeleton>` (H1 + 5 H2 blocks) immediately; replace each section as `object.<section>` populates. In `onFinish({ object })`, dispatch `ARTIFACT_LOADED({ artifact, summary })`, then `fetch("/api/decisions", { method: "POST", body: JSON.stringify(buildSavePayload(state, object)) })`. On 201 → dispatch `SAVED({ decisionId: id })` → render "Saved" indicator + Copy + Download. On non-201 → render `ErrorBanner` with `Retry save` that re-POSTs the same `NewDecisionInputSchema` payload to `/api/decisions`.

**Contract**:
- Copy button: `navigator.clipboard.writeText(artifactToMarkdown(payload))`; flash a toast/inline confirmation for 1.5s
- Download button: create a `Blob([md], { type: "text/markdown" })`, `URL.createObjectURL`, `<a href download={filename} />.click()`, revoke URL after click
- Save payload builder: `buildSavePayload(state, streamedObject)` returns a `NewDecisionInputSchema` shape — `{ description, summary, artifact, anti_bias_technique }`
- Retry save: same `fetch("/api/decisions", ...)` call; on 201 dispatch `SAVED({ decisionId: id })`; on non-201 update banner

#### 5. Artifact skeleton variant

**File**: `src/components/wizard/Skeleton.tsx`

**Intent**: Add `ArtifactSkeleton()` rendering H1 placeholder + 5 H2 placeholders each with 3-4 row placeholders.

**Contract**: appended export.

### Success Criteria

#### Automated Verification

- `/api/wizard/artifact` integration test: returns 200 streaming body for valid request; 400 on invalid body; 401 without session; 500 on LLM-after-retries with `error.code = "schema_invalid"` when even the `generateObject` healing fallback fails
- `/api/decisions` integration test (save): 201 `{ id }` for valid `NewDecisionInputSchema` payload; 400 on invalid body; 401 without session; 500 if Supabase INSERT throws (mock the client)
- `artifactToMarkdown` snapshot test for the canonical template
- `artifactToFilename` test for slug rules
- `npm run lint` + `npm run build` pass

#### Manual Verification

- Step 5 streams the artifact section-by-section behind the skeleton
- On stream completion the "Saved" indicator appears with Copy + Download
- Copy puts well-formed markdown in clipboard (paste-test into a markdown renderer)
- Download produces `<slug>.md` opening to the expected layout
- Force a save failure (temporarily break the INSERT — e.g. RLS violation by stubbing `user_id`) → banner appears, Retry succeeds against `mode: "save"`
- Saved row visible in Supabase Studio scoped to the signed-in `user_id`, with `anti_bias_technique` populated and `acknowledged_at` stamped
- Run wizard a second time → second row inserted; rows scoped to the same user only

**Implementation Note**: Pause after Phase 5 for manual confirmation before Phase 6.

---

## Phase 6: Polish + prompt tuning + p95 + manual smoke

### Overview

End-to-end pass for quality, performance, and documentation. Tune prompts where output is weak; measure latency against NFR ">2s shows progress"; sweep accessibility + cross-browser; update foundation docs to reflect the chosen model id.

### Changes Required

#### 1. Prompt iteration

**Files**: `src/lib/prompts/**`

**Intent**: After running the wizard end-to-end on 5+ real decisions across all 3 anti-bias techniques, tighten prompts where output is generic, role-played (devil's advocate), present-tense (pre-mortem), or risk-listing (unknown unknowns).

**Contract**: changes confined to prompt builders; no schema or endpoint changes.

#### 2. Latency measurement

**Files**: ad-hoc dev instrumentation (do NOT ship)

**Intent**: Run the wizard 10x; log TTFB + total wall-clock per LLM endpoint. Confirm skeleton is visible within 200 ms and first token within 2 s (or skeleton remains visible until first token). Record p50 / p95.

**Contract**: a markdown table inside `context/changes/wizard-end-to-end/perf-notes.md` (not committed if not warranted; remove after Phase 6).

#### 3. Accessibility pass

**Files**: `src/components/wizard/**`

**Intent**: Verify keyboard navigation across all 6 steps; focus moves to the step header on transition; `<ErrorBanner>` is `aria-live="polite"`; buttons have visible focus rings.

**Contract**: no new components; touch attributes/focus management only.

#### 4. Foundation doc updates

**Files**: `context/foundation/tech-stack.md`, `context/foundation/prd.md`

**Intent**: Replace "Sonnet 4.6" references with the model id actually shipped (`deepseek/deepseek-v4-flash` if verified, else the verified DeepSeek slug). Add a one-paragraph note on the model selection rationale.

**Contract**: edit-in-place; do not restructure these docs.

#### 5. Cross-browser smoke

**Intent**: Manual end-to-end run on Chrome, Safari, Firefox. Stream consumption is the highest-risk area.

#### 6. Edge cases

**Intent**: Manual checks for: empty description, very long description (5k chars), description with markdown syntax, clipboard API blocked (Safari private mode), download in incognito, mid-stream tab background-throttling.

### Success Criteria

#### Automated Verification

- All Phase 1-5 tests still pass
- `npm run lint` clean; no new warnings
- `npm run build` clean

#### Manual Verification

- Full wizard end-to-end completes within an acceptable wall-clock window on a typical broadband connection (note p95 for the slice retro)
- Skeleton always renders before first token, per step
- Keyboard-only run through all 6 steps succeeds
- Screen reader (VoiceOver) announces step transitions + errors
- Chrome + Safari + Firefox produce identical artifacts for the same description
- 5+ decisions saved correctly; Supabase Studio shows rows scoped to the signed-in user
- `tech-stack.md` + `prd.md` no longer reference Sonnet 4.6 (or do so as historical context only)

**Implementation Note**: This is the final phase. After manual confirmation, the slice is ready for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests

- `src/components/wizard/reducer.test.ts` — every action; FR-031 invariant on `REQUEST_FAIL`; `canAdvance` for each step's exit conditions
- `src/lib/wizard/exporter.test.ts` — markdown template snapshot; filename slug rules

### Integration Tests

- Each LLM endpoint (`socratic`, `alternatives`, `anti-bias`, `artifact`): happy-path (200) + 400 (zod) + 401 (no user) + 500 (LLM after retries exhausted, mocked). `/api/decisions` (save): 201 + 400 + 401 + 500 (Supabase INSERT mocked to throw).
- 2-round cap on `/api/wizard/socratic`: 422 when `priorAnswers.round2` is set

### Manual Testing Steps

1. Sign in with an existing email+password account; land on `/dashboard`
2. Click "New decision" → wizard at step 1
3. Type a paragraph-length decision; Continue → step 2 streams Socratic questions
4. Answer all; Continue → conditionally step 2b (round 2) or step 3
5. At step 3, see 3 alternative cards stream in
6. Continue → step 4, pick a technique → markdown streams in
7. Click `I've read this — and I've decided what to do with it.` → Continue enables
8. Continue → step 5 streams the artifact section by section
9. On completion, "Saved" indicator appears; Copy puts markdown on clipboard; Download produces `<slug>.md`
10. Open Supabase Studio → confirm one new row with correct shape
11. Repeat for each anti-bias technique
12. Kill network mid-stream at each step → verify Retry preserves prior data
13. Force save failure → verify Retry-save path works without re-streaming the artifact

## Performance Considerations

- Skeleton renders synchronously on entry to each LLM step — no LLM call required to start the perceived response
- `streamObject` token reveal keeps the user engaged through 7–20 s waits (NFR >2s)
- Retry policy avoids retry storms; exponential backoff + jitter
- `response-healing` plugin gated to terminal endpoint only — small endpoints stay lean
- `onFinish` INSERT runs after the stream completes; user perceives "saved" almost simultaneously with the final token

## Migration Notes

None. No schema changes — F-01 already covers the data layer. Env adds one secret (`OPENROUTER_API_KEY`); set locally via `.dev.vars`, prod via `npx wrangler secret put OPENROUTER_API_KEY`.

## References

- Frame brief: (none for this slice)
- Research: `context/changes/wizard-end-to-end/research.md`
- F-01 deliverables: `supabase/migrations/20260528082724_create_decisions.sql`, `src/types.ts:1-29`
- Reusable React-island patterns: `src/components/auth/{SignInForm,SubmitButton,ServerError,FormField}.tsx`
- Page mount pattern: `src/pages/auth/signin.astro:16`, `src/pages/dashboard.astro:4`
- API endpoint reference pattern: `src/pages/api/auth/signin.ts` (wizard diverges: JSON in/out, status codes)
- Middleware + protected routes: `src/middleware.ts:4,7-22`
- Astro env schema: `astro.config.mjs:17-22`
- PRD: `context/foundation/prd.md` FR-020..031, US-01, US-03
- Roadmap: `context/foundation/roadmap.md:74-86`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations

#### Automated

- [x] 1.1 `npm install` succeeds without peer-warning errors that block CI — 8b7c81b
- [x] 1.2 `npm run build` passes — 8b7c81b
- [x] 1.3 `npm run lint` is clean — 8b7c81b
- [x] 1.4 `astro sync` regenerates `.astro/env.d.ts` and `OPENROUTER_API_KEY` appears in the generated types — 8b7c81b
- [x] 1.5 New schemas in `src/types.ts` type-check (build covers this) — 8b7c81b
- [x] 1.6a `npm test` runs the empty Vitest suite and reports 0 failures (suite present, runner wired) — 8b7c81b
- [x] 1.6b CI step `npm test` runs between lint and build — 8b7c81b

#### Manual

- [x] 1.6 Visiting `/decisions/new` while signed-out redirects to `/auth/signin` — 8b7c81b
- [x] 1.7 Dashboard renders a "New decision" link to `/decisions/new` — 8b7c81b
- [x] 1.8 Setting `OPENROUTER_API_KEY` in `.dev.vars` produces no runtime warning on `npm run dev` — 8b7c81b

### Phase 2: Wizard shell + step 1 (Describe)

#### Automated

- [x] 2.1 `npm run build` passes — 019d4b2
- [x] 2.2 `npm run lint` passes — 019d4b2
- [x] 2.3 Reducer unit test covers `SET_DESCRIPTION`, `GO_TO`, `REQUEST_FAIL` FR-031 invariant, and `canAdvance` for "anti-bias" — 019d4b2

#### Manual

- [x] 2.4 Visiting `/decisions/new` while signed-in renders the wizard with "Step 1 of 6 — Describe" — 019d4b2
- [x] 2.5 Typing a paragraph and clicking Continue advances to a placeholder step 2 — 019d4b2
- [x] 2.6 Empty description shows inline validation error and does not advance — 019d4b2
- [x] 2.7 Clicking Back from step 2 returns to step 1 with the description preserved — 019d4b2
- [x] 2.8 ErrorBanner placeholder renders correctly when state has a synthetic error — bfd4d33

### Phase 3: Socratic endpoint + steps 2a/2b

#### Automated

- [x] 3.1 Endpoint integration test: 200 streaming body for valid request, 401 without session cookie, 400 on malformed JSON, 422 with `priorAnswers.round2` — 6130c75
- [~] 3.2 Schema parse failure on LLM output → 500 with `error.code = "schema_invalid"` — DE-SCOPED at impl-review 2026-05-29; subsumed by Phase 5.1a healing-fallback de-scope (no healing path ships)
- [x] 3.3 `npm run lint` + `npm run build` pass — 6130c75

#### Manual

- [x] 3.4 Step 2 (round 1) streams questions with visible token reveal — 6130c75
- [x] 3.5 Skeleton (4 rows) renders immediately on entry to step 2 — 6130c75
- [x] 3.6 Answering all questions and clicking Continue advances to round 2 iff `needsFollowUp` true, else step 3 — 6130c75
- [x] 3.7 Force `needsFollowUp = false` (via prompt tweak) and confirm direct jump to step 3 — 6130c75
- [x] 3.8 Round-2 cap: manual POST with `priorAnswers.round2` → 422 — 6130c75
- [x] 3.9 Kill the network mid-stream → ErrorBanner with Retry; prior data preserved — bfd4d33
- [x] 3.10 Click Retry → fresh stream, eventual success — bfd4d33

### Phase 4: Alternatives + Anti-bias gate

#### Automated

- [x] 4.1 Alternatives endpoint: 200/400/401/500 paths covered — 4e2df06
- [x] 4.2 Anti-bias endpoint: 200/400/401/500 paths covered; out-of-enum technique → 400 — 4e2df06
- [x] 4.3 Reducer unit test: `GO_TO "artifact"` no-op when `acknowledgedAt === undefined` — 4e2df06
- [x] 4.4 Reducer unit test: `ACKNOWLEDGE_ANTI_BIAS` stamps `data.acknowledgedAt` — 4e2df06
- [x] 4.5 `npm run lint` + `npm run build` pass — 4e2df06

#### Manual

- [x] 4.6 Step 3 streams 3 alternative cards; skeleton visible immediately — 4e2df06
- [x] 4.7 Step 4 picker renders 3 cards; picking one streams markdown into the prose block — 4e2df06
- [x] 4.8 Each technique produces visibly distinct output (sample one decision through all three) — 4e2df06
- [x] 4.9 Continue stays disabled until Acknowledge clicked — 4e2df06
- [x] 4.10 After Acknowledge, Continue advances to step 5 — 4e2df06
- [x] 4.11 Bypass attempt: devtools `GO_TO "artifact"` dispatch → state.step does not change — bfd4d33
- [x] 4.12 Mid-stream failure on either endpoint → Retry path works; prior step data preserved — bfd4d33

### Phase 5: Artifact + terminal endpoint + exports

#### Automated

- [x] 5.1 `/api/wizard/artifact`: 200 streaming body for valid request; 400 invalid body; 401 no session; 500 on stream error — 5bd228e (healing-fallback path de-scoped at impl-review 2026-05-29; see Phase 5.1a note)
- [x] 5.2 `/api/decisions` save: 201 `{ id }` for valid payload; 400 invalid body; 401 no session; 500 on INSERT failure — 5bd228e
- [x] 5.3 `artifactToMarkdown` snapshot test — 5bd228e
- [x] 5.4 `artifactToFilename` test — 5bd228e
- [x] 5.5 `npm run lint` + `npm run build` pass — 5bd228e

#### Manual

- [x] 5.6 Step 5 streams the artifact section-by-section behind the skeleton — 5bd228e
- [x] 5.7 "Saved" indicator with Copy + Download appears on stream completion — 5bd228e
- [x] 5.8 Copy puts well-formed markdown in clipboard (paste-test into a markdown renderer) — 5bd228e
- [x] 5.9 Download produces `<slug>.md` matching the canonical template — 5bd228e
- [x] 5.10 Forced save failure → banner appears; Retry-save POST to `/api/decisions` succeeds without re-streaming — 5bd228e
- [x] 5.11 Saved row visible in Supabase Studio scoped to signed-in `user_id`, with `anti_bias_technique` + `acknowledged_at` — 5bd228e
- [x] 5.12 Second wizard run inserts a second row; rows scoped to the same user only — 5bd228e

### Phase 6: Polish + prompt tuning + p95 + manual smoke

#### Automated

- [x] 6.1 All Phase 1-5 tests still pass — bfd4d33
- [x] 6.2 `npm run lint` clean; no new warnings — bfd4d33
- [x] 6.3 `npm run build` clean — bfd4d33

#### Manual

- [x] 6.4 Full wizard end-to-end completes within an acceptable wall-clock window — bfd4d33
- [x] 6.5 Skeleton always renders before first token, per step — bfd4d33
- [x] 6.6 Keyboard-only run through all 6 steps succeeds — bfd4d33
- [x] 6.7 Screen reader announces step transitions + errors — bfd4d33
- [x] 6.8 Chrome + Safari + Firefox produce identical artifacts for the same description — bfd4d33
- [x] 6.9 5+ decisions saved correctly; Supabase Studio shows rows scoped to the signed-in user — bfd4d33
- [x] 6.10 `tech-stack.md` + `prd.md` no longer reference Sonnet 4.6 (or do so as historical context only) — bfd4d33
