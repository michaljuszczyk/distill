# Repository Guidelines

See `@README.md` for stack, setup, and prerequisites.

## Hard Rules

- API routes (`src/pages/api/**`) must export `const prerender = false` — `output: "server"` is set in `@astro.config.mjs`.
- Never commit `.env`, `.dev.vars`, or `.env.production` — all gitignored. Secrets reach prod via `npx wrangler secret put`.
- Read `SUPABASE_URL` / `SUPABASE_KEY` only via `astro:env/server` (server-only schema in `@astro.config.mjs`). Do not import them client-side.
- New Supabase tables require RLS enabled with granular per-operation, per-role policies.
- Migration filenames: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- No Next.js directives (`"use client"` etc.). React components are Astro islands.
- `context/archive/` is immutable — never edit files there; open a new change instead.
- CI gate (`@.github/workflows/ci.yml`) triggers on push/PR to `main`.

## Build, Test, and Dev Commands

Scripts live in `@package.json`. Project-specific notes:

- `npm run build` requires `SUPABASE_URL` / `SUPABASE_KEY` in env.
- `npx supabase start` needs Docker + ~7 GB RAM.
- `npx wrangler deploy` ships to Cloudflare Workers (config: `@wrangler.jsonc`).
- Pre-commit (`lint-staged` in `@package.json`) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Project Structure

- `src/pages/` — routes; `src/pages/api/` for endpoints (uppercase `GET`/`POST` exports, validate input with zod).
- `src/components/` — `.astro` for static, React under `ui/` (shadcn) and `auth/` for interactive.
- `src/lib/` — `supabase.ts` (SSR client), `utils.ts` (`cn()` helper), services.
- `src/middleware.ts` — resolves user, attaches to `context.locals.user`, redirects unauth from `PROTECTED_ROUTES`. Read auth state from `context.locals.user` in pages/endpoints.
- `src/layouts/`, `src/styles/global.css`, `src/types.ts` (shared DTOs).
- `supabase/`, `public/`, `wrangler.jsonc`.

## Style & Conventions

- Formatting per `@.prettierrc.json` (enforced by pre-commit).
- Path alias `@/*` → `src/*` (`@tsconfig.json`).
- Merge Tailwind classes with `cn()` from `@/lib/utils` — never concatenate class strings.
- Add shadcn components via `npx shadcn@latest add <name>` (config: `@components.json`); they land in `src/components/ui/`.
- Extract React hooks to `src/hooks/` (matches `@/hooks` alias in `@components.json`).

## Commit & PR

Repo has no commit history yet — convention TBD. Default to Conventional Commits (`feat:`, `fix:`, `chore:`) until the project decides otherwise. PR must pass CI (`astro sync` → lint → build).

## Lessons Learned

Project-specific recurring rules and incident learnings live in `@context/foundation/lessons.md`. Read this file before planning, implementation, or review when relevant to the current change. Add new entries via `/10x-lesson` when a pattern emerges.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 5

Scale the single-change cycle into parallel work with **worktrees, goal-directed delegation, and multi-session orchestration**:

```
worktree per change -> /goal or claude -p -> PR -> review -> merge
```

The lesson focus is safe throughput: isolated contexts, choosing the right execution mode, and capping parallelism at review capacity.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code isolation** | |
| `git worktree add` | You need a separate working directory for a parallel change. One change per worktree, one fresh agent context per worktree. |
| **Complex changes** | |
| `/10x-implement <change-id> phase <n>` | The change has multiple phases, needs manual gates, or benefits from interactive decision-making during execution. |
| **Simple changes** | |
| `/goal` | You have a clear, bounded task and want goal-directed delegation. The agent works autonomously toward the stated goal with a stop condition. |
| `claude -p` | You want headless execution for a well-defined task. The Ralph Wiggum loop (run, check, retry) is the universal autonomous pattern. |
| **Multi-session orchestration** | |
| Superset / Conductor / Antigravity / VS Code Agent View | You are running multiple agent sessions in parallel and need visibility, coordination, or session management across them. |

### Parallel work rules

- One change per worktree or isolated workspace. One fresh agent context per change.
- Choose interactive `/10x-implement` for complex changes, `/goal` or `claude -p` for simple ones.
- Parallelism is capped by review capacity. More agents without review means more unreviewed code, not higher throughput.
- The quality pain from faster shipping is intentional — it bridges into Module 3 testing gates.

### Lesson boundaries

- Do not reteach interactive `/10x-implement` or `/10x-impl-review`; those are Lessons 2 and 3.
- Do not introduce testing strategy here. The quality pain is the motivation for Module 3.
- Worktrees are a mechanism for isolation, not the topic of a full git tutorial.

### Paths used by this lesson

- `context/changes/<change-id>/` - active change folder
- `context/changes/<change-id>/plan.md` - implementation input for any execution mode

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
