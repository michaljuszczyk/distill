<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Wizard End-to-End (S-02)

- **Plan**: context/changes/wizard-end-to-end/plan.md
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict**: REVISE
- **Findings**: 2 critical · 4 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | FAIL |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

12/12 paths exist; 5/5 symbols present (`PROTECTED_ROUTES`, `context.locals.user`, `envField`, `nodejs_compat`, F-01 zod schemas); brief↔plan consistent after reconciling research's `anthropic/claude-sonnet-4.5` recommendation with plan's user-selected `deepseek/deepseek-v4-flash`. No test runner installed (no `vitest`/`msw`/`@testing-library` in devDeps). `docs/reference/contract-surfaces.md` not present — surface check skipped.

## Findings

### F1 — Terminal endpoint design relies on APIs that don't exist [FIXED via Fix A]

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 5 §1, §Critical Implementation Details, §4 ArtifactStep
- **Detail**: Plan stacks three incompatible claims on the merged stream+save endpoint:
  - (a) `streamObject(...)` returns `toDataStreamResponse()` and appends custom data parts `{ savedId }` / `{ saveError }`. AI SDK reality: `streamObject` exposes `toTextStreamResponse()` only; data parts (`writer.write({ type: 'data-...' })`) are part of the `streamText`/`createUIMessageStream` UI-message protocol, not the object-stream protocol.
  - (b) Client uses `useObject` + a sibling `useDataStream()` or `experimental_dataStream` accessor. AI SDK reality: `useObject` surface = `{ object, submit, onFinish, onError, isLoading, stop, error }`. No data channel. Custom data parts arrive only via `useChat`'s `onData` / `message.parts`.
  - (c) `response-healing` enabled on the streaming endpoint. OpenRouter provider docs: "This feature only works with non-streaming requests." Healing on `/api/decisions` stream mode is silently no-op at best, error at worst.
- **Fix A ⭐ Recommended**: Split terminal into two endpoints, drop healing on stream
  - Approach: `POST /api/wizard/artifact` runs `streamObject`, client consumes via `useObject` `onFinish`. Then client POSTs `{ description, summary, artifact, anti_bias_technique }` to `POST /api/decisions` (JSON in, 201 `{id}` out). Apply `response-healing` to a non-streaming `generateObject` fallback path only, or drop it entirely.
  - Strength: Each surface matches a real AI-SDK API; aligns with existing JSON-in/JSON-out pattern at `src/pages/api/auth/signin.ts`; healing stays available on retry via `generateObject`.
  - Tradeoff: Reintroduces a brief "rendered but unsaved" window (~100-300 ms one Supabase INSERT).
  - Confidence: HIGH — exactly the documented patterns.
  - Blind spot: Save-failure UX needs the same banner+Retry-save path already specified.
- **Fix B**: Rewrite Phase 5 against `streamText` + `createUIMessageStream`
  - Approach: Replace `streamObject` with `streamText` emitting JSON tokens into a `createUIMessageStream` `writer`, then `writer.write({ type: 'data-saved', ... })` from `onFinish`. Client uses `useChat`, parses object out of message parts.
  - Strength: Keeps merged-endpoint topology.
  - Tradeoff: Loses zod-schema enforcement at SDK boundary; hand-rolled partial-object parsing on client; large code surface.
  - Confidence: MED — pattern exists in docs but for chat-shaped UI.
  - Blind spot: Schema-validation error handling becomes manual.
- **Decision**: FIXED (Fix A — split into `/api/wizard/artifact` stream + `/api/decisions` JSON save; healing deferred to optional `generateObject` fallback)

### F2 — Promised tests have no runner installed [FIXED]

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: §Testing Strategy + Phase 2 §3 + Phase 3 §3.1/3.2 + Phase 4 §4.1-4.4 + Phase 5 §5.1-5.4
- **Detail**: Plan calls for ~15 automated tests across 5 phases (reducer unit, endpoint integration via Vitest+MSW, exporter snapshot, filename test). No phase installs `vitest`, `msw`, `@testing-library/react`. Current devDeps: lint/format/husky/wrangler/supabase/typescript only. CI gate runs `astro sync` → lint → build, not tests. Implementer will either skip the test bullets or stop mid-phase to set up Vitest.
- **Fix**: Add a Phase 1 §7 "Test runner setup": install `vitest` + `@testing-library/react` + `jsdom` (or `happy-dom`) + `msw`; add `test` script to package.json; add `vitest.config.ts`; wire CI to run tests. Or scope tests down to a deferred S-04 testing slice and remove all `*.test.ts` Success Criteria from Phases 2-5.
- **Decision**: FIXED (added Phase 1 §7 + Progress 1.6a/1.6b)

### F3 — `priorAnswers` schema drops the questions [FIXED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §4 SocraticRequestSchema + Phase 3 §4 prompt builder
- **Detail**: `SocraticRequestSchema = z.object({ description, priorAnswers: z.object({ round1: z.string().array().optional(), round2: ... }) })` transports only answer strings. Round-2 prompt design and the `needsFollowUp` heuristic ("true only if at least one round-1 answer is < 20 words OR contradicts another") both require the LLM to see which question each answer responded to. Reducer stores `socratic1.questions` + `socratic1.answers` parallel — client has both; wire schema throws away half.
- **Fix**: Change schema to `priorAnswers: z.object({ round1: z.object({ question: z.string(), answer: z.string() }).array().optional(), round2: ... }).optional()` and update `socraticUser(...)` to render Q/A pairs. Server cap on round2 unchanged.
  - Strength: Matches reducer's existing shape; round-2 prompt can reference specific answers; `needsFollowUp` rule becomes implementable.
  - Tradeoff: Wire payload roughly doubles (still tiny).
  - Confidence: HIGH — local to one schema + one prompt builder.
  - Blind spot: None significant.
- **Decision**: FIXED (added `QAPairSchema`; SocraticRequestSchema + Critical Implementation Details updated)

### F4 — Cross-step payload shape unspecified [FIXED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §5 / Phase 4 §5/§6 / Phase 5 §4 step `submit` calls
- **Detail**: Step components pass `submit({ description, socratic, alternatives, technique })`. Shape of `socratic` (questions+answers? answers only? rounds?), `alternatives` (full objects? titles only?), and mapping to Phase 1 §4 request schemas (AlternativesRequestSchema / AntiBiasRequestSchema / ArtifactRequestSchema) is implicit. Phase 1 only says "description + socraticAnswers payload" etc.
- **Fix**: Spell out each request schema in Phase 1 §4 with concrete fields (e.g. `socratic: z.object({ round1: z.object({question, answer}).array(), round2: ....optional() })`, `alternatives: AlternativeSchema.array().length(3)`) so step components and endpoints stay in lock-step.
- **Decision**: FIXED (added `SocraticPayloadSchema`; AlternativesRequest/AntiBiasRequest/ArtifactRequest given concrete shapes)

### F5 — Plugin/provider syntax in plan doesn't match SDK [FIXED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §1 (`providerOptions: { openrouter: { plugins: { "response-healing": true } } }`); §Implementation Approach (`allow_fallbacks: true` on body)
- **Detail**: Documented API: plugins are configured at model construction — `openrouter('slug', { plugins: [{ id: 'response-healing' }] })`; fallbacks via `provider: { allow_fallbacks: true }` at model construction, not as a top-level body field. Plan's `providerOptions.openrouter.plugins` object-map and body-level `allow_fallbacks` are not supported shapes.
- **Fix**: Construct a second model handle in the retry helper when 529 hits: `openrouter(slug, { provider: { allow_fallbacks: true } })`. Drop the `providerOptions.openrouter.plugins` snippet (largely moot if F1 lands).
- **Decision**: FIXED (llm-retry contract updated; F1 already dropped streaming-plugin snippet; §Implementation Approach updated)

### F6 — DeepSeek slug verification deferred into impl phase [ACCEPTED]

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: §Key Discoveries (model id), Phase 1 §1, Phase 6 §4, brief §Open Risks
- **Detail**: Plan + brief both acknowledge `deepseek/deepseek-v4-flash` is unverified and defer the check to Phase 1 impl. Latency/quality budget was sized for Sonnet 4.5; if the slug 404s and falls back, Phase 6 p95 numbers and anti-bias prompt quality can swing materially. PRD references "Sonnet 4.6" — nothing in the plan blocks shipping with a model that bears little relation to it.
- **Fix**: Resolve the slug before plan freeze. One `curl https://openrouter.ai/api/v1/models | jq '.data[] | select(.id | startswith("deepseek/"))'` answers it. Lock the verified slug into Phase 1 §1 + `src/lib/openrouter.ts` Contract; pre-update PRD/tech-stack model reference in Phase 6 §4 with the locked slug.
  - Strength: Removes known unknown from critical path; calibrates Phase 6 latency budget correctly; keeps the Sonnet 4.6 → DeepSeek transition visible upstream.
  - Tradeoff: Five-minute plan tweak before `/10x-implement`.
  - Confidence: HIGH — slug check is a one-shot HTTP call.
  - Blind spot: Picking the right DeepSeek tier on quality without trial-running prompts — Phase 6 still owns that.
- **Decision**: ACCEPTED (risk acknowledged; verification stays in Phase 1)

### F7 — `react-markdown` "sanitized by default" framing is loose [FIXED]

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §6 contract
- **Detail**: `react-markdown` doesn't sanitize — it disables raw HTML by default (no `rehype-raw`). With trusted LLM output as the input source the XSS surface is small, but "sanitized by default" reads as a security claim that would silently disappear if a future change enables `rehype-raw`.
- **Fix**: Reword to "raw HTML disabled by default; do not enable `rehype-raw` without adding `rehype-sanitize`."
- **Decision**: FIXED (Phase 4 §6 wording updated)
