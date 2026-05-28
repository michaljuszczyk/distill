# Data Foundation — `decisions` schema, RLS, and shared DTOs

## Overview

Land the `decisions` table (Supabase Postgres) with per-user RLS, and export the shared row + input + artifact types — plus their zod schemas — from `src/types.ts`. Schema is load-bearing for S-02 (wizard auto-save) and S-03 (decisions list + artifact view); it must be right the first time because the MVP timeline does not absorb a second migration round.

The slice writes **no UI, no endpoints, no business logic**. It is the data contract everything downstream binds against.

## Current State Analysis

- `supabase/migrations/` directory does not exist (`supabase/` holds `config.toml` and `auth/` only). This is the first migration.
- `src/types.ts` does not exist. CLAUDE.md and `AGENTS.md` already name it as the shared-DTO location.
- `zod` is not in `package.json` dependencies; CLAUDE.md "Hard Rules" require zod validation at API boundaries. Adding it here makes it available before S-02 needs it.
- Supabase SSR client is wired at `src/lib/supabase.ts`; middleware at `src/middleware.ts:6-22` resolves `auth.user` into `context.locals.user`. The `user_id` FK target — `auth.users` — already exists in every Supabase project.
- `astro.config.mjs:11,16` sets `output: "server"` with the Cloudflare adapter, so any future API route reading these tables will run on the edge; nothing in this slice depends on that.
- Supabase CLI version `2.23.4` is in `devDependencies`. Local dev uses `npx supabase start` (Docker required).
- Migration filename rule (from `CLAUDE.md`): `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.

## Desired End State

After this slice:

- `supabase/migrations/20260528082724_create_decisions.sql` exists, applies cleanly via `npx supabase db reset`, and creates: the `decisions` table with all columns + constraints + indexes, RLS enabled, and two policies (SELECT, INSERT) scoped to `auth.uid() = user_id`.
- `npx supabase db reset` shows the table in Studio with RLS enabled and no UPDATE/DELETE policies (deny-by-default for owners; MVP immutability).
- `src/types.ts` exports: `Decision` (row type), `Artifact` (5-section structure), `AntiBiasTechnique` (literal union of the 3 modes), `NewDecisionInput` (S-02 write DTO), and the matching zod schemas (`ArtifactSchema`, `AntiBiasTechniqueSchema`, `NewDecisionInputSchema`).
- `zod` is a runtime dependency in `package.json`.
- `astro sync` succeeds; `npm run lint` passes with no new warnings; `npm run build` succeeds with `SUPABASE_URL` / `SUPABASE_KEY` set.
- A manual `INSERT` via Supabase Studio as user A, then SELECT as user B, returns zero rows for B — RLS proven on real auth, not just policy text.

### Key Discoveries

- `src/lib/supabase.ts:5-24` already returns `null` when env is missing; the SSR client uses `parseCookieHeader`. No change needed here, but it means downstream code must handle `client === null` (already a CLAUDE.md-shaped contract).
- `src/env.d.ts:1-5` declares `App.Locals.user` typed against `@supabase/supabase-js.User`. Reuse that — do not redefine it.
- PRD US-03 acceptance criterion: anti-bias acknowledgment "is captured and persisted with the saved decision (audit trail — proves the wedge happened)". This is what `anti_bias_technique` + `acknowledged_at` columns satisfy at the data layer.
- PRD FR-013 (one-line preview, nice-to-have): handled by `summary text` written by S-02 — schema accommodates without dictating S-02's derivation choice (LLM call vs reuse of step-1 description).
- PRD non-goals "Editing a saved decision artifact" and "FR-012 delete removed" → enforced at data layer by absence of UPDATE/DELETE RLS policies. Future v2 adds them; MVP cannot mutate.
- Cloudflare adapter has no impact on migrations (server-side Supabase only).

## What We're NOT Doing

- No API endpoints. `POST /api/decisions`, `GET /api/decisions`, `GET /api/decisions/[id]` are S-02 / S-03 territory.
- No UI. No pages under `src/pages/decisions/**`.
- No wizard state model — FR-031's in-memory wizard-state shape is an S-02 unknown, not a data-layer concern.
- No `socratic_qa` / `alternatives` / Q&A history columns. Not required by any FR; YAGNI.
- No soft-delete (`deleted_at`) — MVP is immutable; v2 introduces delete with its own RLS UPDATE policy.
- No `updated_at` column or `BEFORE UPDATE` trigger — there is no UPDATE path in MVP, so the column would always equal `created_at`.
- No generated Supabase TypeScript types (`supabase gen types typescript`). Hand-rolled in `src/types.ts`; one source of truth.
- No supabase seed data. The smoke test inserts one row manually in Studio for the cross-user RLS check, then discards it.
- No GitHub Actions CI step that runs migrations against a remote DB. PRD non-goal "Automated CI/CD pipeline".

## Implementation Approach

Two phases, sequential. Phase 1 lands the migration and verifies RLS on real auth in local Supabase. Phase 2 lands the types + zod and verifies the build pipeline still works.

The migration is one SQL file. The types file is one TypeScript file. Both are small. The risk is correctness, not size — get the column shape and policy shape right.

## Critical Implementation Details

- **`user_id` FK target**: `auth.users(id)` lives in the `auth` schema (Supabase-managed). The FK must read `references auth.users(id) on delete cascade`. Cascade is the right choice — when a user is deleted from auth, their decisions go with them.
- **RLS deny-by-default**: enabling RLS on a table without an UPDATE policy means UPDATE is denied for all roles (including the owner). This is the desired behavior for MVP immutability. Do NOT add a permissive ALL-operations policy "just in case."
- **CHECK constraint values are snake_case literals** (`devils_advocate`, `pre_mortem`, `unknown_unknowns`) — the zod schema's literal union must match these exactly, not display strings.
- **`gen_random_uuid()` requires the `pgcrypto` extension** in older Postgres; Postgres 17 (per `supabase/config.toml:36`) has it built in via `pg_catalog`, no `CREATE EXTENSION` needed.

---

## Phase 1: Migration — `decisions` schema + RLS

### Overview

Create `supabase/migrations/` directory and add the first migration that defines `decisions`, enables RLS, and adds SELECT + INSERT policies scoped to the owner. Verify locally by resetting the local DB and running a cross-user isolation check in Studio.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260528082724_create_decisions.sql`

**Intent**: First migration. Define `decisions`, the user-scoped FK, NOT NULL constraints on required columns, the anti-bias CHECK, an index for the list view, and per-operation RLS policies. The file is the data contract everything else binds against — keep it self-contained, no app-level dependencies.

**Contract**: `public.decisions` table with columns `id uuid PK default gen_random_uuid()`, `user_id uuid NOT NULL references auth.users(id) on delete cascade`, `description text NOT NULL`, `summary text NOT NULL default ''` (fail-soft for FR-013 nice-to-have; S-02 overrides when derivation succeeds), `artifact jsonb NOT NULL`, `anti_bias_technique text NOT NULL CHECK (anti_bias_technique IN ('devils_advocate','pre_mortem','unknown_unknowns'))`, `acknowledged_at timestamptz NOT NULL default now()` (server-trusted — S-02 inserts only after ack per FR-030, so insert-time IS ack-time), `created_at timestamptz NOT NULL default now()`. Index `decisions_user_id_created_at_idx` on `(user_id, created_at desc)` (list view query). RLS enabled. Two policies on role `authenticated`: `decisions_select_own` for SELECT using `auth.uid() = user_id`; `decisions_insert_own` for INSERT with check `auth.uid() = user_id`. No UPDATE/DELETE policies (denied by default). Migration also revokes ALL on `decisions` from `anon` (defensive — RLS already blocks, but the role should not have grants).

```sql
-- 20260528082724_create_decisions.sql
-- First migration. Creates decisions table for Distill MVP.
-- Single JSONB artifact column (5 sections). RLS-isolated per owner.
-- UPDATE/DELETE intentionally have no policy (MVP immutability).

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  summary text not null default '',
  artifact jsonb not null,
  anti_bias_technique text not null
    check (anti_bias_technique in ('devils_advocate','pre_mortem','unknown_unknowns')),
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index decisions_user_id_created_at_idx
  on public.decisions (user_id, created_at desc);

alter table public.decisions enable row level security;

revoke all on public.decisions from anon;

create policy decisions_select_own
  on public.decisions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy decisions_insert_own
  on public.decisions
  for insert
  to authenticated
  with check (auth.uid() = user_id);
```

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npx supabase db reset` exits 0 and prints `Applying migration 20260528082724_create_decisions.sql...`.
- Table exists with all expected columns: `psql "$LOCAL_DB_URL" -c '\d public.decisions'` shows 8 columns, types match.
- RLS is enabled: `psql -c "select relrowsecurity from pg_class where relname='decisions';"` returns `t`.
- Policies present: `psql -c "select polname, polcmd from pg_policy where polrelid = 'public.decisions'::regclass order by polname;"` returns exactly `decisions_insert_own (a)` and `decisions_select_own (r)`.
- Anon has no grants: `psql -c "select privilege_type from information_schema.role_table_grants where grantee='anon' and table_name='decisions';"` returns 0 rows.

#### Manual Verification

> Note: `SET LOCAL` is only honored inside an explicit transaction. Studio's SQL editor commits each "Run" as its own implicit txn, which discards `LOCAL` settings before the next statement and silently leaves the session running as `postgres` superuser (RLS bypassed). Every block below MUST be submitted as a single multi-statement run wrapped in `begin; ... rollback;` — otherwise the test reports the superuser's view, not the authenticated role's.

- Cross-user RLS smoke in Supabase Studio:
  1. Create two test users in `auth.users` (capture their UUIDs as `<A.id>`, `<B.id>`).
  2. Seed one row owned by A (run as superuser, bypassing RLS for setup):
     ```sql
     insert into public.decisions (user_id, description, summary, artifact, anti_bias_technique, acknowledged_at)
     values ('<A.id>', 'seed', 'seed', '{"needs":["x"],"criteria":["x"],"options":["x"],"risks":["x"],"open_questions":["x"]}'::jsonb, 'devils_advocate', now());
     ```
  3. SELECT as A — should see 1 row:
     ```sql
     begin;
       set local role authenticated;
       set local "request.jwt.claims" = '{"sub":"<A.id>"}';
       select count(*) from public.decisions;  -- expect 1
     rollback;
     ```
  4. SELECT as B — should see 0 rows:
     ```sql
     begin;
       set local role authenticated;
       set local "request.jwt.claims" = '{"sub":"<B.id>"}';
       select count(*) from public.decisions;  -- expect 0
     rollback;
     ```
- Attempted UPDATE as the owner is rejected (RLS deny), wrapped:
  ```sql
  begin;
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"<A.id>"}';
    update public.decisions set summary='x' where user_id='<A.id>';  -- expect "UPDATE 0"
  rollback;
  ```
- Attempted DELETE as the owner is rejected, wrapped:
  ```sql
  begin;
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"<A.id>"}';
    delete from public.decisions where user_id='<A.id>';  -- expect "DELETE 0"
  rollback;
  ```

**Implementation Note**: After Phase 1 automated checks pass, pause for the manual cross-user RLS check before starting Phase 2. The RLS shape is the single non-recoverable failure mode in this slice — confirm it works on real auth, not on policy text alone.

---

## Phase 2: Shared DTOs + zod schemas in `src/types.ts`

### Overview

Add `zod` as a runtime dependency. Create `src/types.ts` with the row type, write DTO, artifact structure, anti-bias union, and matching zod schemas. This file is the single source of truth for the data contract across the codebase; S-02 and S-03 will both import from it.

### Changes Required

#### 1. Add zod dependency

**File**: `package.json`

**Intent**: Make zod available as a runtime dep. CLAUDE.md hard rule requires zod for API input validation; S-02 will validate `NewDecisionInput` on POST, so the dep belongs in `dependencies`, not `devDependencies`.

**Contract**: `dependencies.zod` set to the current 4.x major (`^4.0.0` or whatever `npm view zod version` returns at the time of install). Runs `npm install zod` — lockfile updates, no transitive surprises (zod has zero runtime deps).

#### 2. Shared DTO + zod file

**File**: `src/types.ts`

**Intent**: Single export surface for everything the data layer's consumers need. Type definitions are derived from zod schemas where possible (`z.infer<typeof X>`) so the runtime validator and the compile-time type cannot drift apart. Row type uses the shapes plus DB-managed columns (`id`, `user_id`, `created_at`). No supabase-generated types; this file is the contract.

**Contract**: Exports —

- `AntiBiasTechniqueSchema`: `z.enum(['devils_advocate', 'pre_mortem', 'unknown_unknowns'])` (values must match the migration's CHECK exactly; `.options` is consumable by S-02 UI for rendering the 3-button picker).
- `AntiBiasTechnique`: `z.infer<typeof AntiBiasTechniqueSchema>`.
- `ArtifactSchema`: zod object with five required fields, each a non-empty `z.string().array().min(1)` (matches PRD acceptance "none is empty"). Fields: `needs`, `criteria`, `options`, `risks`, `open_questions`.
- `Artifact`: `z.infer<typeof ArtifactSchema>`.
- `NewDecisionInputSchema`: zod object — `description: z.string().min(1)`, `summary: z.string().min(1)`, `artifact: ArtifactSchema`, `anti_bias_technique: AntiBiasTechniqueSchema`. `acknowledged_at` is server-defaulted, NOT part of the write DTO.
- `NewDecisionInput`: `z.infer<typeof NewDecisionInputSchema>`.
- `Decision`: `NewDecisionInput & { id: string; user_id: string; acknowledged_at: string; created_at: string }` — the full row shape as returned from Supabase (`acknowledged_at` and `created_at` arrive as ISO strings over the wire).

The file has no side effects, no imports from `astro:env/server`, no imports from `@/lib/supabase`. It is pure type + schema.

### Success Criteria

#### Automated Verification

- `npm install zod` exits 0; `package.json` and `package-lock.json` updated and committed.
- `npx astro sync` exits 0 (Astro can resolve `src/types.ts`).
- Type check passes: `npx astro check` reports 0 errors in `src/types.ts` (and no new errors elsewhere).
- Lint passes: `npm run lint` exits 0 with no new warnings.
- Build passes: `SUPABASE_URL=stub SUPABASE_KEY=stub npm run build` exits 0.
- Imports resolve via the `@/*` alias: a smoke check `node -e "require('node:fs').existsSync('src/types.ts') && process.exit(0)"` returns 0 (trivial, but proves the file landed at the expected path).

#### Manual Verification

- Open `src/types.ts` in the editor; hovering each exported symbol shows a non-`any` type with the expected fields.
- Round-trip the zod schema on a sample payload in a Node REPL or scratch file: `NewDecisionInputSchema.parse({...valid sample...})` returns the parsed object; passing an invalid `anti_bias_technique` value throws.

**Implementation Note**: After Phase 2 automated checks pass, pause for the manual hover/REPL check before marking the slice done. Type drift between the migration CHECK and the zod literal union is the silent-failure mode here.

---

## Testing Strategy

### Unit Tests

None. PRD non-goal: "Automated E2E test suite … manual smoke test at MVP." Per the lessons file (empty) and CLAUDE.md, there is no project-wide unit-test harness yet. Adding one here is out of scope.

### Integration Tests

None. The cross-user RLS check in Phase 1's Manual Verification is the integration test — it runs against real auth and real RLS, not against a mock.

### Manual Testing Steps

Already enumerated in each phase's Manual Verification section. No standalone repro.

## Performance Considerations

- The `(user_id, created_at desc)` index covers the S-03 list query (`select ... where user_id = $1 order by created_at desc`). Postgres index scan, not a seq scan, even on the first row.
- JSONB stores the artifact inline (Postgres TOAST handles >2KB); read latency for `select artifact from decisions where id = $1` is dominated by network, not storage.
- No expected hot-path concerns at MVP scale (handful of users, small data volume per the PRD frontmatter).

## Migration Notes

This is the first migration. There is no existing `decisions` table or data to migrate from. Rollback is `drop table public.decisions cascade;` — if the migration ships to prod and needs reverting before any user has saved a decision, that one statement is enough. After users start saving, rolling back means data loss; expect to write a forward-only fix migration instead.

## References

- Roadmap entry: `context/foundation/roadmap.md:59-70` (F-01: Data foundation, ready)
- PRD anchors: `context/foundation/prd.md:88-131` (US-01, US-03, US-04), `context/foundation/prd.md:163-179` (FR-013, FR-026, FR-027, FR-030, FR-032)
- CLAUDE.md hard rules: `CLAUDE.md:5-13` (RLS required, migration filename, env-var server-only)
- Tech stack: `context/foundation/tech-stack.md` (10x-astro-starter, Supabase, Cloudflare Workers)
- Supabase client: `src/lib/supabase.ts:1-24`
- Middleware contract: `src/middleware.ts:1-25` (`context.locals.user`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration — `decisions` schema + RLS

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — fc95528
- [x] 1.2 Table has 8 columns with expected types: `psql \d public.decisions` — fc95528
- [x] 1.3 RLS enabled: `pg_class.relrowsecurity = t` — fc95528
- [x] 1.4 Policies present: `decisions_select_own` (r) + `decisions_insert_own` (a) only — fc95528
- [x] 1.5 Anon has no grants: `information_schema.role_table_grants` returns 0 rows — fc95528

#### Manual

- [x] 1.6 Cross-user RLS smoke: user B sees 0 rows for user A's decision — fc95528
- [x] 1.7 UPDATE as owner is rejected by RLS — fc95528
- [x] 1.8 DELETE as owner is rejected by RLS — fc95528

### Phase 2: Shared DTOs + zod schemas in `src/types.ts`

#### Automated

- [x] 2.1 `npm install zod` exits 0; lockfile updated — 482d70b
- [x] 2.2 `npx astro sync` exits 0 — 482d70b
- [x] 2.3 `npx astro check` reports 0 errors in `src/types.ts` — 482d70b
- [x] 2.4 `npm run lint` exits 0 with no new warnings — 482d70b
- [x] 2.5 `SUPABASE_URL=stub SUPABASE_KEY=stub npm run build` exits 0 — 482d70b
- [x] 2.6 `src/types.ts` exists at expected path — 482d70b

#### Manual

- [x] 2.7 Hover-check in editor: all exports have non-`any` types with expected fields — 482d70b
- [x] 2.8 REPL round-trip: `NewDecisionInputSchema.parse(validSample)` succeeds; invalid technique throws — 482d70b
