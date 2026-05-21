---
project: "Distill"
version: 1
status: draft
created: 2026-05-21
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-06-18
  after_hours_only: true
---

# Distill — Product Requirements Document

## Vision & Problem Statement

People making nontrivial decisions — purchases (laptop, appliance, car), hires, technical
choices (framework, database, hosting), home/renovation choices — read reviews, google,
ask friends, and arrive mid-process with their own criteria blurred. Four pains stack:
decision paralysis (too many options, no clarity on own criteria), confirmation bias
(half-decided already, research becomes justification), criterion drift (started with
A,B,C; now optimizing for X,Y,Z without noticing), missing-structure (no artifact to
point at later — "why did I pick this?"). Cost today: time wasted on the wrong research
path, decisions disguised as researched, and in work context, building wrong things
because requesters couldn't articulate need.

Free-form chat tools help but won't force the user through structure or push back on
biased framing. The insight is that **anti-bias is a discrete forced step**, not a
personality trait or vibe — devil's advocate, pre-mortem, and unknown-unknowns are real
techniques that can be bolted into a wizard as their own gate, before any
research-for-specifics phase begins. The artifact (structured needs / options / risks /
open questions) is the wedge: it survives the chat session and becomes the input to the
next research step (prices, models, reviews).

## User & Persona

The primary persona is the **deliberate decider** — someone who recognizes a current
decision as nontrivial, knows they'll regret a gut call, and wants to *front-load*
clarity work before the research-for-specifics phase (browsing, pricing,
spec-comparing). Reached for the product mid-overload: tabs open, half-formed criteria,
no artifact.

The persona is intentionally broad — programmer/rationalist (the author) and emotional
decider (estetics, values, prestige) are both in scope. The product does not judge
weight shapes; it exposes them. Author-tuned tweaks per decision-type (e.g. tech-decision
prompt phrasing) are allowed as the product grows, but the MVP must be useful to someone
who is NOT the author.

## Success Criteria

### Primary

- A logged-in user opens the wizard for a real decision (e.g. "which monitor should
  I buy"), completes all six steps, and walks away with a structured artifact (needs /
  criteria / options / risks / open questions) in ≤ 15 minutes of active time.
- The artifact is usable as input to the next phase of research — the user can open
  it, point at it, and say "this is what I'm looking for and why" without re-reading
  the chat transcript.
- The app runs on a public URL with real magic-link auth.

### Secondary

- The decisions list shows a one-line summary preview for each saved decision, so the
  user can re-find a past artifact without re-opening it.

### Guardrails

- The wizard never silently loses user input. If a generation step fails mid-wizard,
  the user's typed answers from prior steps remain recoverable (not blown away by a
  refresh or by the error itself).
- No decision artifact is ever visible to another user. Per-user data isolation is
  enforced at the data layer, not at the UI layer.
- The anti-bias step is mandatory. A user cannot reach the final-artifact step
  without having completed the anti-bias pass. The wedge is anti-bias as a forced
  step; making it skippable collapses the product into a generic decision-list app.
- No decision content (titles, questions, answers, artifacts) is sent to any
  third-party analytics or logging vendor.

## User Stories

### US-01: User completes the wizard for a real decision and walks away with an artifact

- **Given** a logged-in user with an actual decision in front of them (e.g. "which monitor should I buy")
- **When** they start the wizard, describe the decision, answer the Socratic questions (1–3 rounds), review the 3 alternatives, complete the devil's-advocate anti-bias pass, and reach the final-document step
- **Then** they see a structured artifact (needs / criteria / options / risks / open questions) on screen, can copy it to clipboard or download it as `.md`, and can save it to their decisions list

#### Acceptance Criteria
- The artifact contains all five sections (needs, criteria, options, risks, open questions); none is empty
- The anti-bias step was completed (FR-030 is enforced; not skipped)
- Total active time from start to artifact is ≤ 15 minutes for a typical decision
- The artifact is usable as input to the next research phase — the user can point at it and say "this is what I'm looking for and why" without re-reading the chat transcript

### US-02: User signs in via magic link

- **Given** an unauthenticated visitor on the landing page
- **When** they enter their email and request a sign-in link, then click the link delivered to their inbox
- **Then** they land authenticated on the decisions list view (empty on first sign-in)

#### Acceptance Criteria
- The same flow works for first-time sign-up and returning sign-in (no separate "create account" surface)
- An expired link shows a clear "this link has expired — request a new one" message with a re-request button, not a generic auth error
- A user who clicks the link in a different browser than the one that requested it still completes sign-in (cross-device tolerated)

### US-03: User completes the anti-bias step (the wedge)

- **Given** a user mid-wizard who has reached step 4 (alternatives already presented in step 3)
- **When** they reach the anti-bias step, see the devil's-advocate output for their decision, and explicitly acknowledge it
- **Then** they can advance to step 5 (final document)

#### Acceptance Criteria
- The devil's-advocate output is visibly distinct from a normal wizard step (different framing — "here's what's wrong with this") so users notice the shift
- The acknowledgment is an explicit affirmative action (e.g. "I've read this — continue" button); auto-advance is forbidden
- A user cannot reach step 5 without having clicked the acknowledgment in step 4 (enforces FR-030 at the UI layer; the data layer enforces it independently)
- The acknowledgment is captured and persisted with the saved decision (audit trail — proves the wedge happened)

### US-04: User re-opens a past decision from the list

- **Given** a logged-in user with at least one saved decision
- **When** they open the decisions list and click on a row
- **Then** they see the final artifact view for that decision

#### Acceptance Criteria
- The list shows only the signed-in user's decisions (FR-032 enforced at the data layer)
- The artifact view is read-only in the MVP — no re-edit, no re-run of the wizard against a saved decision (deferred to v2)
- From the artifact view, the user can copy to clipboard (FR-028) and download as .md (FR-029)
- No delete from the artifact view at MVP (decisions are immutable; delete deferred to v2)

## Functional Requirements

### Authentication
- FR-001: User can request a magic link by entering their email. Priority: must-have
  > Socrates: Counter-argument considered: "OAuth (GitHub/Google) would be faster for the programmer/rationalist persona." Resolution: kept magic link; OAuth deferred to v2 — Supabase magic link is the fastest path to a working auth in MVP.
- FR-002: User can complete sign-in by clicking the magic link in their email. Priority: must-have
  > Socrates: Counter-argument considered: "link should be single-use / short TTL for anti-replay." Resolution: kept as-is; single-use semantics and TTL are implementation details inherited from Supabase defaults, not load-bearing FR concerns.
- FR-003: User can sign out via a profile menu accessible from authenticated views. Priority: must-have
  > Socrates: Counter-argument considered: "'sign out from any authed view' is over-broad; conventional UX is profile dropdown." Resolution: revised — sign-out lives in a profile menu, not duplicated on every view.

### Decisions list
- FR-010: User can see a list of their own saved decisions. Priority: must-have
  > Socrates: Counter-argument considered: "show only N most recent / replace list with search-first landing." Resolution: kept simple full-list view; pagination and search defer to v2.
- FR-011: User can open a saved decision and view its final artifact. Priority: must-have
  > Socrates: Counter-argument considered: "inline expand-in-list / print-friendly-only view." Resolution: kept as a separate route (deep-linkable); layout details left to implementation.
- FR-013: User sees a one-line summary preview for each decision in the list. Priority: nice-to-have
  > Socrates: Counter-argument considered: "show user-typed step-1 description instead of an AI summary / use 3-line snippet / drop entirely." Resolution: kept as nice-to-have 1-line preview; implementation may choose to source it from the saved artifact rather than running an extra LLM call.

### Decision wizard
- FR-020: User can start a new decision from the list view. Priority: must-have
  > Socrates: Counter-argument considered: "global 'New' button in nav / land signed-in users on the wizard rather than the list." Resolution: kept list → New as the conventional flow; nav-button placement is implementation detail.
- FR-021: User can describe their decision in free text (wizard step 1). Paragraph-length input is allowed; no hard sentence cap. Priority: must-have
  > Socrates: Counter-argument considered: "1–3 sentences is too constrained; some decisions need background and constraints already discovered." Resolution: revised — no hard sentence cap; users may write paragraph-length descriptions if useful.
- FR-022: User receives an initial round of Socratic questions generated by the app and answers them one at a time (wizard step 2). The app determines question count per decision; 3–6 questions is the suggested guideline, but there is no hard upper or lower limit. Priority: must-have
  > Socrates: Counter-argument considered: "let AI decide N — no fixed 4–6 range." Resolution: revised — AI determines question count per decision; 3–6 is guidance, not a hard limit.
- FR-023: After the initial round, the app may generate one additional round of follow-up Socratic questions based on the user's prior answers. Total Socratic round count is capped at 2 in the MVP. The decision to trigger the second round is made by the app's generator, not the user. Priority: must-have
  > Socrates: Counter-argument considered: "cap at 2 rounds total — 3 rounds is interrogation, not discovery." Resolution: revised — total cap is 2 rounds (was 3); 6–12 fewer questions in the worst case protects the ≤ 15-min target.
- FR-024: User receives 3 alternatives with trade-offs generated by the app (wizard step 3). Priority: must-have
  > Socrates: Counter-argument considered: "always 3 is artificial / 2 forces binary / 5 exposes breadth." Resolution: kept 3 — small enough to compare in one view, large enough to surface options the user hadn't pre-committed to.
- FR-025: User picks one anti-bias technique (devil's advocate / pre-mortem / unknown unknowns) at wizard step 4. The app runs the chosen technique against the captured decision + answers + alternatives, presents the output, and the user explicitly acknowledges it before continuing. Priority: must-have
  > Socrates: Counter-argument considered: "devil's advocate alone is weakest of the three; pre-mortem produces more concrete insight." Resolution: revised — restored the original idea.md scope (3 modes, user-pickable) instead of cutting to 1 mode. Small implementation cost (3 prompts + 3-button UI ≈ +2–4h); preserves anti-bias variety as a real product surface.
- FR-026: User receives a structured final document with five sections (needs / criteria / options / risks / open questions) rendered on screen (wizard step 5). Priority: must-have
  > Socrates: Counter-argument considered: "5 sections is rigid / fewer sections / add explicit 'recommendation'." Resolution: kept the 5-section schema as the load-bearing artifact shape.
- FR-027: The completed decision is automatically saved to the user's list on wizard completion. No explicit save button. Priority: must-have
  > Socrates: Counter-argument considered: "auto-save at wizard completion — no explicit save button." Resolution: revised — adopted auto-save; one less step at the end of an already-long flow.
- FR-028: User can copy the final artifact to clipboard as markdown. Priority: must-have
  > Socrates: Counter-argument considered: "redundant with FR-029 download — pick one." Resolution: kept both; clipboard and download serve distinct use-cases (paste vs archive).
- FR-029: User can download the final artifact as a .md file. Priority: must-have
  > Socrates: Counter-argument considered: "add PDF / add JSON / redundant with copy." Resolution: kept .md-only at MVP; other formats go to v2.

### Guardrails (defensive FRs)
- FR-030: User cannot navigate past the anti-bias step without completing it. Priority: must-have
  > Socrates: Counter-argument considered: "power users resent forced steps; offer skip-with-warning." Resolution: kept mandatory — the wedge is anti-bias as a forced step (re-confirmed in a dedicated contradiction check; Phase 1 core insight and Phase 3 guardrail supersede any power-user friction).
- FR-031: User's typed answers in earlier wizard steps survive a failure on a later step, without requiring page refresh. Priority: must-have
  > Socrates: Counter-argument considered: "in-memory state is enough — DB autosave between steps is over-engineering." Resolution: revised — in-memory recovery only; no DB autosave between wizard steps. A browser refresh / tab-close still loses in-progress wizard state (acceptable per phase-4 'one-shot wizard' decision).
- FR-032: User can never read another user's decisions or artifacts. Priority: must-have
  > Socrates: Counter-argument considered: "single-tenant prototype could skip explicit isolation." Resolution: kept; per-user isolation is non-negotiable the moment real users can sign in.

> Removed during Socrates: original **FR-012** (delete a saved decision) was dropped — decisions are an immutable record in MVP. Delete deferred to v2. Number FR-012 is permanently retired (no renumbering).

## Non-Functional Requirements

- A user sees acknowledgement of any input within 200 ms, and continuous visible progress during any wizard step that takes longer than two seconds (no silent waits).
- The magic-link sign-in round-trip — from the user clicking "send me a link" to landing on an authenticated view after clicking the link in their inbox — completes within 60 seconds under normal email-delivery conditions.
- The product remains usable on the latest two major versions of the four mainstream desktop browsers.

## Business Logic

Distill walks a user through a forced six-step Socratic interview (description →
questions → alternatives → anti-bias pass → structured artifact → save) and produces
a needs/criteria/options/risks/open-questions document the user could not have
written from a free-form chat.

The rule consumes three user-facing inputs: a free-text description of the decision
(step 1), the user's answers to a generated set of Socratic questions (step 2,
optionally one follow-up round at step 2b), and the user's choice of which anti-bias
technique to apply (step 4). The rule's output is the structured artifact (step 5).
The user encounters the rule as a wizard whose steps cannot be skipped or reordered;
specifically, the anti-bias step (4) is mandatory and the artifact step (5) cannot
be reached without it.

The rule is workflow-shaped (the app moves the user through states with mandatory
transitions) and the differentiator is the **forced** part. Free-form decision chat
already exists everywhere; the wedge is that this product refuses to produce the
artifact until the user has been through structure + anti-bias. The artifact is the
deliverable; the wizard is the rule that produces it.

## Access Control

Passwordless email / magic link login. One account = one user's decisions; the user
sees only their own. Flat user model — no admin, no team, no sharing, no per-decision
ACL. Unauthenticated users hitting a gated route are redirected to the magic-link
sign-in screen. The sign-up and sign-in flows are the same surface (magic link issues
an account on first use).

## Non-Goals

### Product-shape non-goals
- **Domain packs** (laptop / appliance / hire / framework presets) — MVP runs one
  general decision type. Per-domain prompt-tuning is a v2 capability.
- **Profile quiz** (rationalist / emotional / pragmatic / conservative) — MVP serves
  all personas with the same prompt shape; psychometric personalization is v2.
- **Multi-user / sharing / collaborative decisions** — MVP is flat-user; each user
  sees only their own data. Sharing and collaboration are v3-shaped concerns.
- **Live web-search integration** (pulling real prices / specs / reviews) — MVP
  structures only the user's own thinking; downstream research (browsing, pricing,
  spec-comparing) remains the user's job and happens outside the app.

### Process / scope-cut non-goals
- **Automated CI/CD pipeline (deploy on merge to main)** — manual deploy at MVP.
  Pipeline goes to v2.
- **Automated E2E test suite** — manual smoke test at MVP. Automated E2E goes to v2.
- **Editing a saved decision artifact** — saved artifacts are read-only in MVP.
- **Re-running the wizard against a saved decision (clone-and-iterate)** — deferred
  to v2.

## Open Questions

_The shape-notes quality cross-check on 2026-05-21 was accepted with no gaps to mirror. No open questions at PRD-draft time._
