---
date: 2026-05-28T11:23:23+02:00
researcher: Michal Juszczyk
git_commit: 74386febdbc31fcdc58493bc697c8ca0c44c736f
branch: main
repository: distill
topic: "Wizard end-to-end (S-02): LLM integration, state + recovery, data + auto-save, anti-bias methods"
tags: [research, codebase, wizard, llm, openrouter, anti-bias, state-machine, supabase]
status: complete
last_updated: 2026-05-28
last_updated_by: Michal Juszczyk
---

# Research: Wizard end-to-end (S-02)

**Date**: 2026-05-28T11:23:23+02:00
**Researcher**: Michal Juszczyk
**Git Commit**: 74386febdbc31fcdc58493bc697c8ca0c44c736f
**Branch**: main
**Repository**: distill

## Research Question

Comprehensive plan-ready research for change `wizard-end-to-end` (north-star slice S-02). Investigate four dimensions before `/10x-plan`:

1. **LLM integration** — OpenRouter wiring on Cloudflare Workers, structured output, streaming for the >2s NFR, retries.
2. **Wizard state + recovery** — multi-step React-island state machine, FR-031 in-memory recovery contract, FR-030 anti-bias gate at the UI.
3. **Data + auto-save** — how F-01 schema/DTOs/RLS connect to FR-027 auto-save and FR-030 audit trail at the data layer.
4. **Anti-bias methods** — golden-standard prompt patterns for devil's advocate / pre-mortem / unknown unknowns, plus v2 candidates and acknowledgment-copy proposals.

Scope: comprehensive, current code only (history not re-mined). Roadmap context: `context/foundation/roadmap.md:33,74-86`. PRD context: `context/foundation/prd.md` (FR-020..031, US-01..03).

## Summary

S-02 is buildable today on the existing F-01 foundation with no schema change. The headline decisions:

- **LLM library**: install `ai` + `@ai-sdk/react` + `@openrouter/ai-sdk-provider`. Use `streamObject({ schema })` for steps 2–5, JSON `Response` for any small calls. Workers-compatible (Web `fetch` + `ReadableStream`). Add `OPENROUTER_API_KEY` to `astro.config.mjs:18-21` env schema; prod secret via `wrangler secret put`.
- **Model id**: PRD/tech-stack reference "Sonnet 4.6", but OpenRouter only documents `anthropic/claude-sonnet-4.5` today (no 4.6 slug visible in `mcp__context7` corpus). Plan-time action: query live `GET /api/v1/models` before locking; fall back to `anthropic/claude-sonnet-4.5` or the floating `~anthropic/claude-sonnet-latest`.
- **State**: single React island, `useReducer`, discriminated-union step type. No `localStorage`, no `sessionStorage`, no per-step DB autosave — FR-031 is in-memory recovery only, satisfied by the reducer surviving an LLM failure inside the still-mounted component.
- **Endpoints**: 4 POST routes under `src/pages/api/wizard/*` (one of them is `/api/decisions` for the terminal artifact+save). Each `prerender = false`, zod-validated, gates on `context.locals.user`, returns JSON or a streamed `Response`.
- **Anti-bias gate**: UI disables the "Continue" button until an explicit acknowledgement click sets `data.acknowledgedAt`. Data-layer gate is independent — `NewDecisionInputSchema` (`src/types.ts:15-20`) refuses inserts missing `anti_bias_technique`; DB CHECK constraint (`supabase/migrations/20260528082724_create_decisions.sql:12-13`) plus default-`now()` on `acknowledged_at` (line 14) give the audit trail without a client-supplied timestamp.
- **Auth gate**: page-side handled via `PROTECTED_ROUTES` (add `"/decisions"` at `src/middleware.ts:4`); API-side via inline `context.locals.user` check returning JSON 401. Do not add APIs to `PROTECTED_ROUTES` — middleware redirects to `/auth/signin`, which is wrong for an API caller.
- **Anti-bias prompts**: Nemeth's authenticity rule kills role-play language — system prompts must say "you believe this," not "you are playing the role of." Pre-mortem prompts must use past tense + certainty. Unknown-unknowns must surface assumptions, blind-spots, and unasked questions — not just risks.

One unresolved tension between the two technical reports — see [§Open decisions](#open-decisions-for-10x-plan).

## Detailed Findings

### Baseline available from F-01

Already on disk; the wizard plugs into this without modification.

- **Schema** (`supabase/migrations/20260528082724_create_decisions.sql:6-35`): single `public.decisions` table — `id` (uuid), `user_id` (FK to `auth.users`), `description`, `summary`, `artifact` (JSONB, no shape constraint at DB), `anti_bias_technique` (text + CHECK to 3-enum), `acknowledged_at` (default `now()`), `created_at` (default `now()`). RLS on, only `select_own` + `insert_own` policies — UPDATE/DELETE deliberately unsupported (immutability).
- **DTOs + zod** (`src/types.ts:1-29`): `AntiBiasTechniqueSchema` enum, `ArtifactSchema` (5 required sections, each `.min(1)`), `NewDecisionInputSchema`, `Decision` type. The insert payload shape exactly matches the migration's non-default columns.
- **SSR Supabase client** (`src/lib/supabase.ts:5-24`): cookie-bridge SSR client; returns `null` if env not set.
- **Middleware** (`src/middleware.ts:6-25`): refreshes session every request, sets `context.locals.user`, redirects unauth from `PROTECTED_ROUTES`.
- **API endpoint pattern** (`src/pages/api/auth/signin.ts:1-21`): FormData-based, redirect-style. The wizard's terminal endpoint will diverge — JSON in, JSON out, status codes (see Data §4).
- **React-island pattern** (`src/components/auth/SignInForm.tsx`, `SubmitButton.tsx`, `ServerError.tsx`, `FormField.tsx`): the existing pending-spinner + inline-error idioms are reusable verbatim.
- **Astro config** (`astro.config.mjs:10-22`): `output: "server"`, Cloudflare adapter, `envField` schema with `context: "server", access: "secret"`. `OPENROUTER_API_KEY` slots in here.

No `src/hooks/`, no AI SDK, no `wizard_runs` table. Package.json has zod 4.4.3, no state-management lib.

### 1. LLM integration (OpenRouter on Cloudflare Workers)

**Library decision.** Install `ai` + `@ai-sdk/react` + `@openrouter/ai-sdk-provider`. Reasons: Workers-compatible (Web `fetch` only, no Node streams in the hot path), removes hand-rolled SSE parsing, integrates with existing zod schemas via `generateObject` / `streamObject`. The raw-fetch path (`POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer …`) is the fallback if dependency aversion wins, but pays significant complexity tax for streaming + structured output.

**Model id.** OpenRouter currently documents `anthropic/claude-sonnet-4` and `anthropic/claude-sonnet-4.5` (sources cited in agent report — `openrouter.ai/docs/agent-sdk/call-model/message-formats`). No `claude-sonnet-4.6` slug surfaced in the docs corpus. Plan-time: hit `GET https://openrouter.ai/api/v1/models` directly to verify; if 4.6 is live, use it; else fall back to `anthropic/claude-sonnet-4.5` or the floating `~anthropic/claude-sonnet-latest`. Tech-stack reference to 4.6 should be updated to whatever ships.

**Structured output.** Use `generateObject({ model, schema })` / `streamObject({ model, schema })` from the AI SDK with the existing zod schemas. The provider drives Anthropic via tool-use under the hood, which is the most reliable structured-output channel for Claude on OpenRouter today (better adherence than `response_format: json_schema`). Enable the `response-healing` plugin for the Artifact step (largest schema, most likely to malform). Add the Anthropic `fine-grained-tool-streaming-2025-05-14` beta header for big JSON to reduce TTFB.

**Streaming (NFR >2s).** Estimated wall-clock for Sonnet 4.5 at 500–1000 output tokens: 7–20 s (TTFB ~700–1500 ms, ~55–85 tok/s). Steps 2 (Socratic Qs), 3 (alternatives), 4 (anti-bias), 5 (artifact) all exceed 2 s. Use `streamObject` + `result.toTextStreamResponse()` from the API endpoint; consume on the client with `useObject` from `@ai-sdk/react` (surfaces a growing partial object + `isLoading`). Step 1 (description) does not call the LLM. Any small classifier call ≤1 s can stay non-streaming with a spinner.

**Error / retry.** Retryable: 429, 500/502/503, 524, 529. Non-retryable: 400/401/402/403/404/422. Recommended: exponential backoff 500 ms → 1500 ms → 4000 ms with jitter, max 3 attempts; on 529 add `allow_fallbacks: true` to body so OpenRouter routes to a backup provider for the same model; honour `Retry-After` on 429. Surface the original `error.code` to the island so it can render typed copy ("Anthropic is busy, retry?") rather than a generic failure.

**Server-side call placement.** Every LLM call goes through `src/pages/api/wizard/*.ts` — the React island never sees `OPENROUTER_API_KEY`. Each endpoint: `prerender = false`, zod-parse the body, gate on `context.locals.user`, read the secret from `astro:env/server`, return a JSON or streamed `Response`. Matches the established API pattern.

**Wrangler note.** `wrangler.jsonc` already enables `nodejs_compat`, covering occasional Node shims in the SDK; OpenRouter provider stays on Web `fetch` + `ReadableStream`.

### 2. Wizard state + recovery (single React island)

**Why one island.** An Astro re-render between steps tears down the React component tree → reducer state lost → contradicts FR-031. Mount one `<WizardApp client:load />` from a single Astro page; all step UIs are sub-components that render off `state.step`. The Astro page does layout + auth check only (mirrors `src/pages/dashboard.astro:4`).

**State shape** (discriminated, monotonically built):

```ts
export interface SocraticRound {
  questions: string[];        // 3-6, LLM-determined N
  answers: string[];          // user-typed, parallel to questions
}
export interface Alternative {
  title: string;
  pros: string[];
  cons: string[];
}
export type WizardError =
  | { kind: "llm"; message: string }
  | { kind: "network"; message: string }
  | { kind: "validation"; field?: string; message: string };

export interface WizardData {
  description: string;
  socratic1?: SocraticRound;
  socratic2?: SocraticRound;          // optional; total round cap = 2
  alternatives?: Alternative[];        // always 3 (FR-024)
  antiBiasTechnique?: AntiBiasTechnique;
  antiBiasOutput?: string;
  acknowledgedAt?: number;             // gate token (FR-030)
  artifact?: Artifact;                 // ArtifactSchema, src/types.ts:6
  summary?: string;
  savedDecisionId?: string;
}

export type WizardStep =
  | "describe" | "socratic-1" | "socratic-2"
  | "alternatives" | "anti-bias" | "artifact";

export type WizardState = {
  step: WizardStep;
  data: WizardData;
  pending: boolean;
  error: WizardError | null;
};
```

`Artifact` + `AntiBiasTechnique` reuse the existing zod-inferred types from `src/types.ts:3,13` — no parallel definitions.

**State primitive: `useReducer`.** Justification: 8+ fields, step-typed transitions, atomic `pending`/`error`/`data` updates, zero dependencies (matches CLAUDE.md `<simplicity_first>`). Zustand / XState are not justified for one island with no cross-component sharing.

**Reducer action surface** (minimal):

```ts
type Action =
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "GO_TO"; step: WizardStep }
  | { type: "REQUEST_START" }                                // pending=true, error=null
  | { type: "REQUEST_FAIL"; error: WizardError }             // pending=false, data INTACT
  | { type: "SOCRATIC_LOADED"; round: 1 | 2; questions: string[] }
  | { type: "SOCRATIC_ANSWER"; round: 1 | 2; index: number; value: string }
  | { type: "ALTERNATIVES_LOADED"; alternatives: Alternative[] }
  | { type: "PICK_TECHNIQUE"; technique: AntiBiasTechnique }
  | { type: "ANTI_BIAS_LOADED"; output: string }
  | { type: "ACKNOWLEDGE_ANTI_BIAS" }                        // stamps acknowledgedAt
  | { type: "ARTIFACT_LOADED"; artifact: Artifact; summary: string }
  | { type: "SAVED"; decisionId: string };
```

`REQUEST_FAIL` MUST NOT clear `data`. That is FR-031 in code.

**FR-031 contract.** Survives (in-memory only, while island mounted): description, all socratic answers, alternatives, technique, antiBiasOutput, acknowledgedAt, artifact. Lost (acceptable): refresh, tab close, navigation. Error-state UI table:

| Trigger | Render | State effect |
|---|---|---|
| LLM failed for current step | Reuse `auth/ServerError.tsx` banner + `Retry` button | `pending=false`, `error.kind="llm"`, `data` intact |
| Network down | Same banner copy "Connection lost — try again" | `error.kind="network"`, `data` intact |
| Client validation (empty answer) | Inline `FormField` error | No dispatch; state untouched |
| Save fails on step 5 | Banner + `Retry save`; artifact still cached | `error.kind="network"`, artifact preserved |

`Retry` re-issues the same fetch via `REQUEST_START`. A successful retry overlays the new LLM output.

**FR-030 anti-bias gate (UI).** After the LLM output renders on step 4, "Continue" stays `disabled` until the user clicks an explicit affordance ("I've read this — continue"-style copy). The click dispatches `ACKNOWLEDGE_ANTI_BIAS`, setting `data.acknowledgedAt = Date.now()`. Reducer refuses any `GO_TO "artifact"` while `acknowledgedAt` is undefined:

```ts
const canAdvance = state.step === "anti-bias"
  && state.data.antiBiasOutput !== undefined
  && state.data.acknowledgedAt !== undefined;
```

**Pending UX (NFR >2s).** Two-layer:
- Sub-2s feedback: lift the existing `SubmitButton` spinner idiom (`src/components/auth/SubmitButton.tsx:12,20-22`) to be driven by `state.pending` instead of `useFormStatus`.
- >2s streamed content: a thin `<StreamingPanel>` consumes a `ReadableStream<string>` (from `useObject`), shows a typing-dots row before first chunk lands, then replaces with growing token text. Skeletons for structured outputs (3 alternative cards, N Socratic rows) cover the structural gap.

### 3. Data + auto-save (terminal endpoint)

**Auto-save shape (FR-027).** Single INSERT against `public.decisions`. Columns map 1:1 to `NewDecisionInputSchema` + server-supplied `user_id`; `id`, `acknowledged_at`, `created_at` fill via DB defaults.

```ts
const { data, error } = await supabase
  .from("decisions")
  .insert({
    description: input.description,
    summary: input.summary,
    artifact: input.artifact,
    anti_bias_technique: input.anti_bias_technique,
    user_id: context.locals.user.id,
  })
  .select("id")
  .single();
```

**RLS.** `auth.uid()` resolves correctly because the SSR client (`src/lib/supabase.ts:9-23`) is cookie-bridged and middleware refreshes the session on every request. `decisions_insert_own` (`migration:31-35`) passes when `user_id = context.locals.user.id`. UPDATE/DELETE policies don't exist → Postgres denies → immutability is enforced at the data layer per PRD §FR-032 / Non-Goals.

**Audit trail (FR-030) — let the DB default fire.** Saves are immediate-on-completion (one POST at wizard end), so DB `now()` is within milliseconds of the click. Passing a client timestamp adds trust surface + clock-skew without audit gain. `NewDecisionInputSchema` (`src/types.ts:15-20`) deliberately omits `acknowledged_at` — keep it that way. If a later slice splits acknowledge from save (e.g. draft autosave), revisit.

**Final endpoint (JSON in / JSON out)** — diverges from FormData auth pattern because the payload is structured (nested arrays in `artifact`):

```ts
// src/pages/api/decisions/index.ts
export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "supabase_unconfigured" }), { status: 500 });
  }

  let raw: unknown;
  try { raw = await context.request.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 }); }

  const parsed = NewDecisionInputSchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "invalid_input", issues: parsed.error.issues }), { status: 400 });
  }

  const { data, error } = await supabase
    .from("decisions")
    .insert({ ...parsed.data, user_id: context.locals.user.id })
    .select("id")
    .single();
  if (error) {
    return new Response(JSON.stringify({ error: "insert_failed" }), { status: 500 });
  }
  return new Response(JSON.stringify({ id: data.id }), { status: 201 });
};
```

**Auth-gate boilerplate.** Inline for S-02 (one terminal endpoint + 3 LLM endpoints — 4 sites). When count grows, extract `src/lib/api-auth.ts` with `requireUser(context): Response | { user }`. CLAUDE.md `<simplicity_first>` says don't preemptively extract.

**Route paths + middleware.** Wizard lives at `/decisions/new`. Read view (S-03) at `/decisions/[id]`. Update `src/middleware.ts:4`:

```ts
const PROTECTED_ROUTES = ["/dashboard", "/decisions"];
```

`startsWith` covers `/decisions`, `/decisions/new`, `/decisions/[id]` in one entry. **Do NOT add `/api/decisions` or `/api/wizard` to `PROTECTED_ROUTES`** — middleware redirects to `/auth/signin` (302 to HTML), which is wrong for an API caller. APIs self-gate.

**JSONB roundtrip.** Insert path: object-in, JSONB-stored, lossless. S-02 only INSERTs (no read-back of artifact beyond `.select("id")`), so the `supabase-js` `Json` recursive-union type is not a problem here. S-03's read path will `ArtifactSchema.parse(row.artifact)` to narrow. Not S-02's job.

**CSRF.** Not adding middleware. Supabase cookies are `HttpOnly` + `SameSite=Lax`; the JSON content-type expectation in the endpoint (`request.json()` throws on form-encoded) doubles as a weak CSRF shield against `<form>` cross-site submits. Revisit if a public surface is added later. PRD `main_goal=speed`.

### 4. Anti-bias methods (FR-025 prompt design)

Three techniques the user picks from; LLM runs the chosen one against (description + Socratic Q&A + 3 alternatives). Prompt design is load-bearing because the wedge is anti-bias *as a forced step* — weak output erodes the wedge.

**Devil's advocate — Nemeth's authenticity rule.** Do NOT instruct the model to announce role-play. Charlan Nemeth (UC Berkeley, EJSP 2001 — https://onlinelibrary.wiley.com/doi/abs/10.1002/ejsp.58, PDF http://charlannemeth.com/wp-content/uploads/2017/03/DA1.pdf) shows role-played dissent produces cognitive bolstering of the original view, not divergent thinking. The model must state the strongest opposing case *as if it believes it*. Forbid the strings "I am playing," "for the sake of argument," "hypothetically," "let's pretend" in the system prompt. Output: 3–5 named counter-arguments, each with (a) failure mechanism, (b) evidence that would change the decision.

**Pre-mortem — past tense + certainty.** Gary Klein, HBR 2007 (https://hbr.org/2007/09/performing-a-project-premortem). Prompt opens "It is [6 months / 1 year] from today. The decision the user just made has failed badly. Write the failure story in past tense." Prospective hindsight increases correctly-identified causes by ~30% (Mitchell/Russo/Pennington 1989 — https://onlinelibrary.wiley.com/doi/10.1002/bdm.3960020103). Output: 3–5 ranked failure modes, leading indicator per mode, one mitigation per mode. Failure mode to guard against: "what *might* go wrong" framing collapses pre-mortem into generic risk-listing.

**Unknown unknowns — assumptions + blind-spots + unasked questions.** Hardest to prompt well. LLM's natural failure is to list risks, which are known unknowns by definition. Output structure mirrors the Rumsfeld matrix: (1) **Hidden assumptions** — 2–3 things the user treats as fact that are unverified beliefs; (2) **Domain blind spots** — 2 categories of consideration relevant to this decision type that don't appear in input; (3) **Questions not yet asked** — 2 questions the user would benefit from answering but hasn't. Adjacent canon: CIA Tradecraft Primer's Key Assumptions Check (https://www.cia.gov/resources/csi/static/Tradecraft-Primer-apr09.pdf), Heuer's *Psychology of Intelligence Analysis* (https://www.cia.gov/resources/csi/static/Pyschology-of-Intelligence-Analysis.pdf), Phoenix Checklist.

**Cross-cutting prompt-design rules.**

- **Length**: 300–500 words, 3–5 named items. Shorter feels dismissive; longer is skim-bait.
- **Voice**: second person, diagnosis first ("Three reasons this fails:" not "Let me play devil's advocate"). No hedges in the first sentence of each item.
- **Tense**: past for pre-mortem, present for devil's advocate, conditional-imperative for unknown unknowns.
- **Markdown shape**:
  - `## <Technique title>` (NOT "I will play X")
  - One-sentence orienting line
  - 3–5 H3 headings, each one named failure/blind-spot/assumption
  - 2–4 sentence body each
  - Closing: "If you still want to proceed, here is what changed: ___." — forces the user to articulate a shift on the acknowledgment step.
- **System-prompt authenticity clause**: "You believe this. Argue from belief, not from role."

**Acknowledgment-step copy candidates** (PRD US-03 requires deliberate, not dismissive):

1. "I've read this — and I've decided what to do with it." *(strongest; forces an internal answer)*
2. "Read. Continue." *(minimal, ceremonial)*
3. "I've considered this and I'm continuing the decision." *(explicit verb pair)*

Avoid: "OK", "Got it", "Continue", "Next".

**v2 candidates (parked for now)**: Six Thinking Hats (group-shaped, too elaborate for solo wizard), WRAP (Heath brothers — umbrella, already partially covered by other steps), 10/10/10 rule (too lightweight to anchor a forced step), reference-class forecasting (data-hungry), Red/Blue Team (requires two teams), steel-manning (clean complement to devil's advocate — strongest v2 candidate), Analysis of Competing Hypotheses (too heavy for one screen).

## Code References

- `src/types.ts:3` — `AntiBiasTechniqueSchema` (enum source of truth)
- `src/types.ts:6-12` — `ArtifactSchema` (5 sections, each `.min(1)`)
- `src/types.ts:15-20` — `NewDecisionInputSchema` (terminal-endpoint input)
- `src/types.ts:23-28` — `Decision` (read-side shape; S-03's domain)
- `supabase/migrations/20260528082724_create_decisions.sql:6-16` — table shape, CHECK on `anti_bias_technique`, default `now()` on `acknowledged_at`
- `supabase/migrations/20260528082724_create_decisions.sql:21-35` — RLS, `select_own` + `insert_own` policies (no UPDATE/DELETE → immutable)
- `src/lib/supabase.ts:5-24` — SSR client factory (cookie-bridged)
- `src/middleware.ts:4,7-22` — session refresh + `PROTECTED_ROUTES`
- `src/env.d.ts:1-5` — `Locals.user` typing
- `src/pages/api/auth/signin.ts:1-21` — current API-endpoint pattern (FormData; wizard diverges to JSON)
- `src/pages/dashboard.astro:4` — `Astro.locals.user` page-level access pattern
- `src/pages/auth/signin.astro:16` — React-island mount pattern (replicate for `/decisions/new`)
- `src/components/auth/SubmitButton.tsx:12,20-22` — pending-spinner idiom (lift away from `useFormStatus`)
- `src/components/auth/ServerError.tsx:7` — reusable error banner
- `src/components/auth/SignInForm.tsx:18-40` — inline validation idiom
- `src/components/ui/button.tsx:35` — shadcn `Button` (use as-is)
- `astro.config.mjs:11,16` — `output: "server"` + Cloudflare adapter
- `astro.config.mjs:17-22` — `envField` schema (add `OPENROUTER_API_KEY` here)
- `package.json:14-36` — confirms no AI SDK / state lib installed; zod 4.4.3 present
- `wrangler.jsonc` — Workers config; `nodejs_compat` already on (per LLM agent report)

## Architecture Insights

- **Two independent enforcement layers for the wedge.** UI gate (reducer refuses `GO_TO "artifact"` without `acknowledgedAt`) is for UX; DB CHECK + `not null` on `anti_bias_technique` + `acknowledged_at` is the correctness floor. Either alone is insufficient: UI alone is bypassable by a crafted request; DB alone produces a broken UX. Both are cheap, both ship.
- **One-island wizard maps directly to FR-031.** The reducer state is the contract — "what survives an LLM error" is literally "whatever the still-mounted React component is holding." No serialization to localStorage, no DB autosave per step. This collapses an entire category of complexity (resume tokens, draft rows, race conditions on partial state). Cost: a browser refresh loses the wizard. PRD accepts this trade.
- **Auth split: pages via middleware, APIs via inline check.** Adding APIs to `PROTECTED_ROUTES` would return 302 to HTML for an API caller — wrong content type, breaks the fetch path. The current middleware (`src/middleware.ts:13-22`) already does the right thing by setting `context.locals.user` for all requests, including API ones, so the inline JSON-401 path has the user available without redundant setup.
- **JSON at the wizard API boundary, FormData stays at auth.** The auth endpoints stay FormData because they're plain form submits with redirects (`signin.ts:5,11-19`). The wizard's structured payload (nested arrays in `artifact`) is JSON-native — diverge cleanly. This is not refactor pressure; it's two different transport choices for two different surfaces.
- **Server is the single LLM caller.** No `OPENROUTER_API_KEY` ever reaches the React island. Every LLM call goes through `src/pages/api/wizard/*.ts`. Streaming responses (`text/event-stream` or chunked plain) flow back to the island via `useObject`. This satisfies both the Cloudflare Workers runtime constraint and the secret-handling rule.
- **The 4-endpoint API surface, not 6.** Socratic round 1 and round 2 take the same input shape (description + prior answers) and return the same output shape — collapse them under `/api/wizard/socratic` with `priorRound` as an optional body field; server enforces the 2-round cap. Artifact generation and save collapse into one endpoint to avoid the "on-screen but not in DB" failure window.

## Open Decisions for `/10x-plan`

These need a one-line resolution at plan time. None blocks the slice.

1. **Model id**: lock to `anthropic/claude-sonnet-4.5` *or* verify `4.6` is live on OpenRouter (`GET /api/v1/models`) and lock that *or* use floating `~anthropic/claude-sonnet-latest`. Recommend the live-check + versioned pin.
2. **API endpoint count**: 4 endpoints (`socratic`, `alternatives`, `anti-bias`, `artifact-and-save` → the last lives at `/api/decisions`) vs splitting `artifact` from `save`. Recommend the merged terminal endpoint — single network call, no on-screen-but-unsaved window, fewer failure modes.
3. **Conflict: wizard_runs draft row vs no-DB-autosave.** The LLM-integration agent suggested a `wizard_runs` Supabase row written *before* the LLM call to make the wizard fully resumable across refresh. **The wizard-state agent and PRD FR-031 explicitly forbid this** ("in-memory recovery only; refresh acceptably blows in-progress state"). **Recommend: no `wizard_runs` table.** Keep the slice as scoped — refresh loses state, by design.
4. **Auth-helper extraction**: `requireUser` helper or 4 inline copies. Recommend inline for S-02 (4 sites), extract when count hits 6+.
5. **Acknowledgment copy**: pick one of the three candidates ("I've read this — and I've decided what to do with it." is strongest by Nemeth's reasoning) or A/B for a single launch. Recommend pick one and ship.
6. **Streaming protocol**: AI SDK's `result.toTextStreamResponse()` + `useObject` (recommended) vs hand-rolled SSE. Recommend SDK path.
7. **`response-healing` plugin**: enable for the artifact endpoint only (largest schema) vs all endpoints. Recommend artifact-only — keeps small endpoints lean, healing is most valuable where malformed JSON is most likely.
8. **Beta header `fine-grained-tool-streaming-2025-05-14`**: opt-in vs skip. Recommend opt-in for the artifact endpoint to reduce TTFB on the longest output.
9. **PRD/tech-stack note about Sonnet 4.6**: needs updating to whatever actually ships. Plan-time, not research-time.

## Historical Context (from prior changes)

Not re-mined per user scoping ("current state only"). The F-01 deliverables in the live code are the contract; see `Code References` above and `context/foundation/roadmap.md:142-144` (Done entry pointing to `context/archive/2026-05-28-data-foundation/`).

## Related Research

- `context/foundation/prd.md` — FR-020..031, US-01..03, NFR ">2s shows progress"
- `context/foundation/roadmap.md:33,74-86` — S-02 slice definition + listed unknowns
- `context/foundation/tech-stack.md` — OpenRouter + Sonnet 4.6 reference (revisit model id at plan time)

## Open Questions

None blocking. The "open decisions" list above is the queue for `/10x-plan` to resolve in one pass.
