---
starter_id: 10x-astro-starter
package_manager: npm
project_name: distill
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: cloudflare-builds
  ci_default_flow: manual-promotion
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Solo dev shipping a 3-week after-hours MVP with magic-link auth and LLM-driven
wizard steps (Socratic questions, alternatives, anti-bias, artifact). Web + JS
recommended default is 10x Astro Starter — Astro 6 + React 19 + TypeScript +
Tailwind 4 + Supabase + Cloudflare Pages/Workers — and it clears all four
agent-friendly gates. Supabase ships magic-link auth out of the box (covers
FR-001/2/3); TypeScript + Zod fit the FR-031 "in-memory wizard state survives
errors" contract; edge runtime constraints don't bite because no realtime / no
background jobs / no long-running work. Deployment lands on cloudflare-pages,
the starter's first default. Per PRD non-goal "manual deploy at MVP", no
GitHub Actions pipeline is wired now; Cloudflare is the build/deploy surface
and promotion is manual. Bootstrapper confidence is first-class.
