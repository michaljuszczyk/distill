# Artifact 1 — Territory (Git History, last 12 months)

**Repo:** bitwarden/server · **HEAD:** `ba94639` (2026-06-11) · **Window:** ~2025-06 → 2026-06
**Non-merge commits analyzed:** 1,461 · **Method:** `git log --since="12 months ago" --no-merges --name-only`, aggregated and noise-filtered in Python.

**Noise filtered out:** `*.Designer.cs`, `*.json` (appsettings/configs), `*.md/.txt/.yml`, lockfiles, `*.resx` / localization, `*.snap`, and the bulk EF migration projects (`util/{MySql,Postgres,Sqlite}Migrations`, `**/Migrations/`). T-SQL migration _scripts_ under `util/Migrator/DbScripts` and stored procs under `src/Sql/dbo` are KEPT (they are hand-authored, not generated).

---

## 1. Top modules (directory depth-2)

| Rank | Module                               | Commits touching it | Note                                          |
| ---- | ------------------------------------ | ------------------- | --------------------------------------------- |
| 1    | `src/Core`                           | 3,776               | The center of gravity — everything lives here |
| 2    | `test/Core.Test`                     | 1,141               | Tracks Core 1:1                               |
| 3    | `src/Api`                            | 1,134               | Main HTTP host / controllers                  |
| 4    | `src/Sql`                            | 438                 | Hand-written T-SQL stored procedures          |
| 5    | `util/Seeder`                        | 416                 | Test-data seeding (active new tooling)        |
| 6    | `test/Api.Test`                      | 388                 |                                               |
| 7    | `src/Infrastructure.EntityFramework` | 324                 | EF data access                                |
| 8    | `src/Identity`                       | 219                 | Auth/SSO host                                 |
| 9    | `src/Billing`                        | 212                 | Billing host                                  |
| 10   | `src/Admin`                          | 165                 | Internal admin portal                         |
| —    | `src/Infrastructure.Dapper`          | 136                 | Dapper data access (less active than EF)      |

`src/Core` alone is so dominant that depth-2 is too coarse — drilled into depth-3 below.

## 2. Top hands-on areas (directory depth-3) — where the real work happens

| Rank | Area                                  | Commits | Theme                                                                           |
| ---- | ------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| 1    | `src/Core/AdminConsole`               | 1,048   | **Organizations, members, policies, provider mgmt — the busiest domain by far** |
| 2    | `src/Core/Billing`                    | 621     | Stripe/subscriptions/invoices                                                   |
| 3    | `src/Sql/dbo`                         | 432     | Stored procedures + table defs                                                  |
| 4    | `test/Core.Test/AdminConsole`         | 404     |                                                                                 |
| 5    | `src/Api/AdminConsole`                | 361     | AdminConsole HTTP controllers                                                   |
| 6    | `src/Core/Constants.cs` (single file) | 295     | **Repo-wide common denominator — see §5**                                       |
| 7    | `test/Core.Test/Billing`              | 285     |                                                                                 |
| 8    | `src/Core/Dirt`                       | 281     | "Data Insights & Reporting Tools" (risk reports, member access reports)         |
| 9    | `src/Core/Auth`                       | 275     | Authn, 2FA, WebAuthn, device approval                                           |
| 10   | `src/Core/MailTemplates`              | 194     | Transactional email                                                             |
| —    | `src/Identity/IdentityServer`         | 158     | Token/grant pipeline                                                            |
| —    | `src/Core/KeyManagement`              | 120     | Crypto key rotation                                                             |

**Top single files (noise-filtered):**

| Commits | File                                                                       | Why it's hot                                                |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 295     | `src/Core/Constants.cs`                                                    | Holds 147 feature-flag keys — every feature toggle edits it |
| 50      | `src/SharedWeb/Utilities/ServiceCollectionExtensions.cs`                   | The DI composition root for all web hosts                   |
| 41      | `Directory.Build.props`                                                    | Repo-wide build config                                      |
| 40      | `src/Core/Core.csproj`                                                     | Dependency churn on the hub                                 |
| 39      | `src/Api/AdminConsole/Controllers/OrganizationUsersController.cs`          | Hottest controller                                          |
| 37      | `src/Core/Settings/GlobalSettings.cs`                                      | Global config surface                                       |
| 36      | `src/Core/Services/Implementations/UserService.cs`                         | God-ish user service                                        |
| 35      | `src/Core/OrganizationFeatures/OrganizationServiceCollectionExtensions.cs` | Org feature DI                                              |
| 28      | `src/Core/Vault/Services/Implementations/CipherService.cs`                 | Core vault item logic                                       |
| 28      | `src/Api/Vault/Controllers/CiphersController.cs`                           |                                                             |

All top files/areas were **verified to still exist** in the working tree (no ghosts).

## 3. Emphasis shift by quarter

| Quarter | #1 area            | Rising / notable                                                                 |
| ------- | ------------------ | -------------------------------------------------------------------------------- |
| 2025-Q2 | AdminConsole       | `Core/Dirt` already #2; partial quarter (window start)                           |
| 2025-Q3 | AdminConsole (282) | Billing surges (171); **Auth + IdentityServer spike** (93 + 84) — an auth push   |
| 2025-Q4 | AdminConsole (236) | **Dirt jumps to #3 (112)**; Constants.cs enters top-5 (flag-heavy quarter)       |
| 2026-Q1 | AdminConsole (211) | Billing near-equal (175); **MailTemplates spike (95)** — email/notification work |
| 2026-Q2 | AdminConsole (254) | **`src/Sql/dbo` jumps to #2 (155)** — a schema/stored-proc heavy quarter         |

**Takeaway:** AdminConsole is the permanent #1 every quarter. Billing is a steady strong #2. Secondary pushes rotate: Auth/Identity (Q3'25) → Dirt (Q4'25) → Mail (Q1'26) → SQL schema (Q2'26).

## 4. Co-changes (coupling)

**Module level (depth-2), excluding the obvious src↔its-test pairs:**

| Pairs co-changing                                              | Count  | Interpretation                                                                       |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `src/Api` ↔ `src/Core`                                         | 270    | Controller + service edited together (vertical slices)                               |
| `src/Sql` ↔ `util/Migrator`                                    | 114    | New stored proc ⇒ new migration script (always together)                             |
| `src/Core` ↔ `Infrastructure.EntityFramework`                  | 110    | Repo interface in Core + EF impl                                                     |
| `src/Core` ↔ `Infrastructure.Dapper`                           | 93     | Repo interface in Core + Dapper impl                                                 |
| **`Infrastructure.Dapper` ↔ `Infrastructure.EntityFramework`** | **92** | **Both data-access impls edited in the SAME commit — the key seam (see Artifact 2)** |
| `Infrastructure.EntityFramework` ↔ `src/Sql`                   | 90     | EF migration mirrors a stored-proc change                                            |

**Sub-domain level (depth-3 within src):**

| Pair                                                                                 | Count |
| ------------------------------------------------------------------------------------ | ----- |
| `Api/AdminConsole` ↔ `Core/AdminConsole`                                             | 93    |
| `Core/AdminConsole` ↔ `Core/OrganizationFeatures`                                    | 49    |
| `Core/AdminConsole` ↔ `Infrastructure.EntityFramework/AdminConsole`                  | 49    |
| `Core/AdminConsole` ↔ `Sql/dbo`                                                      | 46    |
| `Infrastructure.EntityFramework/AdminConsole` ↔ `Sql/dbo`                            | 45    |
| `Api/Billing` ↔ `Core/Billing`                                                       | 41    |
| `Infrastructure.Dapper/AdminConsole` ↔ `Infrastructure.EntityFramework/AdminConsole` | 35    |

### Coupling conclusions — top 3 areas

1. **AdminConsole is a 5-layer vertical slice.** A typical change touches `Api/AdminConsole` (controller) + `Core/AdminConsole` (service/command) + `Infrastructure.EntityFramework/AdminConsole` (EF repo) + `Infrastructure.Dapper/AdminConsole` (Dapper repo) + `Sql/dbo` (stored proc) + a `util/Migrator/DbScripts` migration. **Adding one feature here means editing 5–6 directories across 4 projects.** Highest change-cost area in the repo.
2. **Billing is a tighter 3-layer slice:** `Api/Billing` + `Core/Billing` + `Billing/Services`, with less data-layer churn (more Stripe-API-facing than DB-facing).
3. **The data-access seam couples Dapper + EF + Sql/dbo together** (92 / 90 / 45 co-change counts). Any repository signature change must be applied to _both_ Dapper and EF implementations **and** the stored procedure — three parallel edits for one logical change.

## 5. The repo-wide common denominator

**`src/Core/Constants.cs` is the single global hotspot.** In the 295 commits that touched it, it co-changed with **every one of the 12 top-level `src` modules** — Core, Api, Sql, EF, Identity, Admin, Billing, Dapper, SharedWeb, Notifications, Events, Icons. Reason: it holds **147 `const string` keys, the bulk being `FeatureFlagKeys`.** Every feature behind a flag (and Bitwarden flags almost everything) adds/removes a key here. It is a low-risk file mechanically (string constants) but a **merge-conflict magnet** and a useful index of "what's being built."

Secondary cross-cutting files: `SharedWeb/Utilities/ServiceCollectionExtensions.cs` (DI root, 50) and `Core/Settings/GlobalSettings.cs` (config, 37).

## 6. Ghost check

All strongly-coupled and top-frequency files/directories listed above were checked against the working tree with `test -e` and **all still exist**. No analysis here rests on moved/deleted paths.
