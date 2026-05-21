---
project: distill
researched_at: 2026-05-21
recommended_platform: Cloudflare Workers (with Static Assets)
runner_up: Vercel (Next.js + Vercel Pro)
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd)
decision_frame: learning-weighted — Cloudflare picked to combine "ship MVP" with "learn Cloudflare + agentic dev" goals from the 10xDevs course context. A purely app-optimal pick would be Next.js + Vercel Pro; this decision consciously trades that for learning surface.
---

## Recommendation

**Deploy on Cloudflare Workers (with Static Assets), starting on the free Workers plan.**

Astro 6 + React 19 + Supabase SSR maps cleanly to the Workers runtime; Cloudflare acquired The Astro Technology Company on 2026-01-16, making Astro a first-party citizen on Cloudflare. The free tier (10 ms CPU per request, 3 MB gzipped bundle, 100k requests/day) is intentionally chosen as a learning-mode constraint — boundary-testing the runtime is part of the value of this project, not just a side-effect. If real-user testing surfaces 1027 CPU errors or bundle ceiling, flipping to Workers Paid ($5/mo flat, account-level, unlimited Workers) is a one-click toggle with no code change.

A purely app-optimal pick would be Next.js + Vercel Pro (smoother DX for a React-heavy interactive wizard, mature ecosystem, no CPU caps to dodge). That trade was considered and rejected for this project because the developer has Vercel+Next.js experience already and wanted Cloudflare+agentic-dev as the learning surface. The pivot path to Vercel+Next.js remains a documented escape hatch.

## Platform Comparison

Hard filters applied — neither dropped any candidate:
- **Persistent processes**: not required (PRD has no realtime, no background jobs).
- **Astro 6 SSR support**: all six platforms support it via adapters.

Scoring against the five agent-friendly criteria. LLM streaming requests (60–120 s) treated as a wall-clock concern, not CPU.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 P** |
| **Railway** | Pass | Pass | Pass | Pass | Pass | **5 P** |
| **Render** | Pass | Pass | Pass | Pass | Pass | **5 P** |
| Netlify | Pass | Pass | Pass | Partial (UI rollback) | Pass | 4 P / 1 Pt |
| Fly.io | Pass | Partial (Dockerfile) | Pass | Pass | Pass | 4 P / 1 Pt |
| Vercel | Pass | Pass | Pass | Partial (Hobby 1-step rollback) | Partial (Beta) | 3 P / 2 Pt |

Soft weights applied:
- Q3 familiarity (Cloudflare) → tie-break toward Cloudflare among the three 5-Pass platforms.
- Q2 cost vs DX (roughly equal) → neutral.
- Q4 single region OK → no global-edge penalty; Cloudflare's global edge becomes a free bonus.
- Q5 external services fine → no co-location preference; Supabase already external.

**Critical findings that shaped scoring:**
- **Vercel Hobby is non-commercial only.** Fair Use Guidelines prohibit revenue-generating projects. A "real product on a public URL with real magic-link auth" (PRD Success Criteria) crosses that line → effective Vercel cost is **$20/mo Pro from day one**, not $0.
- **Cloudflare acquired Astro on 2026-01-16.** Astro 6's dev server runs natively on workerd via the Cloudflare Vite plugin — no separate `wrangler dev` for local development. Cloudflare's Astro framework guide now lives under `/workers/framework-guides/`.
- **Pages → Workers shift.** Cloudflare Pages is in maintenance mode (not deprecated, but no new features). Workers + Static Assets reached feature parity in March 2026 and is the current canonical target for new Astro SSR apps. `context/foundation/tech-stack.md` says `cloudflare-pages` — that term should be read as "Cloudflare's edge platform"; the concrete deploy target for Distill is **Workers with Static Assets**.
- **Netlify sync functions cap at 60 s** — LLM streams 60–120 s would force Edge Function proxy routing; added complexity not worth it.
- **Fly.io requires a Dockerfile and credit card after 7-day trial** — operational friction for a 3-week MVP.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

5 passes across all criteria. Astro is now first-party (acquisition 2026-01-16). Free tier sized to absorb expected MVP traffic (100k req/day = 3M/mo; Distill at typical adoption ≪ that). Awaited `fetch()` to OpenAI/Anthropic counts as wall-clock, **not CPU** — 60–120 s LLM streams pass through fine even on free's 10 ms CPU cap. Free-tier bundle ceiling of 3 MB gzipped is the realistic constraint (Astro 6 + React 19 + `@supabase/ssr` with `nodejs_compat` shim + LLM SDK trends toward 1.8–2.5 MB gzipped). Edge-global at no extra cost. MCP servers GA across docs, builds, and observability. Developer is already familiar with Cloudflare Pages; Workers is the adjacent learning surface they want.

#### 2. Railway

5 passes across all criteria. Container model, no streaming limit under 15 min, flat $5/mo Hobby with $5 usage credit (a small Astro Node container typically stays inside that credit). Official Railway MCP Server at `mcp.railway.com`. Astro 6 first-class via Railpack auto-detect. Lower migration-churn risk than Cloudflare (no fresh acquisition-driven shifts). Strong runner-up if the CPU/bundle constraints on Cloudflare become untenable AND a stack pivot to Next.js is not desired.

#### 3. Render

5 passes across all criteria. **100-minute request duration cap** is the standout — explicitly marketed for LLM streaming. Official MCP server (GA Aug 2025) at `mcp.render.com/mcp`. Starter $7/mo flat (Web Service, 512 MB / 0.5 vCPU) eliminates the 15-min cold-start sleep that the free tier imposes. Pro-Astro template + `render.yaml` ready-made. Best option if the limiting factor turns out to be LLM call duration rather than CPU per request.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **CPU budget tight for LLM result-processing.** Free tier 10 ms CPU per request leaves little headroom once Astro SSR + Supabase SSR cookie middleware + Zod validation of structured LLM responses + markdown rendering of the artifact run on the same request. Each ~5–10 ms cost compounds.
2. **`@supabase/ssr` + `nodejs_compat` bundle weight.** `@supabase/ssr` pulls `node:stream` shims; the gzipped bundle creeps toward the 3 MB free / 10 MB paid ceiling as the LLM SDK + zod + markdown renderer accumulate.
3. **Fresh acquisition churn risk.** Less than 5 months of post-acquisition integration between Cloudflare and Astro. Docs, adapter conventions, and recommended patterns may shift mid-MVP; an `npm update` could break a working deploy.
4. **Pages-vs-Workers terminology drift.** `tech-stack.md` says "cloudflare-pages". Without explicit alignment, the developer might wire the project to legacy Pages instead of Workers + Static Assets, and migrate again in 6 months.
5. **Subrequest limit (50 free / 1000 paid)** sneaks up on tool-calling LLM loops. Anti-bias step that fans out to multiple Supabase reads + an LLM call per branch can approach the free cap.
6. **Free CPU failures are non-deterministic.** Tail-latency events surface only at production scale, not in dev. Local `astro dev` on workerd does not enforce CPU limits the same way prod does — bugs hide.

### Pre-Mortem — How This Could Fail

Six months in, Distill on Cloudflare Workers turns out to be a disaster. Three things stack. **First**, the developer underestimates the post-acquisition migration story. Astro 6.4 ships with a renamed `@astrojs/cloudflare` adapter and consolidated conventions; the working deploy breaks on `npm update`. A weekend disappears chasing config. **Second**, bundle size creeps. The team adds an LLM-streaming SDK, a structured-output validator (zod schema for each wizard step), and a markdown renderer for artifact export. Gzipped bundle crosses 3 MB free; flipping to paid uncovers `@supabase/ssr` shim weight that no amount of tree-shaking helps. **Third**, the wizard's "long agent call" pattern (the anti-bias step calls the LLM with several tool-uses) triggers the 30 s CPU cap on paid because each tool-use does meaningful local JSON parse + zod validation in addition to the awaited fetch. Configuring `cpu_ms = 300000` works but observability becomes critical, and on free tier the failures are silent — users see broken wizards, the dev sees nothing without `wrangler tail` running. By month 4, they migrate to Next.js + Vercel Pro: three weekends of pivot work that the MVP couldn't afford during the original three-week window.

### Unknown Unknowns

- **Astro dev server on workerd ≠ identical to `wrangler dev`.** The Cloudflare Vite plugin path is the new canonical local-dev surface for Astro 6 — `wrangler dev` against the built output still works, but is now the secondary path. Tutorials online still say `wrangler dev`. Use the Astro-native dev path; cross-check against the pinned adapter version, not general docs.
- **Workers Logs vs Tail are distinct surfaces.** `wrangler tail` streams live, won't backfill. For retention you need Workers Logs (separate observability product). On free tier, **this is the only way to catch silent 1027 errors** — wiring it from day one is mandatory, not optional.
- **Node 22 required locally for build**, even though runtime is workerd. CI must match. `.nvmrc` already in repo — verify it pins ≥ 22.
- **Secrets vs vars distinction is load-bearing.** `wrangler secret put` is the only path for `SUPABASE_KEY` per the project's `CLAUDE.md`. Putting it in `[vars]` in `wrangler.jsonc` exposes it (checked in or not, leaks via PR diffs). Easy mistake.
- **Per-isolate in-memory state.** PRD FR-031 ("typed answers survive a step failure") is satisfied within a single browser session by client-side state. Don't accidentally rely on server-side in-memory caching across requests — different requests can hit different isolates with no shared memory. If LLM-response memoization is added later, use Cache API / KV explicitly.
- **Hobby ToS is not a Cloudflare concept.** Unlike Vercel, Cloudflare Workers Free has no non-commercial restriction. A production product on Workers Free is allowed — the limits are technical (CPU/bundle/requests), not legal.

## Operational Story

- **Preview deploys**: Wrangler creates per-deployment preview URLs (`<commit>.<project>.workers.dev`). PR previews via GitHub integration also supported when wired. No Cloudflare Access protection at MVP — preview URLs are unlisted but technically public. Acceptable for solo dev; revisit before first external user round.
- **Secrets**: `npx wrangler secret put SUPABASE_KEY` (per environment). Local development reads from `.dev.vars` (gitignored, per `CLAUDE.md`). GitHub Secrets not needed at MVP because no CI/CD deploy pipeline (manual deploy per PRD non-goal). Rotation: `wrangler secret put` re-issues; no separate rotation flow.
- **Rollback**: `npx wrangler rollback [deployment-id]` — deterministic, one command, returns success/fail. Time-to-revert under 30s. **Caveat**: rollback reverts code only; Supabase migrations do not roll back automatically. If a deploy contained a migration, run `supabase migration down` separately.
- **Approval**: Production deploy (`wrangler deploy`) is the only command requiring human-in-loop at MVP. Secret rotation also human-only. Read-only operations (`wrangler tail`, `wrangler deployments list`, log queries via Workers Logs) may be agent-driven unattended.
- **Logs**: **Workers Logs is mandatory from day one** for this stack — free tier silent CPU failures (1027 errors) are otherwise invisible. Enable in `wrangler.jsonc` via `observability.enabled = true`. Read live with `npx wrangler tail`; query historical via Cloudflare dashboard or the observability MCP server (`observability.mcp.cloudflare.com/mcp`).

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free 10 ms CPU exceeded on wizard step that combines middleware + zod parse + markdown render | Devil's advocate / Pre-mortem | M | M | Day-1 smoke test with `wrangler tail` to baseline CPU per request type; flip to paid $5/mo (account-level, no code change) the moment 1027 errors appear. |
| Bundle gzipped > 3 MB free / > 10 MB paid | Devil's advocate / Pre-mortem | M | M | Lazy-load LLM SDK and markdown renderer into specific routes; audit bundle on each `npm install` of a non-trivial dep. |
| Astro × Cloudflare convention churn from fresh acquisition | Devil's advocate / Pre-mortem | L–M | M | Pin `@astrojs/cloudflare` to a known-good minor; treat `npm update` as a deliberate event, not a routine. |
| `tech-stack.md` says "cloudflare-pages" but deploy target is Workers + Static Assets | Devil's advocate | L | L | Update tech-stack.md or carry this infrastructure.md as the corrective contract; bootstrap to Workers, not Pages. |
| Silent 1027 CPU errors invisible to dev | Pre-mortem / Unknown unknowns | M | H | **Wire Workers Logs from day one** (`observability.enabled = true` in `wrangler.jsonc`). Run `wrangler tail` during early user testing. |
| Secrets accidentally written to `wrangler.jsonc` `[vars]` instead of `wrangler secret put` | Unknown unknowns | M | H | Pre-commit hook or manual audit: no `SUPABASE_KEY` / `ANTHROPIC_API_KEY` strings appear in `wrangler.jsonc`. |
| `wrangler dev` used instead of Astro-native dev server, leading to non-canonical local-dev path | Unknown unknowns | M | L | Use `npm run dev` (Astro on workerd via Vite plugin) for local development; reserve `wrangler dev` for built-output verification before deploy. |
| LLM call chains exceed 50-subrequest free cap on multi-step anti-bias flows | Devil's advocate | L | M | Audit max subrequest count per wizard step; consolidate Supabase reads; consider paid plan if free cap blocks anti-bias step. |
| Cross-isolate state assumption (server-side in-memory cache for LLM results) | Unknown unknowns | L | M | Cache API or KV for any cross-request memoization. PRD FR-031 stays in-browser, no risk there. |
| Stack pivot (Astro → Next.js, Cloudflare → Vercel) consumes 1–2 month of post-MVP time | Pre-mortem | L–M | H | Set a hard pivot trigger: month 2 review checkpoint. If Cloudflare friction eats more time than it teaches, full pivot to Next.js + Vercel Pro. No hybrid Astro-on-Cloudflare + API-on-other-platform — that's a worse failure mode than either pure option. |
| Manual deploy (no CI/CD per PRD non-goal) → human-error production push | Research finding | M | M | `wrangler rollback` is the safety net. Pin a "before-deploy" checklist (build clean, secret presence, schema match) in `AGENTS.md` after MVP. |

## Getting Started

These commands are validated for the Astro 6 + `@astrojs/cloudflare` v13.x stack pinned in this project. Avoid copying CLI patterns from generic Cloudflare tutorials; many still reference legacy Pages workflows.

1. **Install wrangler** (account-level CLI):
   ```bash
   npm install -D wrangler
   npx wrangler login
   ```

2. **Verify Workers + Static Assets target.** `wrangler.jsonc` should declare `main` pointing at the Astro Cloudflare build output (e.g., `./dist/_worker.js`) and an `assets` block pointing at `./dist`. The `@astrojs/cloudflare` adapter produces this layout automatically — confirm `astro.config.mjs` uses `output: "server"` and imports the adapter. **Do not** treat this project as a legacy Pages deployment; deploy as a Worker.

3. **Wire Workers Logs (mandatory for free tier)**. In `wrangler.jsonc`:
   ```jsonc
   "observability": {
     "enabled": true,
     "head_sampling_rate": 1
   }
   ```
   This enables log retention so silent 1027 CPU failures are visible after the fact.

4. **Set production secrets** (do not commit, do not put in `[vars]`):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   Local dev reads from `.dev.vars` (gitignored).

5. **Deploy:**
   ```bash
   npm run build
   npx wrangler deploy
   ```
   Successful deploy returns the workers.dev URL. Roll back if needed:
   ```bash
   npx wrangler rollback
   ```

6. **Day-1 smoke test (the learning experiment).** Build one wizard step end-to-end (description → LLM call → Supabase save → SSR render). Run `npx wrangler tail` while exercising it from another terminal/browser. Capture baseline CPU-ms per request from the logs. If baseline is 5–8 ms → free tier is realistic. If baseline is 12–18 ms → enable Workers Paid ($5/mo flat) before adding more wizard steps.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration (not required for Workers deploys)
- CI/CD pipeline setup (manual deploy at MVP per PRD non-goal)
- Production-scale architecture (multi-region, HA, DR) — single-region MVP only
- Workers AI, R2, D1, KV, Queues — not required for Distill; Supabase covers DB + storage
- Cloudflare zone-level features (CDN, firewall, Pro/Business plans) — Workers Free covers the deploy surface; zone-level $20+/mo not applicable
