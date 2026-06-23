# Intent Analysis — "history-as-intent" lens

Scope: classify three items previously flagged as "technical debt" as **ESSENTIAL** (deliberate, justified trade-off → GUARD) vs **ACCIDENTAL** (complexity/rot → FIX), using in-repo evidence only. Repo: `/Volumes/Lexar/_repos/bitwarden-server`. Analysis date: 2026-06-12. HEAD: `ba9463928` (2026-06-11).

---

## Item 1 — Dual data-access: Dapper + T-SQL stored procs (SqlServer) vs EF Core (Postgres/MySQL/SQLite), switched at runtime

**Verdict: ESSENTIAL.**

### Evidence

- **Runtime switch is intentional and central**, not an accident:
  `src/SharedWeb/Utilities/ServiceCollectionExtensions.cs:98-124` — `AddDatabaseRepositories` calls `GetDatabaseProvider(globalSettings)`, always runs `SetupEntityFramework`, then branches:
  ```
  if (provider != SupportedDatabaseProviders.SqlServer)
      services.AddPasswordManagerEFRepositories(globalSettings.SelfHosted);
  else
      services.AddDapperRepositories(globalSettings.SelfHosted);
  ```
- **Provider list is a deliberate product matrix** — `GetDatabaseProvider` (`ServiceCollectionExtensions.cs:816-852`) explicitly handles `postgres`, `mysql`, `sqlite`, defaulting to `SqlServer`. `SqlServer` is the default when `globalSettings.DatabaseProvider` is empty (line 820, 850-851).
- **README states the canonical store:** "The database is written in T-SQL/SQL Server." (`README.md:14`). SQL Server is the first-class production DB; EF providers are the self-host alternatives.
- **Self-host multi-DB is an officially documented, maintained capability**, not vestigial: `util/PostgresMigrations/README.md`, `util/MySqlMigrations/README.md`, `util/SqliteMigrations/README.md` each describe an EF migrator library "leveraged by hosted applications to perform … migrations via Entity Framework," linking to `contributing.bitwarden.com/contributing/database-migrations/`.
- **The two layers maintain functional parity behind one interface.** `CreateManyAsync` exists in both:
  - Dapper: `src/Infrastructure.Dapper/AdminConsole/Repositories/OrganizationUserRepository.cs:489-513` → calls sproc `[dbo].[OrganizationUser_CreateMany]`.
  - EF: `src/Infrastructure.EntityFramework/AdminConsole/Repositories/OrganizationUserRepository.cs:62-84` → `AddRangeAsync` + `SaveChangesAsync`.
    Same contract, two implementations — this is parallel maintenance for a supported deployment matrix, **not dead duplication**.

### Why essential (not accidental)

Bitwarden runs a SQL-Server-backed managed cloud (US/EU clusters per `README.md`) **and** ships self-host images where operators may pick Postgres/MySQL/SQLite. Supporting both genuinely requires two data-access strategies; collapsing to one would drop either hand-tuned SQL-Server performance or self-host DB choice. The complexity is inherent to the requirement.

**Guard or fix: GUARD.** This is essential complexity driven by the cloud-vs-self-host + multi-DB product requirement. The only legitimate "fix" would be a product decision to drop a database provider — not a refactor.

---

## Item 2 — Hand-written bulk stored procs in `src/Sql/dbo` (OrganizationUser_CreateMany / \_UpdateMany, OPENJSON bulk upserts)

**Verdict: ESSENTIAL (performance-motivated).**

### Evidence

- **Origin commit names the motive: scale.** `git log --follow` on `src/Sql/dbo/Stored Procedures/OrganizationUser_CreateMany.sql` bottoms out at:
  `785e788cb` — **"Support large organization sync (#1311)"** (Matt Gibson, 2021-05-17). Same commit raised org max seat size "from 30k to 2b" and split Azure event messages by size. The bulk proc was introduced specifically to make large-org member sync feasible. That is textbook performance intent.
- **The procs are genuine set-based bulk operations**, not trivial loops:
  - `OrganizationUser_CreateMany.sql` — single `INSERT … SELECT … FROM OPENJSON(@jsonData) WITH (...)` shredding a JSON payload into a typed rowset (one round-trip for N rows).
  - `OrganizationUser_UpdateMany.sql` — `OPENJSON` into a table var, single set-based `UPDATE … INNER JOIN`, then one batched `EXEC [dbo].[User_BumpManyAccountRevisionDates] @UserIds` (TVP `GuidIdArray`) instead of per-user revision bumps.
- **Callers pass batched JSON, confirming the design intent.** Dapper repo (`OrganizationUserRepository.cs:506-509`, `527-530`) serializes the whole collection once: `new { jsonData = JsonSerializer.Serialize(organizationUsers) }`, `CommandType.StoredProcedure`.
- **Pattern is actively extended, not frozen legacy.** Recent commits keep adding OPENJSON / bulk procs: `8a043895d feat(billing): add cohort assignment SyncManyAsync OPENJSON merge (PM-36963)`, `eacafaecf [PM-33951] … bulk confirmation and pending auto-confirmation (#7661)`, `2f893768f [PM-18718] Refactor Bulk Revoke Users (#6601)`. A living convention, not cruft.
- OPENJSON replaced an earlier TVP-style approach as the chosen bulk-marshalling mechanism; the procs are evolved deliberately (e.g. `ec01e81b0 [PM-33866] Revocation Reasons: DDL Edition` updated the column set), showing ongoing ownership.

### Why essential (not accidental)

The hand-written SQL exists to do N-row writes in one round-trip with one revision-date bump — a measurable hot path for large-org provisioning/sync. EF's `AddRange` equivalent is the fallback for non-SQL-Server self-host; SQL-Server cloud gets the tuned path. The hand-tuning is a justified trade-off, with an origin commit that literally says so.

**Guard or fix: GUARD.** Performance-essential, actively maintained, motive documented in history (#1311). Not debt.

---

## Item 3 — Two invite paths: legacy `OrganizationService.InviteUsersAsync` vs `InviteOrganizationUsersCommand`, behind flag `PublicMembersInviteRefactor`

**Verdict: ESSENTIAL — deliberate, in-flight Strangler Fig migration. GUARD until cutover (with a fix-the-flag caveat).**

### Evidence

- **Flag is a tracked, ticketed refactor**, not a hack: `src/Core/Constants.cs:140`
  `public const string PublicMembersInviteRefactor = "pm-33398-refactor-members-invite-org-users-command";`
  The flag value encodes the Jira ticket (PM-33398) and the explicit goal: "refactor members invite … org users command."
- **Classic Strangler Fig switch in the controller:** `src/Api/AdminConsole/Public/Controllers/MembersController.cs:173-185` — if flag enabled, route to `PostInviteUserAsync_vNext` (new `_inviteOrganizationUsersCommand.InviteImportedOrganizationUsersAsync`, lines 187-210); else fall through to legacy `_organizationService.InviteUserAsync`. New path produces a `CommandResult` and maps errors via `MapToBitException`.
- **Recency = live migration, not abandoned:**
  - Flag/refactor introduced `454a6dbc8 [PM-19143] Refactor public API MembersController POST to use CommandResult pattern (#7182)` — **2026-03-13**.
  - Last touched `e8c109ae5 [PM-35351] Fix refactor on self-hosted public API member invites by skipping plan retrieval (#7507)` — **2026-04-30**.
  - HEAD is **2026-06-11**. The refactor was actively being bug-fixed ~6 weeks before HEAD; follow-up `7c05036c0 [PM-19143] Fix custom permissions not persisting via InviteOrganizationUsersCommand (#7285)` shows continued hardening. Stale rot would not get fix commits this recent.
- **Multi-front, incremental cutover (the defining trait of a managed Strangler Fig):** `InviteOrganizationUsersCommand` is being adopted one entry point at a time, each behind its own flag:
  - Public API → `MembersController` (flag `PublicMembersInviteRefactor`).
  - SCIM → `bitwarden_license/src/Scim/Users/PostUserCommand.cs:35-40` routes to `_vNext` behind a **separate** flag `ScimInviteUserOptimization` (`InviteScimOrganizationUserAsync` legacy vs `_vNext`).
  - Import → `src/Core/AdminConsole/OrganizationFeatures/Import/ImportOrganizationUsersAndGroupsCommand.cs` and `OrganizationService.ImportAsync` (PM-19145 `947ae8db5`).
    This is a deliberate, surface-by-surface consolidation onto one command, not duplicated-by-accident.
- **Legacy path is still load-bearing and intentionally not yet migrated:** the web UI controller `src/Api/AdminConsole/Controllers/OrganizationUsersController.cs:286` still calls `_organizationService.InviteUsersAsync(...)` **unconditionally** (no flag). So the legacy method cannot be deleted yet — its continued existence is correct, not rot.

### Why essential (not accidental)

The duplication is the _expected transient state_ of a flag-gated migration that is provably active (commits within weeks of HEAD, ticket-encoded flag, multiple surfaces converging on one command). Removing either path today would break a supported entry point.

**Guard or fix: GUARD the duplication until cutover — but FIX the flag lifecycle.** The trade-off is justified _while migrating_. The real (small) debt risk is flag staleness: there are **two** independent flags (`PublicMembersInviteRefactor`, `ScimInviteUserOptimization`) plus the unflagged web path, and no in-repo cutover/cleanup commit yet. Track to completion: enable → bake → delete the legacy branches and flags. If activity stops, this flips toward ACCIDENTAL.

---

## Summary table

| #   | Item                                                                                               | Verdict                                 | Strongest single evidence                                                                                                                                                        | Call                                        |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Dapper+sproc (SqlServer) vs EF (PG/MySQL/SQLite) runtime switch                                    | **ESSENTIAL**                           | `ServiceCollectionExtensions.cs:98-124` provider branch + `README.md:14` "database is … T-SQL/SQL Server" + maintained EF migrator READMEs for self-host                         | **GUARD**                                   |
| 2   | Hand-written OPENJSON bulk procs (OrganizationUser_CreateMany/\_UpdateMany)                        | **ESSENTIAL**                           | Origin commit `785e788cb` "Support large organization sync (#1311)" — explicit scale/perf motive; pattern still actively extended                                                | **GUARD**                                   |
| 3   | Legacy `InviteUsersAsync` vs `InviteOrganizationUsersCommand` behind `PublicMembersInviteRefactor` | **ESSENTIAL** (in-flight Strangler Fig) | Ticket-encoded flag `Constants.cs:140`; controller switch `MembersController.cs:173-185`; fix commits to 2026-04-30 vs HEAD 2026-06-11; SCIM + import converging on same command | **GUARD until cutover; FIX flag lifecycle** |

## Blunt note on the "it's debt" framing

All three were mis-framed as debt. Items 1 and 2 are **essential complexity** with documented intent (product matrix; a 2021 perf commit that says "large organization sync"). Item 3 is **not duplication-by-accident** — it is a live, ticketed, flag-gated migration with commits within weeks of HEAD. The only genuine debt-adjacent risk is letting the item-3 feature flags go stale; nothing here is rot today.
