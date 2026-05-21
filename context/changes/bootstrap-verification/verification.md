---
bootstrapped_at: 2026-05-21T10:06:42Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: distill
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`:

```yaml
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
```

### Why this stack

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

## Pre-scaffold verification

| Signal       | Value                                                          | Severity | Notes                                                                |
| ------------ | -------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| npm package  | not run                                                        | n/a      | cmd_template starts with `git clone` — no npm CLI package to query   |
| GitHub repo  | przeprogramowani/10x-astro-starter last pushed 2026-05-17      | fresh    | from card.docs_url; checked 2026-05-21 (4 days delta)                |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 21 (top-level entries; `.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `astro.config.mjs`, `CLAUDE.md` → renamed `.scaffold`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `README.md`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold
**.gitignore handling**: moved silently (cwd had no `.gitignore`)
**.bootstrap-scaffold cleanup**: deleted (after `.git/` removal)

Install output excerpt:

```
added 774 packages, and audited 775 packages in 1m
309 packages are looking for funding
11 vulnerabilities (10 moderate, 1 high)
```

Deprecation warnings during install:

- `node-domexception@1.0.0` — deprecated (use platform native DOMException).
- `@babel/plugin-proposal-private-methods@7.18.6` — deprecated (merged to ECMAScript standard; use `@babel/plugin-transform-private-methods`).

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0

#### CRITICAL findings

(none)

#### HIGH findings

- **devalue** (transitive, range `5.6.3 - 5.8.0`) — GHSA-77vg-94rm-hx3p, "Svelte devalue: DoS via sparse array deserialization", CVSS 7.5 (CWE-770). `fixAvailable: true`.

#### MODERATE findings

Direct:

- **@astrojs/check** (`>=0.9.3`) — via `@astrojs/language-server`. Fix: downgrade to `0.9.2` (semver-major).
- **@astrojs/cloudflare** (`>=12.2.4`) — via `@cloudflare/vite-plugin`, `wrangler`. Fix: downgrade to `12.6.13` (semver-major).
- **wrangler** (`<=0.0.0-kickoff-demo || >=3.108.0`) — via `miniflare`. Fix: downgrade to `3.107.3` (semver-major).

Transitive:

- **@astrojs/language-server** (`>=2.14.0`) — via `volar-service-yaml`; effects: `@astrojs/check`.
- **@cloudflare/vite-plugin** (`<=0.0.0-fff677e35 || >=0.0.7`) — via `miniflare`, `wrangler`, `ws`; effects: `@astrojs/cloudflare`.
- **miniflare** (`<=0.0.0-fff677e35 || >=3.20250204.0`) — via `ws`; effects: `@cloudflare/vite-plugin`, `wrangler`.
- **volar-service-yaml** (`<=0.0.70`) — via `yaml-language-server`; effects: `@astrojs/language-server`.
- **ws** (`8.0.0 - 8.20.0`) — GHSA-58qx-3vcg-4xpx, "ws: Uninitialized memory disclosure", CVSS 4.4 (CWE-908). Effects: `@cloudflare/vite-plugin`, `miniflare`.
- **yaml** (`2.0.0 - 2.8.2`) — GHSA-48c2-rrv3-qjmp, "yaml is vulnerable to Stack Overflow via deeply nested YAML collections", CVSS 4.3 (CWE-674). Effects: `yaml-language-server`.
- **yaml-language-server** — via `yaml`; effects: `volar-service-yaml`.

#### LOW / INFO findings

(none)

**Dependency totals**: prod 430, dev 316, optional 131, peer 24 — total 895.

## Hints recorded but not acted on

| Hint                       | Value             |
| -------------------------- | ----------------- |
| bootstrapper_confidence    | first-class       |
| quality_override           | false             |
| path_taken                 | standard          |
| self_check_answers         | null              |
| team_size                  | solo              |
| deployment_target          | cloudflare-pages  |
| ci_provider                | cloudflare-builds |
| ci_default_flow            | manual-promotion  |
| has_auth                   | true              |
| has_payments               | false             |
| has_realtime               | false             |
| has_ai                     | true              |
| has_background_jobs        | false             |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history. (Note: this cwd already carries a `.git/` directory from before bootstrap.)
- Review `CLAUDE.md.scaffold` against the existing `CLAUDE.md` and decide which version to keep (or merge).
- Address audit findings per your project's risk tolerance — direct findings (`@astrojs/check`, `@astrojs/cloudflare`, `wrangler`) are the actionable starting point; the transitive HIGH on `devalue` is fix-available.
