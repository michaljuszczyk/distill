# Data Foundation — Plan Brief

> Full plan: `context/changes/data-foundation/plan.md`

## What & Why

Land the `decisions` table in Supabase with per-user RLS, plus shared row + DTO + artifact types and zod schemas exported from `src/types.ts`. This is roadmap F-01 — the load-bearing data contract that S-02 (wizard auto-save) and S-03 (decisions list + artifact view) both bind against. Schema correctness here removes a future migration from a 3-week MVP timeline.

## Starting Point

`supabase/migrations/` does not exist (empty `supabase/` holds only `config.toml` and `auth/`). `src/types.ts` does not exist. `zod` is not a dependency. Supabase SSR client and middleware (`context.locals.user`) are already wired. Auth uses Supabase email+password today; magic-link is S-01, not blocking.

## Desired End State

One migration file in `supabase/migrations/`, applied cleanly via `npx supabase db reset`. The `decisions` table holds eight columns (`id`, `user_id`, `description`, `summary`, `artifact`, `anti_bias_technique`, `acknowledged_at`, `created_at`) with RLS enabled and SELECT + INSERT policies scoped to the owner. UPDATE and DELETE have no policy — denied by default, enforcing MVP immutability at the data layer. `src/types.ts` exports `Decision`, `Artifact`, `AntiBiasTechnique`, `NewDecisionInput` and matching zod schemas; types are derived from schemas so they cannot drift.

## Key Decisions Made

| Decision                                              | Choice                                                                                                                         | Why (1 sentence)                                                                                                 | Source |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| Artifact storage shape                                | Single `artifact jsonb` column holding all five sections                                                                        | One read covers the artifact view; matches PRD-locked 5-section schema; zod validates on insert.                 | Plan   |
| FR-013 one-line preview source                        | Dedicated `summary text NOT NULL` column written at save                                                                        | List query is trivial; preview is a curated string; S-02 picks the derivation (LLM or step-1 reuse) at write.    | Plan   |
| RLS shape + MVP immutability                          | SELECT + INSERT policies for `auth.uid() = user_id`; no UPDATE/DELETE policies (deny by default)                                | Enforces "no edit, no delete in MVP" at the data layer, not in the UI; matches PRD non-goals and FR-032.         | Plan   |
| Anti-bias audit trail (US-03 acceptance)              | Dedicated columns: `anti_bias_technique text NOT NULL CHECK (...)` + `acknowledged_at timestamptz NOT NULL`                     | Audit signal is queryable and DB-validated, not buried in JSONB; CHECK gives type safety on a closed enum.       | Plan   |
| DTO + zod location                                    | Hand-rolled in `src/types.ts`; no `supabase gen types`                                                                           | Single source of truth per CLAUDE.md; types derived from zod schemas via `z.infer`; no regen step to remember.   | Plan   |
| Extra column for wizard step-1 raw input              | Add `description text NOT NULL`                                                                                                  | Preserves the user's pre-Socratic framing for future v2 "re-run wizard"; cheap; complements `summary`.           | Plan   |

## Scope

**In scope:**
- One migration: `decisions` table, FK to `auth.users` with `on delete cascade`, index on `(user_id, created_at desc)`, RLS enabled, SELECT + INSERT policies.
- One TypeScript file: `src/types.ts` with row + DTO + artifact types and zod schemas.
- `zod` added to runtime dependencies.

**Out of scope:**
- API endpoints (`POST /api/decisions`, `GET /api/decisions[/id]`) — that's S-02 / S-03.
- Any UI (decisions list, artifact view, wizard).
- Wizard in-memory state model (FR-031) — S-02 concern.
- `socratic_qa` / `alternatives` columns, soft-delete, `updated_at` triggers, supabase-generated types, automated tests, CI/CD wiring.

## Architecture / Approach

Two sequential phases. Phase 1 writes the SQL migration and verifies RLS on real auth in local Supabase Studio (cross-user SELECT, blocked UPDATE/DELETE). Phase 2 adds the zod dependency and the type/schema exports, then verifies via `astro sync` + `astro check` + `npm run build`. Data flow has only one path so far: any future write (S-02) will `NewDecisionInputSchema.parse()` request body, then `supabase.from('decisions').insert()` — RLS guarantees ownership; no business logic in this slice.

## Phases at a Glance

| Phase                                                | What it delivers                                                                                  | Key risk                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1. Migration — `decisions` schema + RLS              | `supabase/migrations/20260528082724_create_decisions.sql` applied; table + index + policies live  | RLS policy text passes inspection but fails on real auth — covered by Manual cross-user smoke test.     |
| 2. Shared DTOs + zod schemas in `src/types.ts`       | `zod` installed; `src/types.ts` exports row + DTO + artifact types + zod schemas                  | Drift between migration CHECK literals and zod literal union — covered by REPL round-trip + hover check. |

**Prerequisites:** Docker running (for `npx supabase start`); local Supabase started; Supabase CLI 2.23.4 (already in devDependencies).
**Estimated effort:** ~1 evening session (≤ 2h); 2 phases, no cross-cutting concerns.

## Open Risks & Assumptions

- **Assumption:** the 5-section artifact shape (needs / criteria / options / risks / open questions) is final at MVP — PRD FR-026 is locked. If S-02 finds a section is dead weight, the JSONB column accommodates the shape change without a column migration (only the zod schema changes).
- **Assumption:** S-02 generates `acknowledged_at` and `summary` client-side / server-side at save time. Schema enforces `NOT NULL` on both; S-02 must always produce them.
- **Risk:** the migration runs only locally at MVP (manual deploy per PRD non-goal). Promotion to remote Supabase before S-02 ships is a one-line `npx supabase db push`; not automated.

## Success Criteria (Summary)

- A migration file landed in `supabase/migrations/`, applies cleanly, and creates the table + index + policies.
- A real cross-user RLS smoke proves user B sees zero of user A's rows; UPDATE and DELETE on owner's own row are rejected.
- `src/types.ts` exports the agreed type + zod surface; `astro check`, `npm run lint`, and `npm run build` all pass.
