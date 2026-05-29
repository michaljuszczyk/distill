# Decisions List View + Read-Only Artifact Re-open Implementation Plan

## Overview

Build the read-side of Distill (roadmap slice S-03, FR-010 / FR-011 / FR-013 / US-04): a list of the signed-in user's saved decisions at `/dashboard`, each row linking to a read-only artifact view at `/decisions/[id]`. The write-side (F-01 data foundation + S-02 wizard) is already shipped, so this slice reuses the existing `decisions` table, RLS, DTOs, and Markdown export functions. Rendering is server-side (Astro SSR); the only new client JS is the copy/download action bar.

## Current State Analysis

- **Data layer is complete.** `supabase/migrations/20260528082724_create_decisions.sql` defines `decisions(id, user_id, description, summary, artifact jsonb, anti_bias_technique, acknowledged_at, created_at)`, with RLS `decisions_select_own` scoping `select` to `auth.uid() = user_id` and an index `decisions_user_id_created_at_idx on (user_id, created_at desc)` — already ordered for a newest-first list.
- **DTOs are complete.** `src/types.ts:23` exports `Decision` (a superset of `NewDecisionInput`). `Artifact` is the 5-section schema.
- **Export is reusable.** `src/lib/wizard/exporter.ts` exposes pure `artifactToMarkdown(NewDecisionInput)` and `artifactToFilename(NewDecisionInput)`. `Decision` satisfies `NewDecisionInput`, so both work directly on a fetched row.
- **Artifact display + export buttons are trapped in the wizard.** `src/components/wizard/steps/ArtifactStep.tsx` renders the artifact via an internal `ArtifactSection` component and does copy/download inline — all behind `useWizard()`, so none of it is reusable as written.
- **Routing is ready.** `src/middleware.ts:4` already protects `/dashboard` and `/decisions`. Pages are Astro SSR (`prerender = false` via adapter), read `Astro.locals.user`, can build a Supabase client server-side with `createClient(request.headers, cookies)` (`src/lib/supabase.ts`), and mount React islands with `client:only="react"` / `client:load` (see `src/pages/decisions/new.astro`).
- **`dashboard.astro` is a placeholder** — a welcome card with a "New decision" link and a sign-out form. No list, no `GET /api/decisions` (only `POST` exists in `src/pages/api/decisions/index.ts`).

## Desired End State

A signed-in user landing on `/dashboard` sees their saved decisions, newest first, each showing a title, one-line summary preview, and a date. Clicking a row opens `/decisions/[id]`, a read-only rendering of the 5-section artifact with working copy-to-clipboard and download-as-`.md` buttons and a link back to the list. A user with no decisions sees a friendly empty state with a prominent "Start your first decision" CTA. Opening a non-existent or non-owned decision id returns 404. No decision is ever visible to another user (RLS-enforced).

Verify: complete the wizard once (or seed a row), confirm it appears on `/dashboard`, open it, copy + download the artifact, and confirm a bogus `/decisions/<random-uuid>` returns 404.

### Key Discoveries:

- `summary` column is already populated by the wizard's artifact step and is the intended FR-013 preview source — no extra LLM call or new column needed (`src/types.ts:18`, `ArtifactStep.tsx:121`).
- The `(user_id, created_at desc)` index (`migration:18`) directly serves the list query order.
- `artifactToMarkdown` / `artifactToFilename` take `NewDecisionInput`; `Decision` is a superset, so export reuse is free (`exporter.ts:17,32`).
- RLS makes "row belongs to another user" and "row does not exist" indistinguishable from the client (`migration:25`), so a single "no row → 404" branch covers both isolation and not-found.
- Astro renders a React component without a `client:*` directive as static HTML (no hydration). `<ArtifactView>` can render server-side with zero JS; only `<ExportActions>` needs a `client:load` island.

## What We're NOT Doing

- No editing, deleting, or re-running the wizard against a saved decision (PRD non-goals; UPDATE/DELETE have no RLS policy by design).
- No search, filtering, or pagination on the list (Parked; FR-010 is a simple full-list view).
- No `GET /api/decisions` endpoint — pages fetch server-side.
- No PDF/JSON export, no anti-bias badge on rows, no custom-styled 404 page.
- No re-validation of the stored `artifact` JSON on read (it was Zod-validated on write; `ArtifactView` degrades gracefully on missing items).

## Implementation Approach

Three phases, each independently verifiable. Phase 1 is a pure, behavior-preserving refactor of the shipped wizard that extracts two reusable building blocks (`<ArtifactView>` for display, `<ExportActions>` for copy/download). Phases 2 and 3 are new read surfaces that consume those blocks via SSR pages. RLS does the isolation work, so the page code stays simple: build the session-scoped Supabase client, query, render.

## Critical Implementation Details

- **State sequencing (Phase 1):** `ArtifactStep` shows export buttons only when `stored` (the finalized artifact) exists, and `<ExportActions>` must preserve the existing "Copied" transient state and the clipboard/blob error messaging. The refactor moves this logic verbatim into the new component — it is not a rewrite. Confirm the wizard's copy/download still behaves identically before moving on.

## Phase 1: Extract reusable artifact display + export actions

### Overview

Lift the artifact-rendering markup and the copy/download controls out of `ArtifactStep.tsx` into two standalone components, then refactor `ArtifactStep` to consume them. No user-visible behavior changes in the wizard.

### Changes Required:

#### 1. Presentational artifact view

**File**: `src/components/artifact/ArtifactView.tsx` (new)

**Intent**: A prop-driven, presentation-only component that renders the artifact header (title + optional summary) and the five sections, with no dependency on wizard context. Used by both the wizard and the detail page.

**Contract**: Export `ArtifactView` taking `{ title: string; summary?: string; artifact: Partial<Artifact> }`. Move the existing `ArtifactSection` sub-component (currently `ArtifactStep.tsx:44-63`) here. Section items remain optional/partial-tolerant (the wizard feeds streaming partials; `ArtifactSection` already filters non-strings). Renders the same `<article>`/`<header>`/5×`ArtifactSection` markup currently at `ArtifactStep.tsx:259-271`.

#### 2. Export actions island

**File**: `src/components/artifact/ExportActions.tsx` (new)

**Intent**: A client component holding the copy-to-clipboard and download-as-`.md` buttons plus their transient "Copied" state and error messaging — the logic currently inline in `ArtifactStep`.

**Contract**: Export `ExportActions` taking `{ input: NewDecisionInput }`. Internalize the `copy()` / `download()` logic and the `copied` / `exportError` state from `ArtifactStep.tsx:75-76,202-246`, calling `artifactToMarkdown` / `artifactToFilename` on the passed `input`. Renders the existing button pair (`ArtifactStep.tsx:294-313`) and the export-error `<p>` (`ArtifactStep.tsx:317-321`). No wizard imports.

#### 3. Refactor the wizard's artifact step

**File**: `src/components/wizard/steps/ArtifactStep.tsx`

**Intent**: Replace the inlined display markup and export buttons/handlers with the two new components, keeping all save/stream/retry logic untouched.

**Contract**: Remove the local `ArtifactSection`, the `copy`/`download` functions, and the `copied`/`exportError` state. Render `<ArtifactView title={firstLine} summary={displaySummary} artifact={displayArtifact} />` in place of the inline article, and `<ExportActions input={...} />` (built from `state.data.description`, `storedSummary`, `stored`, `state.data.antiBiasTechnique`) inside the existing `stored` block alongside the save-status indicator. Remove now-unused imports (`Copy`, `Download`, `Check` if no longer referenced, `artifactToMarkdown`, `artifactToFilename`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (or the repo's tsc script)
- Linting passes: `npm run lint`
- Existing wizard tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Run the wizard to completion; artifact renders identically to before.
- Copy button still copies Markdown and shows the transient "Copied" state.
- Download button still downloads a correctly named `.md` file.
- Clipboard-blocked path still shows the export error message.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the wizard still behaves identically before proceeding.

---

## Phase 2: Decisions list at /dashboard

### Overview

Replace the placeholder dashboard with an SSR-rendered list of the user's decisions, newest first, plus an empty state.

### Changes Required:

#### 1. Dashboard list page

**File**: `src/pages/dashboard.astro`

**Intent**: Server-side fetch the signed-in user's decisions and render them as a list of links to their detail pages; show a friendly empty state when there are none. Keep the existing sign-out control.

**Contract**: In the frontmatter, build `createClient(Astro.request.headers, Astro.cookies)` and `select("id, description, summary, created_at").order("created_at", { ascending: false })` from `decisions` (RLS scopes to the owner; no explicit `user_id` filter needed). Each row links to `/decisions/${id}` and shows: title = first non-empty line of `description`, the `summary` as the one-line preview, and a formatted `created_at` date. Empty state: a short "No decisions yet" message with a primary button/link to `/decisions/new`. Retain the sign-out form and a "New decision" entry point. Handle the `supabase === null` (unconfigured) case by rendering the empty/zero state rather than throwing.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With ≥1 saved decision, `/dashboard` lists them newest-first with title, summary preview, and date.
- Each row navigates to the corresponding `/decisions/[id]`.
- With zero decisions, the empty state and "Start your first decision" CTA appear and the CTA opens `/decisions/new`.
- An unauthenticated visit to `/dashboard` still redirects to `/auth/signin` (middleware unchanged).

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Read-only artifact detail at /decisions/[id]

### Overview

A new dynamic route that SSR-fetches a single decision by id (RLS-scoped), renders the artifact read-only with copy/download, and 404s when there's no matching row.

### Changes Required:

#### 1. Decision detail page

**File**: `src/pages/decisions/[id].astro` (new)

**Intent**: Fetch the one decision identified by `Astro.params.id` for the signed-in user, render its artifact read-only, and return 404 if it doesn't exist or isn't theirs.

**Contract**: Build the session-scoped Supabase client and `select("*").eq("id", Astro.params.id).maybeSingle()` from `decisions`. If the result is null (missing OR not owned — RLS makes these identical), set `Astro.response.status = 404` and render a minimal "Decision not found" message with a back-to-list link. Otherwise render `<ArtifactView title={firstLineOfDescription} summary={decision.summary} artifact={decision.artifact} />` (static, no `client:*`) and `<ExportActions input={decision} client:load />`, plus a link back to `/dashboard`. Derive the title with the same first-non-empty-line logic used elsewhere (consider importing/reusing rather than re-inlining).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking a list row opens `/decisions/[id]` showing the full 5-section artifact read-only.
- Copy and download both work on the detail page (Markdown matches the wizard export).
- A bogus `/decisions/<random-uuid>` returns 404 with the not-found message.
- Signed in as a different user, opening another user's decision id returns 404 (no data leak).
- An unauthenticated visit to `/decisions/[id]` redirects to `/auth/signin`.

**Implementation Note**: After automated verification passes, pause for manual confirmation of the full end-to-end read flow.

---

## Testing Strategy

### Unit Tests:

- No new pure logic is introduced (display is presentational; export reuses already-tested `exporter.ts`). If `ExportActions` warrants coverage, the existing `exporter.test.ts` already covers the Markdown/filename functions it delegates to.
- Confirm existing `ArtifactStep`-adjacent tests (`reducer.test.ts`, `exporter.test.ts`) still pass after the Phase 1 refactor.

### Integration / Manual Testing Steps:

1. Seed or wizard-create at least one decision for the test user.
2. Load `/dashboard` — verify newest-first ordering, title/summary/date per row.
3. Click a row — verify the read-only artifact renders all five sections.
4. Copy and download on the detail page — verify Markdown content and filename.
5. Visit `/decisions/<random-uuid>` — verify 404.
6. (If a second account is available) verify cross-user isolation returns 404.
7. Sign out and hit `/dashboard` and `/decisions/<id>` — verify redirect to sign-in.

## Performance Considerations

List and detail are single indexed SSR queries scoped by RLS; data volume is small (PRD `target_scale: small`). The `select` on the list omits the heavy `artifact` JSONB to keep the row payload light. No client-side data fetching, so no loading states and instant first paint (helps the 200 ms NFR).

## Migration Notes

None. No schema changes — this slice is read-only over the existing `decisions` table.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD: `context/foundation/prd.md` (FR-010, FR-011, FR-013, US-04, FR-032)
- Data foundation: `context/archive/2026-05-28-data-foundation/`
- Wizard (write-side, source of saved rows): `context/archive/2026-05-28-wizard-end-to-end/`
- Reused export functions: `src/lib/wizard/exporter.ts:17,32`
- Artifact display origin: `src/components/wizard/steps/ArtifactStep.tsx:44,259`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract reusable artifact display + export actions

#### Automated

- [x] 1.1 Type checking passes — ff0d1ba
- [x] 1.2 Linting passes — ff0d1ba
- [x] 1.3 Existing wizard tests pass — ff0d1ba
- [x] 1.4 Build succeeds — ff0d1ba

#### Manual

- [x] 1.5 Wizard artifact renders identically to before — ff0d1ba
- [x] 1.6 Copy button still copies Markdown with transient "Copied" state — ff0d1ba
- [x] 1.7 Download button still downloads a correctly named `.md` file — ff0d1ba
- [x] 1.8 Clipboard-blocked path still shows the export error message — ff0d1ba

### Phase 2: Decisions list at /dashboard

#### Automated

- [x] 2.1 Type checking passes — 9ea1cdf
- [x] 2.2 Linting passes — 9ea1cdf
- [x] 2.3 Build succeeds — 9ea1cdf

#### Manual

- [x] 2.4 List shows decisions newest-first with title, summary, date — 9ea1cdf
- [x] 2.5 Each row navigates to its /decisions/[id] — 9ea1cdf
- [x] 2.6 Empty state + "Start your first decision" CTA appear and CTA opens /decisions/new — 9ea1cdf
- [x] 2.7 Unauthenticated /dashboard redirects to /auth/signin — 9ea1cdf

### Phase 3: Read-only artifact detail at /decisions/[id]

#### Automated

- [x] 3.1 Type checking passes
- [x] 3.2 Linting passes
- [x] 3.3 Build succeeds

#### Manual

- [x] 3.4 Row click opens read-only 5-section artifact
- [x] 3.5 Copy and download work on the detail page
- [x] 3.6 Bogus /decisions/<random-uuid> returns 404
- [x] 3.7 Cross-user decision id returns 404 (no data leak)
- [x] 3.8 Unauthenticated /decisions/[id] redirects to /auth/signin
