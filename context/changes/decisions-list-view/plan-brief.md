# Decisions List View + Read-Only Artifact Re-open — Plan Brief

> Full plan: `context/changes/decisions-list-view/plan.md`

## What & Why

Build the read-side of Distill (roadmap slice S-03): a list of the signed-in user's saved decisions and a read-only view to re-open any one. The wizard (write-side) already saves decisions; without this, a user can produce an artifact but never re-find it — defeating the product's "an artifact you can point at later" promise (US-04, FR-010/011/013).

## Starting Point

The `decisions` table, RLS isolation, `Decision` DTO, and Markdown export functions all exist and ship today (F-01 + S-02, both archived). `/dashboard` is a placeholder welcome card; there is no list and no detail route. The artifact-rendering markup and copy/download buttons currently live inside the wizard's `ArtifactStep.tsx`, locked behind wizard context.

## Desired End State

A user landing on `/dashboard` sees their decisions newest-first (title + one-line summary + date), clicks one to open `/decisions/[id]` as a read-only 5-section artifact with working copy and download, and gets a friendly empty state on first sign-in. Bogus or non-owned ids return 404. No decision is ever visible to another user.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| List location | At `/dashboard`, detail at `/decisions/[id]` | `/dashboard` is already the post-auth landing in middleware; zero new routing | Plan |
| Data fetching | SSR query in the `.astro` pages | RLS enforces isolation, instant first paint, no new API surface | Plan |
| Artifact display reuse | Extract presentational `<ArtifactView>` | Single source of truth; no drift between wizard preview and saved view | Plan |
| Export buttons | Extract `<ExportActions>` island too | Detail needs identical copy/download; avoids duplicating ~40 lines | Plan |
| Row content / order | Title + summary + date, newest first | Reuses existing title logic and the `(user_id, created_at desc)` index | Plan |
| Preview source (FR-013) | The existing `summary` column | Already populated by the wizard; no extra LLM call or column | Plan |
| Empty state | Friendly message + prominent New CTA | Turns first sign-in into an onboarding moment (US-02) | Plan |
| Not-found / non-owned | Return 404 | Correct semantics; RLS makes missing vs not-owned indistinguishable | Plan |

## Scope

**In scope:** decisions list at `/dashboard`; read-only artifact detail at `/decisions/[id]`; copy/download on detail; empty state; 404 handling; a behavior-preserving wizard refactor to extract `<ArtifactView>` + `<ExportActions>`.

**Out of scope:** edit/delete/re-run, search/filter/pagination, a `GET /api/decisions` endpoint, PDF/JSON export, custom 404 styling, re-validating stored artifact JSON.

## Architecture / Approach

Astro SSR pages query the session-scoped Supabase client; RLS scopes every read to the owner. Phase 1 extracts two reusable React components from the wizard (`<ArtifactView>` renders statically with no hydration; `<ExportActions>` is a small `client:load` island). The list page (`dashboard.astro`) renders rows as links; the detail page (`decisions/[id].astro`) renders `<ArtifactView>` + `<ExportActions>` or 404s.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract reusable pieces | `<ArtifactView>` + `<ExportActions>`, wizard refactored to use them | Regressing shipped wizard behavior during extraction |
| 2. List at `/dashboard` | SSR decisions list + empty state | Query/ordering correctness; supabase-unconfigured fallback |
| 3. Detail at `/decisions/[id]` | Read-only artifact + copy/download + 404 | Correct 404 semantics; cross-user isolation |

**Prerequisites:** F-01 (done) — schema, RLS, DTOs. At least one persisted decision for verification (wizard-create or seed).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumes the Phase 1 extraction is a pure markup/logic move — verified by the wizard still passing its manual smoke before Phases 2–3.
- Assumes stored `artifact` JSON is well-formed (Zod-validated on write); the read path does not re-validate, relying on `ArtifactView`'s graceful handling of missing items.

## Success Criteria (Summary)

- A user re-finds and re-opens a past decision from `/dashboard` without re-reading any chat.
- Copy and download on the detail page produce the same Markdown as the wizard.
- No user can read another user's decision (404), and the wizard is unchanged in behavior.
