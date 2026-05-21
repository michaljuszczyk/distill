# Distill

A Socratic decision wizard. Bring a nontrivial decision — a purchase, a hire, a technical choice, a home renovation — and Distill walks you through a structured interview, then forces an anti-bias check (devil's advocate, pre-mortem, or unknown unknowns) before producing a portable decision brief: needs, options, risks, and open questions for further research.

**Live:** https://distill.mc-juszczyk98.workers.dev

For the product vision, MVP scope, personas, and FRs, see [`context/foundation/prd.md`](context/foundation/prd.md).

## Tech Stack

- [Astro](https://astro.build/) v6 — server-first web framework
- [React](https://react.dev/) v19 — interactive islands
- [TypeScript](https://www.typescriptlang.org/) v5
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Supabase](https://supabase.com/) — auth + Postgres
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment

## Prerequisites

- Node.js v22.14.0 (see `.nvmrc`)
- npm (ships with Node)
- Docker + ~7 GB RAM (only if running Supabase locally)

## Getting Started

1. Clone:

```bash
git clone <repo-url>
cd distill
```

2. Install:

```bash
npm install
```

3. Configure Supabase — see [Supabase Configuration](#supabase-configuration) below.

4. Create local Cloudflare dev secrets file:

```bash
cp .env.example .dev.vars
```

5. Run the dev server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — Start dev server (Cloudflare workerd runtime)
- `npm run build` — Build for production
- `npm run preview` — Preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — Auto-fix ESLint issues
- `npm run format` — Prettier

## Project Structure

```
.
├── src/
│   ├── layouts/        # Astro layouts
│   ├── pages/          # Astro pages
│   │   └── api/        # API endpoints
│   ├── components/     # UI (.astro + React)
│   ├── lib/            # Supabase client, helpers
│   ├── middleware.ts   # Auth resolution + route protection
│   └── ...
├── public/             # Static assets
├── supabase/           # Local Supabase config + migrations
├── context/            # Project foundation docs (PRD, tech-stack, etc.)
└── wrangler.jsonc      # Cloudflare Workers config
```

## Supabase Configuration

Distill uses [Supabase](https://supabase.com/) for authentication and Postgres. Environment variables are declared via Astro's `astro:env` schema and treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is at `http://localhost:54323`.

### Using a hosted Supabase project

| Variable       | Source                                                     |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

Supabase requires email confirmation before sign-in by default. To skip during local dev:

1. Open the Supabase dashboard for your project
2. **Authentication → Email → Confirm email**
3. Toggle it **off**

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

Distill deploys to [Cloudflare Workers](https://workers.cloudflare.com/). Current production URL: https://distill.mc-juszczyk98.workers.dev

1. Build:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets via Cloudflare dashboard or `npx wrangler secret put`.

## CI

GitHub Actions runs lint + build on every push and PR to `main`. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step.

## License

MIT
