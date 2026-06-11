# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-11

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not assert
   the LLM's actual output content when a schema/shape check catches the
   regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Additional project rule (interview Q4/Q5): tests validate **our side of the
boundary**, never the external system. We assert that our code scopes a
query to the user, enforces the gate server-side, validates input, and
handles a provider failure — we do not test Supabase's RLS engine or the
LLM's behavior.

Hot-spot scope used for likelihood weighting: `src/components/`,
`src/pages/`, `src/lib/`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                   | Impact | Likelihood | Source (evidence — not anchor)                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Mid-wizard step failure wipes prior typed answers (no in-memory recovery; user must restart)                              | High   | High       | PRD FR-031 / §Success Guardrails; interview Q1; hot-spot dir `src/components/wizard` (26 commits/30d)            |
| 2   | LLM provider error not handled as designed — a fabricated/partial artifact, or silent success, instead of a visible error | High   | High       | interview Q5; PRD NFR "no silent waits"; hot-spot dirs `src/lib` (`llm-retry`), `src/pages/api` (14 commits/30d) |
| 3   | Anti-bias gate bypassed — artifact produced/persisted without the step-4 acknowledgment (server side, not just UI)        | High   | Medium     | PRD FR-030 / US-03; interview Q4 (our side of the gate)                                                          |
| 4   | Cross-user decision read (IDOR) — our handler does not scope reads/writes to `context.locals.user`                        | High   | Medium     | PRD FR-032 / US-04; interview Q4; hot-spot dirs `src/pages/api/decisions`, `src/pages/decisions`                 |
| 5   | Unauthenticated request to a protected route/endpoint is served instead of redirected/401'd                               | High   | Medium     | PRD §Access Control; AGENTS.md (middleware contract); interview Q5 (authn/authz focus)                           |
| 6   | Untrusted input passes — server-side zod validation gap lets a malformed body reach the LLM/DB                            | Medium | Medium     | AGENTS.md "validate input with zod"; interview Q5 (bad scenarios); hot-spot dir `src/pages/api` (14 commits/30d) |
| 7   | Stream retry race — a stale `onFinish` overwrites the new request's data after a re-submit/re-pick                        | Medium | Medium     | `context/foundation/lessons.md` (recurred twice); interview Q5; hot-spot dir `src/components/wizard/steps`       |

Abuse / security lens: the product has auth and accepts user input (no
payments). Authorization is covered by #3 (gate enforcement) and #4 (IDOR /
ownership); authentication by #5; untrusted-input parity by #6.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                  | Must challenge                                                                                | Context `/10x-research` must ground                                                                      | Likely cheapest layer                            | Anti-pattern to avoid                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| #1   | After a later step's generation fails, prior steps' typed answers remain in state and re-render without a page refresh                                       | "the error handler clears state"; "refresh-recovery counts" (state is in-memory only, FR-031) | reducer shape; which action fires on a step error; what WizardApp renders on error                       | unit (reducer) + component                       | dispatching the code's own reset action as the assertion; happy-path-only                                           |
| #2   | A provider error (non-200 / stream abort / malformed) surfaces a visible error state, produces no fabricated/partial artifact, and does not silently succeed | "stream resolved ⇒ success"; "final 200 ⇒ good data"                                          | `llm-retry` behavior; how api routes translate provider errors; what the step component renders on error | integration (api route, mocked provider failure) | asserting the exact LLM text (oracle problem); over-mocking so the error path is never really exercised             |
| #3   | The artifact cannot be produced or persisted without the anti-bias acknowledgment; a request lacking it is rejected by **our** handler                       | "UI hides the button ⇒ safe"; "ack persisted ⇒ enforced"                                      | where the artifact endpoint reads gate state; what the request carries; how the audit trail is persisted | integration (artifact endpoint)                  | testing only the client gate (FR-030 requires data-layer enforcement too); e2e where integration suffices           |
| #4   | A request for a decision id not owned by the caller returns not-found/forbidden; list/read queries are scoped to `locals.user`                               | "logged in ⇒ allowed"; "RLS catches it so our code needn't scope"                             | how the id reaches the query; whether the handler injects the user id; what middleware guarantees        | integration (decisions endpoint + page loader)   | testing Supabase RLS itself (external, out of scope per Q4); over-mocking the client so the scoping is not asserted |
| #5   | An unauthenticated request to a protected route/endpoint is redirected/401'd by middleware/handler, not served                                               | "middleware covers it" (untested); "PROTECTED_ROUTES is complete"                             | middleware redirect logic; which routes/endpoints are gated; the unauth `locals.user` shape              | unit/integration (middleware + endpoint guards)  | full-login e2e where a middleware unit test catches it; mirroring the route list from the code                      |
| #6   | A malformed/missing/oversized body is rejected with a clean 4xx before any LLM/DB call                                                                       | "client validated ⇒ server can trust"; "the happy body is the only body"                      | which endpoints have zod schemas; the parse-failure path; whether validation precedes side effects       | unit/integration (handlers, bad payloads)        | asserting the zod error message verbatim; testing only well-formed input                                            |
| #7   | A re-submit/re-pick aborts the in-flight stream before starting the new one, so a stale `onFinish` cannot overwrite new data                                 | "the latest dispatch wins" (the later-resolving stream wins)                                  | `stop()`/`submit()` ordering in retry handlers; the `onFinish` dispatch                                  | component/integration (overlapping streams)      | brittle `waitForTimeout`; mirroring the handler instead of asserting the resulting state                            |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                           | Goal (one line)                                                                                                             | Risks covered | Test types                                                                     | Status        | Change folder                                |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------ | ------------- | -------------------------------------------- |
| 1   | Wizard failure-path & state survival | Main path survives the bad scenarios: state preserved on failure, LLM errors handled as designed, no stream-race stale data | #1, #2, #7    | unit (reducer), integration (api error paths), component (overlapping streams) | change opened | context/changes/testing-wizard-failure-path/ |
| 2   | Auth & authorization boundary        | Our side enforces: anti-bias gate server-side, decision ownership scoping, unauth rejection                                 | #3, #4, #5    | integration (endpoints + middleware)                                           | not started   | —                                            |
| 3   | Input validation parity              | Server rejects malformed input before any side effect                                                                       | #6            | unit/integration (handlers, bad payloads)                                      | not started   | —                                            |

Each phase also carries a limited happy-path anchor (one per area) to verify
the flow before exercising the bad scenarios.

## 4. Stack

| Layer              | Tool                              | Version          | Notes                                                                |
| ------------------ | --------------------------------- | ---------------- | -------------------------------------------------------------------- |
| unit + integration | Vitest                            | ^4.1.7           | configured; 7 tests today (wizard reducer/exporter + 5 api handlers) |
| component (React)  | @testing-library/react + jest-dom | ^16.3.2 / ^6.9.1 | for reducer-adjacent + step component tests (Phase 1)                |
| coverage           | @vitest/coverage-v8               | ^4.1.7           | available; no threshold gate wired yet                               |
| API mocking        | none yet — see Phase 1            | —                | mock the provider/network edge only; Phase 1 establishes the pattern |
| e2e                | none — out of scope               | —                | PRD §Non-Goals: automated E2E is v2 (manual smoke at MVP)            |
| accessibility      | none — out of scope               | —                | not a top-N risk; revisit on a refresh if a11y becomes a concern     |

**Stack grounding tools (current session):**

- Docs: Context7 — available; not queried for this write (stack is already locked in `tech-stack.md`; query at plan time for Vitest 4 / Astro 6 SSR test APIs); checked: 2026-06-11
- Search: Exa.ai — available; not used (no discovery gap at plan-write time); checked: 2026-06-11
- Runtime/browser: none — no Playwright/browser MCP exposed this session; e2e is out of scope anyway; checked: 2026-06-11
- Provider/platform: Supabase MCP — available; relevant for Phase 2 (verifying our query scoping against a seeded schema), not used at write time; checked: 2026-06-11

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only, then prefer official docs
as the evidence. Do not use MCP docs/search to infer code failure anchors;
those belong in per-phase `/10x-research`.

## 5. Quality Gates

| Gate                       | Where      | Required?                 | Catches                          |
| -------------------------- | ---------- | ------------------------- | -------------------------------- |
| lint + typecheck           | local + CI | required                  | syntactic / type drift           |
| unit + integration         | local + CI | required after §3 Phase 1 | logic + failure-path regressions |
| authz/authn boundary tests | local + CI | required after §3 Phase 2 | gate bypass, IDOR, unauth access |
| input validation tests     | local + CI | required after §3 Phase 3 | malformed-input regressions      |

`npm run test` (`vitest run --passWithNoTests`) already runs in the suite;
CI (`.github/workflows/ci.yml`) runs lint + build today. Wiring the test run
into the CI gate is part of Phase 1's landing.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: next to the unit under test (e.g. `src/components/wizard/reducer.test.ts`, `src/lib/wizard/exporter.test.ts`).
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/components/wizard/reducer.test.ts`.
- **Run locally**: `npm run test` (or `npm run test:watch`).

### 6.2 Adding an integration test (api error/failure path)

- TBD — see §3 Phase 1 (provider-error handling pattern for `src/pages/api/wizard/*`: mock the provider edge, assert visible-error + no fabricated artifact).

### 6.3 Adding a stream-retry-race test

- TBD — see §3 Phase 1 (overlapping-stream pattern: assert `stop()` precedes `submit()` so stale `onFinish` can't win; see `lessons.md`).

### 6.4 Adding an authz/authn boundary test

- TBD — see §3 Phase 2 (gate-enforcement, ownership-scoping, and unauth-rejection patterns — tests our side, not the Supabase RLS engine).

### 6.5 Adding an input-validation test for an API endpoint

- TBD — see §3 Phase 3 (bad-payload pattern: malformed/missing/oversized body → clean 4xx before any LLM/DB call).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2-3 line note
here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q4/Q5). Future
contributors should respect these unless the underlying assumption changes.

- **External providers' internals** — Supabase RLS engine, magic-link delivery, and the OpenRouter/DeepSeek LLM behavior. We test only _our_ side of the boundary (query scoping, gate enforcement, error handling). Re-evaluate only if we move enforcement logic in-house. (Source: Q4, Q5.)
- **LLM output content** — non-deterministic; assert schema/shape and error handling, never the actual generated text. Re-evaluate if a deterministic post-processor is added. (Source: Q5.)
- **UI snapshot tests for static layout/marketing** — brittle, catch nothing. Re-evaluate never, unless visual regression becomes a named risk. (Source: Q5.)
- **Automated E2E** — PRD §Non-Goals (manual smoke at MVP; E2E is v2). Re-evaluate when E2E is promoted off the v2 backlog. (Source: PRD, Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-11
- Stack versions last verified: 2026-06-11
- AI-native tool references last verified: 2026-06-11

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
