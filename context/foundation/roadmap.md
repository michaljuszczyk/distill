---
project: Distill
version: 1
status: draft
created: 2026-05-28
updated: 2026-05-28
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Distill

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

People making nontrivial decisions arrive mid-process with criteria blurred: paralysis, confirmation bias, criterion drift, no artifact to point at later. Distill walks the user through a forced six-step Socratic wizard and produces a structured needs/criteria/options/risks/open-questions document. The product wedge — the one trait that, if removed, makes the product indistinguishable from a generic AI chat — is that the anti-bias step (devil's advocate / pre-mortem / unknown unknowns) is a mandatory gate the user cannot skip before the artifact is produced.

## North star

**S-02: Signed-in user completes the 6-step wizard, sees the structured artifact, exports it, and it's auto-saved to their list.** — the smallest end-to-end slice whose successful delivery proves the core product hypothesis (forced anti-bias produces a useful artifact in ≤15 min). It is placed as early as Prerequisites allow because everything else only matters if this works.

> "North star" here means: the validation milestone — the slice that, once shipped, makes a public URL usable by a real deliberate-decider. Placed after its Prerequisites (data schema + magic-link auth), not earlier.

## At a glance

| ID    | Change ID              | Outcome (user can …)                                                                                  | Prerequisites    | PRD refs                                                                                  | Status   |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | -------- |
| F-01  | data-foundation        | (foundation) decisions schema + RLS + shared DTOs landed; per-user isolation enforced at data layer   | —                | FR-032                                                                                    | done     |
| S-02  | wizard-end-to-end      | complete the 6-step wizard, see the structured artifact, copy/download it, and have it auto-saved    | F-01             | US-01, US-03, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031 | proposed |
| S-03  | decisions-list-view    | see a list of saved decisions with one-line previews and open any to view the read-only artifact      | F-01             | US-04, FR-010, FR-011, FR-013                                                             | proposed |
| S-01  | magic-link-auth        | sign in via magic link instead of the existing email+password (capability upgrade, not a gate)        | —                | US-02, FR-001, FR-002, FR-003                                                             | ready    |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph in `## Foundations` + `## Slices`; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                                | Note                                                              |
| ------ | ------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| A      | Data + wizard core  | `F-01` → `S-02` → `S-03`             | Backbone toward the north star and its read-side view.            |
| B      | Auth UX upgrade     | `S-01`                               | Standalone, last. Swaps existing email+password for magic-link; no other slice depends on it. |

## Baseline

What's already in place in the codebase as of `2026-05-28` (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 wired; `src/pages/{index,dashboard}.astro` and `src/pages/auth/{signin,signup,confirm-email}.astro`; shadcn-style button at `src/components/ui/button.tsx`. Per `tech-stack.md`.
- **Backend / API:** partial — Astro SSR + Cloudflare adapter (`astro.config.mjs:11,16`); only `src/pages/api/auth/{signin,signup,signout}.ts` present; no Zod validation pattern wired (form fields cast directly).
- **Data:** partial — Supabase SSR client wired (`src/lib/supabase.ts`); `supabase/migrations/` is empty; no `src/types.ts`.
- **Auth:** partial — Supabase session via middleware (`src/middleware.ts:12-22`) with `PROTECTED_ROUTES=['/dashboard']`, BUT current flow is **email+password only** — magic-link (PRD FR-001..003) is **not** wired.
- **Deploy / infra:** present — Cloudflare Workers via `wrangler.jsonc`; `.github/workflows/ci.yml` runs lint + build + sync on push/PR to `main`; secrets injected from GitHub Actions; prod secrets via `wrangler secret put`. Per `tech-stack.md`.
- **Observability:** absent — no logging library, no error tracking, no metrics. Not promoted to a Foundation: `main_goal=speed`, no NFR gates launch on observability, and the privacy NFR ("no decision content to third-party analytics") is satisfied by *not* adding any.

## Foundations

### F-01: Data foundation

- **Outcome:** (foundation) `decisions` table landed in Supabase with RLS policies that scope reads/writes to the owning user; shared DTO types (decision, artifact section schema) exported from `src/types.ts`.
- **Change ID:** data-foundation
- **PRD refs:** FR-032
- **Unlocks:** S-02 (auto-save of completed wizard), S-03 (read of own decisions list and artifact view).
- **Prerequisites:** —
- **Parallel with:** S-01 (independent; agent-fan-out friendly)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First piece on the critical path to the north star. Schema shape is load-bearing — the artifact's five sections (needs / criteria / options / risks / open questions) must be representable without S-02 having to migrate it later. Get the column shape right once.
- **Status:** done

## Slices

### S-02: Wizard end-to-end with artifact and auto-save (north star)

- **Outcome:** signed-in user (existing email+password auth from baseline is sufficient) starts a new decision from the list, runs the 6 wizard steps (description → Socratic Qs with up to one follow-up round → 3 alternatives → user-picked anti-bias technique acknowledged → artifact rendered on screen → auto-saved), and can copy the artifact to clipboard or download it as `.md`. The anti-bias step is gated — the user cannot reach the final-artifact step without explicitly acknowledging the anti-bias output.
- **Change ID:** wizard-end-to-end
- **PRD refs:** US-01, US-03, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031
- **Prerequisites:** F-01
- **Parallel with:** S-03 (S-03 reads what S-02 writes, but can be built against a manually seeded row), S-01 (S-01 is an auth UX swap that doesn't affect wizard logic — `context.locals.user` stays the contract)
- **Blockers:** —
- **Unknowns:**
  - LLM call latency vs the NFR "continuous visible progress for steps > 2s" — confirm the chosen prompt sizes hit acceptable p50/p95 with OpenRouter/Sonnet 4.6 before final UX commit. Owner: implementer at `/10x-plan` time. Block: no.
  - In-memory wizard-state shape (FR-031) — what survives a mid-wizard LLM error vs what a browser refresh blows away — needs a one-page contract before implementation. Owner: implementer. Block: no.
- **Risk:** Largest slice in the roadmap by surface area: 6 wizard steps × LLM wiring × state machine × anti-bias gate × auto-save × two export paths. Splitting it loses end-to-end validation, so it stays whole. The wedge (FR-030, US-03) lives inside this slice — the acknowledgment must be enforced at the UI layer **and** persisted with the saved decision (audit trail). If the slice slips, the north star slips with it. Auth comes from the existing email+password scaffold; do not block on magic-link (S-01).
- **Status:** proposed

### S-03: Decisions list view + artifact re-open

- **Outcome:** signed-in user (existing email+password auth from baseline) sees a list of their saved decisions with a one-line summary preview per row, and clicking a row opens the artifact in a read-only view that exposes copy-to-clipboard and download-as-`.md`.
- **Change ID:** decisions-list-view
- **PRD refs:** US-04, FR-010, FR-011, FR-013
- **Prerequisites:** F-01
- **Parallel with:** S-02, S-01
- **Blockers:** —
- **Unknowns:**
  - One-line preview source (FR-013, nice-to-have) — derive from the saved artifact's needs section vs the user-typed step-1 description vs an explicit summary column. Owner: implementer at `/10x-plan` time. Block: no.
- **Risk:** Verification needs at least one persisted decision; S-02 produces those. If S-03 is built in parallel with S-02, seed one row manually for local verification. Layout simplicity matters — list view + artifact view are the only read surfaces; resist the urge to add filters / search (Parked).
- **Status:** proposed

### S-01: Magic-link auth (UX upgrade)

- **Outcome:** user enters their email, receives a magic link, clicks it, and lands authenticated on the decisions list view; the existing email+password scaffold is replaced. Capability upgrade only — no other slice depends on it.
- **Change ID:** magic-link-auth
- **PRD refs:** US-02, FR-001, FR-002, FR-003
- **Prerequisites:** —
- **Parallel with:** F-01, S-02, S-03 (does not touch their contracts; `context.locals.user` shape stays the same)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Lowest-priority slice — sequenced last per user override (existing Supabase email+password auth in baseline is sufficient to satisfy "logged-in user" prerequisites elsewhere). The work itself is still a real migration: `src/pages/auth/{signin,signup,confirm-email}.astro` + `src/pages/api/auth/{signin,signup}.ts` get replaced, and a Supabase magic-link callback route is new. Cross-device clicks (US-02 acceptance criterion) need that callback. If the deadline pressure forces a cut, this is the slice that can ship to v2 with the least product damage.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title                                       | Ready for `/10x-plan` | Notes                                                                  |
| ---------- | ---------------------- | ----------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| F-01       | data-foundation        | Data foundation: decisions schema, RLS, DTOs                | yes                   | Run `/10x-plan data-foundation`. No Prerequisites.                     |
| S-02       | wizard-end-to-end      | Wizard end-to-end with artifact and auto-save (north star) | no                    | Depends on F-01. Plan after F-01 is archived. Uses existing email+password auth from baseline. |
| S-03       | decisions-list-view    | Decisions list view + read-only artifact re-open            | no                    | Depends on F-01. Buildable in parallel with S-02.                      |
| S-01       | magic-link-auth        | Magic-link auth — UX upgrade (lowest priority)              | yes                   | Run `/10x-plan magic-link-auth`. No Prerequisites; lowest priority — sequence last or cut to v2 under deadline pressure. |

## Open Roadmap Questions

_PRD `## Open Questions` was empty at draft time, and the lean interview surfaced no new cross-cutting gaps. Per-slice unknowns live in their slices._

## Parked

- **Domain packs (laptop / appliance / hire / framework presets)** — Why parked: PRD §Non-Goals (per-domain prompt-tuning is v2).
- **Profile quiz (rationalist / emotional / pragmatic / conservative)** — Why parked: PRD §Non-Goals (psychometric personalization is v2).
- **Multi-user / sharing / collaborative decisions** — Why parked: PRD §Non-Goals (flat-user MVP).
- **Live web-search integration (real prices / specs / reviews)** — Why parked: PRD §Non-Goals (downstream research stays outside the app).
- **Automated CI/CD pipeline (deploy on merge to main)** — Why parked: PRD §Non-Goals (manual deploy at MVP).
- **Automated E2E test suite** — Why parked: PRD §Non-Goals (manual smoke test at MVP).
- **Editing a saved decision artifact** — Why parked: PRD §Non-Goals (artifacts immutable at MVP).
- **Re-running the wizard against a saved decision (clone-and-iterate)** — Why parked: PRD §Non-Goals (deferred to v2).
- **Delete a saved decision** — Why parked: PRD removed FR-012 (decisions are immutable in MVP; delete deferred to v2).
- **Cost-per-session dashboard / LLM-call budget guardrail** — Why parked: shape-notes Forward: technical-roadmap (precursor to scale; not needed at solo MVP).
- **PDF / JSON export formats** — Why parked: shape-notes Forward (FR-029 .md-only at MVP).
- **OAuth (GitHub / Google) sign-in** — Why parked: shape-notes Forward (magic-link is the fastest path to working auth in MVP).
- **Observability layer (logging / error tracking / metrics)** — Why parked: `main_goal=speed`; no NFR gates launch on this; baseline absent and we keep it absent. Privacy NFR is satisfied by adding nothing.

## Done

- **F-01: (foundation) `decisions` table landed in Supabase with RLS policies that scope reads/writes to the owning user; shared DTO types (decision, artifact section schema) exported from `src/types.ts`.** — Archived 2026-05-28 → `context/archive/2026-05-28-data-foundation/`. Lesson: —.
