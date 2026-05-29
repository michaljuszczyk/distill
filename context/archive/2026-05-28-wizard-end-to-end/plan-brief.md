# Wizard End-to-End (S-02) — Plan Brief

> Full plan: `context/changes/wizard-end-to-end/plan.md`
> Research: `context/changes/wizard-end-to-end/research.md`

## What & Why

Ship the 6-step Distill wizard end-to-end: from description → Socratic Qs (up to 2 rounds) → 3 alternatives → user-picked anti-bias technique (acknowledged) → streamed structured artifact → auto-save + copy/download. This is the north-star slice (S-02): the moment the product becomes usable by a real deliberate-decider, and the slice that proves the FR-030 anti-bias wedge actually gates progress.

## Starting Point

F-01 (archived `2026-05-28-data-foundation`) shipped the `decisions` table with RLS + immutability and the shared `src/types.ts` zod DTOs (`ArtifactSchema`, `NewDecisionInputSchema`, `AntiBiasTechniqueSchema`). The app has Astro SSR + Cloudflare adapter, Supabase SSR client cookie-bridged, middleware that resolves `context.locals.user` and gates `/dashboard`, an email+password auth flow, and one shadcn button. No AI SDK, no wizard route, no LLM calls, no `wizard_runs` table.

## Desired End State

A signed-in user clicks "New decision" on `/dashboard`, completes all 6 steps, watches a structured artifact stream in section by section, sees a "Saved" indicator, copies the artifact to clipboard or downloads it as `<slug>.md`, and finds the decision in Supabase Studio scoped to their `user_id` with `anti_bias_technique` and `acknowledged_at` populated. Mid-wizard LLM failures show an inline Retry banner without wiping prior step answers; closing the tab is acceptably lossy.

## Key Decisions Made

| Decision                              | Choice                                                                            | Why (1 sentence)                                                                                  | Source   |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| LLM library                           | `ai` + `@ai-sdk/react` + `@openrouter/ai-sdk-provider`                            | Workers-compatible streaming with zod schemas; no hand-rolled SSE                                  | Research |
| Model id                              | `deepseek/deepseek-v4-flash` (verify slug in Phase 1)                             | User selection diverges from PRD/tech-stack Sonnet 4.6; slug to be verified against OpenRouter      | Plan     |
| API endpoint shape                    | 4 endpoints; artifact + save merged at `/api/decisions`                            | No on-screen-but-unsaved window; collapses Socratic round 1+2 into one route                       | Plan     |
| Streaming protocol                    | AI SDK `streamObject` + `useObject`                                               | Workers-compat; reuses zod schemas; built-in structured-output + healing                          | Plan     |
| Mid-wizard draft persistence          | NONE — in-memory only                                                             | Matches FR-031 exactly; no new schema; refresh blows in-progress state by design                  | Research |
| State primitive                       | Single React island + `useReducer`                                                | 8+ fields, step-typed transitions, atomic pending/error/data; no deps                              | Research |
| Acknowledgment copy                   | "I've read this — and I've decided what to do with it."                            | Strongest by Nemeth's authenticity reasoning; forces an internal answer                            | Plan     |
| Socratic UI                           | All questions on one screen                                                       | Reuses existing FormField idiom; one network round-trip                                            | Plan     |
| Save-failure UX                       | Show artifact, banner above with Retry save                                       | Preserves work even if save fails; matches existing ServerError banner                            | Plan     |
| Markdown export shape                 | H1 + H2 per section + bullets + summary footer                                    | Renders well in GitHub/Obsidian/Notion; mirrors on-screen structure                                | Plan     |
| Socratic round-2 trigger              | LLM returns `{questions, needsFollowUp}`; server enforces cap=2                   | One endpoint, no client-side heuristic; FR-023's "app's generator decides" honored                | Plan     |
| Retry + healing                       | Exp backoff 500/1500/4000ms; healing on `/api/decisions` only                     | Targets healing where malformed JSON is most likely; keeps small endpoints lean                    | Research |
| Pending UX                            | Skeletons + streamed token reveal                                                 | Best perceived performance; structural cue before tokens                                          | Plan     |
| Entry point                           | Dashboard "New decision" button → `/decisions/new`                                | Discoverable; tiny diff; S-03 will replicate on list view later                                   | Plan     |
| Wizard chrome                         | Numbered "Step N of 6" header + Back to prior steps                               | Clear orientation; reuses state without forward-skip complexity                                   | Plan     |
| Schemas location                      | Extend `src/types.ts` with grouped wizard schemas                                  | Single source of truth; matches F-01 pattern                                                      | Plan     |
| Anti-bias picker UI                   | 3 selectable cards with 1-line description each                                    | Educates the user; matches deliberate-not-dismissive wedge intent                                 | Plan     |
| Auth-helper extraction                | NONE — 4 inline `context.locals.user` checks                                       | Below threshold for refactor pressure; CLAUDE.md `<simplicity_first>`                              | Research |

## Scope

**In scope:**
- 4 API endpoints under `src/pages/api/wizard/*` + `src/pages/api/decisions/index.ts`
- 1 Astro page (`/decisions/new`) + 1 dashboard CTA
- Single React island (`WizardApp`) with `useReducer` + 6 step components + chrome
- Streaming UX (skeletons + `useObject` partial-object reveal)
- Anti-bias wedge enforcement at UI layer (DB layer already enforced by F-01)
- Clipboard copy + `.md` download
- Retry on LLM errors + save retry path
- `OPENROUTER_API_KEY` env wiring (`astro.config.mjs` + `.dev.vars`)
- shadcn primitives: card, textarea, label, radio-group
- `react-markdown` for the anti-bias output

**Out of scope:**
- Magic-link auth (S-01)
- Decisions list view + read-only artifact route (S-03)
- Edit/delete of saved decisions (PRD Non-Goal)
- `wizard_runs` table / draft persistence (PRD FR-031 in-memory only)
- localStorage / sessionStorage snapshot
- CSRF middleware
- `requireUser` helper extraction
- Automated E2E tests, observability tooling, domain packs, profile quiz, live search (Parked)

## Architecture / Approach

```
Browser                                    Server                              External
─────────                                  ──────                              ────────
/decisions/new (Astro page, gated)
└─ <WizardApp client:load>
   ├─ useReducer(reducer, initial)
   ├─ <StepHeader> + <ErrorBanner>
   └─ steps/DescribeStep
        SocraticStep ──── useObject ─────► POST /api/wizard/socratic     ──► OpenRouter
        AlternativesStep ─ useObject ─────► POST /api/wizard/alternatives ──► OpenRouter
        AntiBiasStep ──── useObject ─────► POST /api/wizard/anti-bias    ──► OpenRouter
        ArtifactStep ──── useObject ─────► POST /api/decisions  (stream) ──► OpenRouter
                                              └─ onFinish: INSERT into decisions ──► Supabase
                                          POST /api/decisions  (save retry)  ──► Supabase
```

Each LLM endpoint: `prerender = false`, JSON in, inline `context.locals.user` 401 gate, `streamObject({ schema, ... })`, `result.toTextStreamResponse()` (or `toDataStreamResponse()` for the terminal endpoint with save-outcome data part). Retry policy lives in `src/lib/llm-retry.ts`; model handle in `src/lib/openrouter.ts`; prompts in `src/lib/prompts/**`. Reducer + types in `src/components/wizard/`; per-step files under `src/components/wizard/steps/`.

## Phases at a Glance

| Phase                                                    | What it delivers                                                                                    | Key risk                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Foundations                                           | Deps, env, middleware, schemas, shadcn primitives, dashboard CTA                                    | Model slug `deepseek/deepseek-v4-flash` may 404 on OpenRouter — verify in this phase           |
| 2. Wizard shell + step 1 (Describe)                      | Astro page, island, reducer, chrome, Description step (no LLM)                                      | Reducer's FR-031 invariant must be correct; unit test required                                  |
| 3. Socratic endpoint + steps 2a/2b                       | First end-to-end LLM step proving AI SDK + streaming + skeleton path                                | First contact with OpenRouter streaming; latency may force prompt trimming                      |
| 4. Alternatives + Anti-bias gate                         | Steps 3 + 4, picker cards, acknowledgment wedge enforced                                            | Prompt quality on the 3 anti-bias techniques; markdown rendering safety                         |
| 5. Artifact + terminal endpoint + exports                | Stream + INSERT + Copy + Download; save-fail Retry path                                             | `streamObject` + `onFinish` + data-part save-outcome is the trickiest integration               |
| 6. Polish + prompt tuning + p95 + manual smoke           | Quality, NFR verification, a11y, cross-browser, foundation doc updates                              | p95 may exceed expectations on DeepSeek; may need to revisit model or prompt sizes              |

**Prerequisites:** F-01 archived (`context/archive/2026-05-28-data-foundation/`); Supabase running locally; `OPENROUTER_API_KEY` set in `.dev.vars`; user signed in via existing email+password.

**Estimated effort:** ~5-7 implementation sessions across 6 phases; each phase ships behind a manual confirmation gate.

## Open Risks & Assumptions

- **Model id risk.** `deepseek/deepseek-v4-flash` may not exist on OpenRouter (no "v4-flash" tier documented at writing time). Phase 1 verifies via `GET /api/v1/models`; if 404, swap to the closest verified DeepSeek slug and document the change in Phase 6 — this can change perceived response quality (anti-bias prompts in particular).
- **Latency.** NFR ">2s shows progress" is satisfied by skeletons even if the model is slow; total wall-clock may still feel long if DeepSeek-v4-flash is meaningfully slower than Sonnet 4.5. Phase 6 measures p50/p95.
- **`onFinish` + data-stream protocol.** The pattern for emitting `{ savedId }` / `{ saveError }` as a custom data part on top of a schema stream is the most intricate integration in the slice; rely on the AI SDK data-stream protocol docs at impl time.
- **Anti-bias output quality.** Prompts are load-bearing — the wedge is the slice's reason for existing. Iteration in Phase 6 may need to be deeper than one pass.
- **React-markdown bundle size.** Adds ~50KB; acceptable for a desktop-targeted MVP but worth noting.

## Success Criteria (Summary)

- A signed-in user completes the wizard end-to-end and finds their decision saved in Supabase with the anti-bias technique and acknowledgment timestamp populated
- The "Continue" button on step 4 is provably impossible to advance past without clicking the acknowledgment affordance (UI + reducer + DB CHECK all enforce)
- Each LLM step shows a skeleton immediately and streams content token-by-token, satisfying NFR ">2s shows progress"
- Mid-wizard LLM failures preserve prior step data and offer Retry without losing the user's typed answers (FR-031)
- The artifact can be copied to clipboard as well-formed markdown and downloaded as a `.md` file matching the canonical template
