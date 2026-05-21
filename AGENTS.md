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
