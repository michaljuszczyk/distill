# Artifact 3 — Contributors (Who Knows What, last 12 months)

**Method:** `git log --since="12 months ago" --no-merges --author=… -- <path>`, author-frequency aggregated per area, then per-person thematic breakdown across the whole tree.
**Filtered out (bots/automation):** `renovate[bot]` (111 commits — top "author" overall), `dependabot`, `Github Actions`/`github-actions`, `[bot]`, Copilot/Claude/Codex, and `sven-bitwarden` (release/automation account). No clearly-human AI-agent commits remained after filtering.

Areas chosen from Artifacts 1 & 2: the busiest/most-coupled domains plus the risky data-access seam.

---

## 1. `src/Core/AdminConsole` — busiest domain (orgs, members, policies, providers)

| Contributor    | Commits |               |
| -------------- | ------- | ------------- |
| Rui Tomé       | 50      | Primary owner |
| Jared McCannon | 33      |               |
| Brant DeBow    | 31      |               |
| Thomas Rittson | 28      |               |
| Jimmy Vo       | 23      |               |

**Concentration:** spread across ~5 active devs — a true team-owned area, not a bus-factor-1 zone. **Rui Tomé and Thomas Rittson** are the go-to pair (both also dominate `Api/AdminConsole` and `Infrastructure.EntityFramework/AdminConsole` — they own the full vertical slice).

## 2. `src/Core/Billing` — Stripe, subscriptions, invoices

| Contributor     | Commits |                |
| --------------- | ------- | -------------- |
| **Alex Morask** | 60      | Dominant owner |
| cyprain-okeke   | 24      |                |
| Stephon Brown   | 23      |                |
| Kyle Denney     | 18      |                |
| Conner Turnbull | 12      |                |

**Concentration:** **Alex Morask is the clear lead** (273 Billing-area commits tree-wide: Core/Billing + Api/Billing + Billing/Services). Knowledge moderately concentrated in 1 person + a supporting trio. Ask Alex first for anything Stripe/billing.

## 3. `src/Core/Auth` + `src/Identity/IdentityServer` — authN, 2FA, tokens, SSO grants

| Contributor (Auth)         | Commits |     | Contributor (IdentityServer) | Commits |
| -------------------------- | ------- | --- | ---------------------------- | ------- |
| Ike                        | 15      |     | Jared Snider                 | 13      |
| Jared Snider               | 11      |     | Ike                          | 12      |
| Patrick-Pimentel-Bitwarden | 7       |     | Todd Martin                  | 9       |
| Todd Martin                | 6       |     |                              |         |

**Concentration:** **Ike and Jared Snider** co-own the entire auth stack (Ike also owns `MailTemplates`, 66 commits; Jared Snider spans Auth + IdentityServer + Sql/dbo). Knowledge concentrated in this 2-person pair — a bus-factor risk for a security-critical area.

## 4. `src/Core/Dirt` — Data Insights & Reporting (risk/access reports)

| Contributor    | Commits |         |
| -------------- | ------- | ------- |
| Vijay Oommen   | 9       | Primary |
| Graham Walker  | 8       |         |
| Thomas Rittson | 3       |         |
| Jordan Aasen   | 3       |         |

**Concentration:** small, newer module; **Vijay Oommen + Graham Walker** are the owners. Low absolute volume — knowledge is thin (effectively 2 people), so verify with them before changing report logic.

## 5. `src/Api` + `src/Infrastructure.EntityFramework` — entry host & data seam

| Contributor (Api) | Commits |     | Contributor (EF)          | Commits |
| ----------------- | ------- | --- | ------------------------- | ------- |
| Rui Tomé          | 42      |     | Rui Tomé                  | 20      |
| Thomas Rittson    | 23      |     | Jared McCannon            | 10      |
| Alex Morask       | 21      |     | Thomas Rittson            | 8       |
| Jared McCannon    | 16      |     | Brant DeBow               | 8       |
| Justin Baur       | 15      |     | Nick Krantz / Justin Baur | 7       |

**Concentration:** broad — many hands, reflecting that Api and EF are cross-cutting. **Rui Tomé is the highest-touch person across Api + EF + AdminConsole + Sql/dbo**, i.e. the closest thing to a person who has seen the whole AdminConsole vertical slice including the Dapper/EF/Sql seam. **Justin Baur** appears across Api/EF/IdentityServer/Constants — looks like a platform/architecture-level contributor (good for cross-cutting/infra questions).

---

## Thematic ownership summary

| Person                           | Owns (theme)                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------- |
| **Rui Tomé**                     | AdminConsole full vertical slice (Core+Api+EF+Sql) — the org/members heavyweight |
| **Alex Morask**                  | Billing end-to-end (Stripe, invoices, subscriptions)                             |
| **Thomas Rittson**               | AdminConsole + Api + Sql/dbo (schema-aware AdminConsole)                         |
| **Jared McCannon**               | AdminConsole + the Dapper/EF/Sql data seam for that domain                       |
| **Ike**                          | Auth + IdentityServer + MailTemplates (auth + email)                             |
| **Jared Snider**                 | Auth + IdentityServer + Sql/dbo (auth data layer)                                |
| **Vijay Oommen / Graham Walker** | Dirt (reporting/insights)                                                        |
| **Justin Baur**                  | Cross-cutting platform/infra (Api, EF, Identity, Constants)                      |

**Overall:** AdminConsole, Billing, and Api are healthily team-owned (low bus-factor). **Auth and Dirt are the concentration risks** — each effectively owned by a 2-person pair, and Auth is security-critical.
