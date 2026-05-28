<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Data Foundation — `decisions` schema, RLS, and shared DTOs

- **Plan**: context/changes/data-foundation/plan.md
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

supabase/migrations absent ✓, src/types.ts absent ✓, zod absent in package.json ✓, env.d.ts:1-5 matches plan ✓, src/lib/supabase.ts:1-24 matches ✓, supabase/config.toml major_version=17 ✓, PRD anchors FR-025 / FR-030 / FR-032 / US-03 verified ✓. No docs/reference/contract-surfaces.md (skipped).

## Findings

### F1 — Manual RLS smoke needs explicit transaction wrap

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 Manual Verification (1.6/1.7/1.8) and Implementation Note
- **Detail**: `SET LOCAL` is a no-op outside a transaction. Studio's per-statement implicit txns silently leave the session running as `postgres` superuser (RLS bypassed). INSERT/SELECT then report the superuser's view, not the authenticated role's — giving false confirmation on the only failure mode the plan calls non-recoverable.
- **Fix A ⭐ Recommended**: Wrap each verification block in `begin; ... rollback;` (multi-statement); seed A's row as superuser, run SELECT-as-A / SELECT-as-B / UPDATE-as-A / DELETE-as-A each inside its own wrapped txn.
  - Strength: Minimal edit; documented Supabase RLS test pattern.
  - Tradeoff: User must remember BEGIN/ROLLBACK; Studio multi-statement quirks possible.
  - Confidence: HIGH.
  - Blind spot: Studio multi-statement behavior — needs one smoke test before relying.
- **Fix B**: Verify via PostgREST + real JWTs (`curl` against `localhost:54321/rest/v1/decisions`).
  - Strength: Real prod code path.
  - Tradeoff: More setup; needs two signed-in users + tokens; S-01 (magic-link) not built yet.
  - Confidence: HIGH.
  - Blind spot: Requires CLI sign-in or admin token grant.
- **Decision**: Fixed via Fix A (plan Manual Verification rewritten with begin;...rollback; wrappers and explicit seed step).

### F2 — `acknowledged_at` is client-supplied for an "audit trail"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: migration column + zod schema spec
- **Detail**: `acknowledged_at timestamptz NOT NULL` had no DB default; zod said "ISO timestamp produced client-side". An audited party writing its own timestamp is weak — clock skew, wizard-step bug, manipulation. PRD acceptance is already satisfied by row existence + `anti_bias_technique`.
- **Fix**: `acknowledged_at timestamptz not null default now()`; drop the field from `NewDecisionInputSchema`; `Decision` row type retains it for read.
  - Strength: Server-trusted; one fewer field S-02 must produce.
  - Tradeoff: Couples ack-time to insert-time (fine for MVP since S-02 only inserts post-ack per FR-030); breaks if v2 introduces draft-save.
  - Confidence: HIGH.
- **Decision**: Fixed (migration default added; DTO updated; `Decision` shape explicitly adds `acknowledged_at`).

### F3 — Artifact validator allows empty strings inside arrays

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ArtifactSchema spec
- **Detail**: `z.string().array().min(1)` accepts `["", ""]`. PRD US-01 "none is empty" reads as both array-non-empty AND strings-non-empty.
- **Fix**: `z.array(z.string().min(1)).min(1)` per section.
- **Decision**: SKIPPED.

### F4 — `summary NOT NULL` may overconstrain a nice-to-have

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: migration + DTO
- **Detail**: FR-013 is nice-to-have. If S-02 summary derivation fails, NOT NULL blocks save.
- **Fix**: `summary text not null default ''` — fail-soft; S-02 overrides when derivation succeeds.
- **Decision**: Fixed (migration column updated; Contract paragraph annotated).

### F5 — `z.enum([...])` is more idiomatic than literal union

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: AntiBiasTechniqueSchema spec
- **Detail**: `z.enum(['devils_advocate','pre_mortem','unknown_unknowns'])` is shorter and gives a typed `.options` array S-02 can consume to render the 3-button picker.
- **Fix**: Use `z.enum([...])` instead of `z.union([z.literal(...), ...])`.
- **Decision**: Fixed (AntiBiasTechniqueSchema spec rewritten to z.enum form).

## Triage Summary

- Fixed: F1 (Fix A), F2, F4, F5  (4)
- Skipped: F3                     (1)
- Verdict after fixes: SOUND
