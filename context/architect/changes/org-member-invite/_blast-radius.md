# Blast Radius — Org Member Invite / Confirm / Accept

Lens: **what must change TOGETHER** when modifying the org member invite/management flow.
Repo: `bitwarden/server`. Evidence = (a) static type/usage graph + (b) git co-change history.
State only — no refactor proposals. `unknown` = not statically verifiable from C# project graph.

---

## 0. Critical structural fact: there are TWO invite paths

The internal API and the public API invite through **different stacks**. A change to "invite"
may need to touch one or both.

| Path                  | Controller                                                                  | Logic entry                                                                                                       | Repo write                                             |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Legacy / internal** | `OrganizationUsersController.Invite` (`OrganizationUsersController.cs:286`) | `IOrganizationService.InviteUsersAsync` → `src/Core/AdminConsole/Services/Implementations/OrganizationService.cs` | `OrganizationUserRepository.CreateManyAsync`           |
| **New / public**      | `Public/Controllers/MembersController.cs:64`                                | `IInviteOrganizationUsersCommand` → `InviteUsers/InviteOrganizationUsersCommand.cs`                               | `CreateManyAsync(IEnumerable<CreateOrganizationUser>)` |

The new command path is gated by feature flag `PublicMembersInviteRefactor` (`pm-33398-refactor-members-invite-org-users-command`, `Constants.cs:140`). **Easy-to-forget:** "fix invite" applied to only one path silently diverges behavior between internal and public APIs.

---

## 1. THE DATA SEAM — ranked #1 (highest, proven 5-way atomic change)

Any change to a repository method on this flow must be made in **5 places in one commit**.
This is not inferred — it is observed in a single real commit.

**Exemplar commit `4de10c83` "[PM-26636] Set Key when Confirming (#6550)"** touched exactly:

1. `src/Infrastructure.Dapper/AdminConsole/Repositories/OrganizationUserRepository.cs` (Dapper impl)
2. `src/Infrastructure.EntityFramework/AdminConsole/Repositories/OrganizationUserRepository.cs` (EF impl)
3. `src/Sql/dbo/Stored Procedures/OrganizationUser_ConfirmById.sql` (stored proc)
4. `util/Migrator/DbScripts/2025-11-06_00_ConfirmOrgUser_AddKey.sql` (hand-written T-SQL migration)
5. `test/Infrastructure.EFIntegration.Test/AdminConsole/Repositories/OrganizationUserRepositoryTests.cs` (parity test)

The interface `IOrganizationUserRepository` (`src/Core/AdminConsole/Repositories/IOrganizationUserRepository.cs`) is the 6th — changed whenever the method signature changes (e.g. `ConfirmOrganizationUserAsync:131`, `ConfirmManyOrganizationUsersAsync:145`, `CreateManyAsync:122`).

**Why it matters:** SqlServer runs the Dapper stored-proc; Postgres/MySQL/SQLite run the EF method. A change in one without the other = correct on one DB engine, broken/silently divergent on the others. The `Sql/` proc is in a `.sqlproj` invisible to the C# build graph, so the compiler will NOT catch a missed proc edit.

### Write-path methods in this flow and their proc + EF bindings

| Repo method (interface line)                                    | Dapper stored proc                                                            | EF impl    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `CreateManyAsync(IEnumerable<CreateOrganizationUser>)` (`:122`) | `[dbo].[OrganizationUser_CreateManyWithCollectionsAndGroups]` (Dapper `:662`) | EF `:947`  |
| `CreateManyAsync(IEnumerable<OrganizationUser>)` (`:60`)        | bulk insert (Dapper `:489`)                                                   | EF `:62`   |
| `CreateAsync(obj, collections)` (`:59`)                         | `[dbo].[OrganizationUser_CreateWithCollections]` (Dapper `:396`)              | —          |
| `ConfirmOrganizationUserAsync` (`:131`)                         | `[dbo].[OrganizationUser_ConfirmById]` (Dapper `:692`)                        | EF `:997`  |
| `ConfirmManyOrganizationUsersAsync` (`:145`)                    | proc (Dapper `:704`)                                                          | EF `:1019` |
| `GetByOrganizationEmailAsync` (`:66`)                           | `[dbo].[OrganizationUser_ReadByOrganizationIdEmail]` (Dapper `:452`)          | —          |
| `SelectKnownEmailsAsync` (`:22`)                                | `[dbo].[OrganizationUser_SelectKnownEmails]` (Dapper `:114`)                  | —          |
| `GetManyPendingAutoConfirmAsync` (`:152`)                       | proc                                                                          | EF         |

**SQL proc files (must hand-edit; not in C# graph):**

- `src/Sql/dbo/AdminConsole/Stored Procedures/OrganizationUser_CreateManyWithCollectionsAndGroups.sql` — note: parses input via **JSON** (`OPENJSON`, `$.Type` etc., lines 53/91), NOT a TVP/table type. New columns = edit JSON shredding here.
- `src/Sql/dbo/AdminConsole/Stored Procedures/OrganizationUser_CreateWithCollections.sql`
- `src/Sql/dbo/Stored Procedures/OrganizationUser_ConfirmById.sql`
- `src/Sql/dbo/Stored Procedures/OrganizationUser_CreateMany.sql`, `OrganizationUser_Create.sql`

**Migration pairing (Sql ↔ Migrator), proven by date-matched names:**

- `OrganizationUser_ConfirmById.sql` ↔ `2025-10-15_00_OrgUserConfirmById.sql` + `2025-11-06_00_ConfirmOrgUser_AddKey.sql`
- `OrganizationUser_CreateManyWithCollectionsAndGroups.sql` ↔ `2025-02-17_00_OrgUsers_CreateManyUsersCollectionsGroups.sql`
- Status/column adds: `2026-05-18_00_AddStatusNewToOrganizationUser.sql`, `2026-04-13_00_AddRevocationReasonToOrganizationUser.sql`
  > Note: proc-commit vs migration-commit are sometimes split across commits (git same-commit co-touch count = 0 over 24mo on the isolated proc-path filter), but every proc edit has a date-matched migration by naming convention. **A new/changed proc with no matching `util/Migrator/DbScripts/<date>_xx.sql` = the change will never reach existing deployed DBs.**

---

## 2. Schema triple: entity ↔ EF model ↔ table DDL — ranked #2

Adding/changing a column on org membership requires all three plus a migration:

- `src/Core/AdminConsole/Entities/OrganizationUser.cs` (domain entity, bound by Dapper)
- `src/Infrastructure.EntityFramework/Models/OrganizationUser.cs` (EF model)
- `src/Sql/dbo/Tables/OrganizationUser.sql` (table DDL)
- - `util/Migrator/DbScripts/<date>.sql` (ALTER TABLE)

Table DDL changed 6× since 2024-06. **Why it matters:** Dapper maps proc result columns onto the Core entity by name; EF maps onto its own model class. A column added to one entity class but not the other = null/missing data on the other DB engine.

---

## 3. AdminConsole vertical slice (Core logic) — ranked #3 (git co-change)

Co-change counts WITH the InviteUsers feature dir + `ConfirmOrganizationUserCommand` + `AcceptOrgUserCommand` (since 2024-12, # of shared commits):

| File                                                                                                                                         | co-change |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `ConfirmOrganizationUserCommand.cs`                                                                                                          | 23        |
| `AcceptOrgUserCommand.cs`                                                                                                                    | 14        |
| `InviteUsers/InviteOrganizationUsersCommand.cs`                                                                                              | 11        |
| `InviteUsers/SendOrganizationInvitesCommand.cs`                                                                                              | 9         |
| `InviteUsers/Validation/InviteOrganizationUserValidator.cs`                                                                                  | 8         |
| `InviteUsers/Validation/PasswordManager/InviteUsersPasswordManagerValidator.cs`                                                              | 7         |
| `InviteUsers/Validation/Payments/*` (PaymentsSubscription, InviteUserPaymentValidation)                                                      | 3 each    |
| `InviteUsers/Models/InviteOrganizationUsersRequest.cs`, `InviteOrganizationUsersValidationRequest.cs`, `CreateOrganizationUserExtensions.cs` | 3 each    |
| `InviteUsers/IInviteOrganizationUsersCommand.cs`                                                                                             | 3         |
| `InviteUsers/Validation/{Organization,Provider,GlobalSettings}/*`, `Errors/*`                                                                | 2 each    |

The invite command is a **layered validator pipeline** (PasswordManager + Organization + Payments + Provider + Environment validators, each with its own `Errors.cs`). Changing seat/billing/provider rules ripples across the matching validator + its `Errors` + the `ErrorMapper.cs`. **Why it matters:** invite isn't one function — it's a validation chain; a rule change usually touches validator + its error type + the mapper that surfaces it to the API.

---

## 4. Request / Response DTOs — ranked #4

All request models in ONE file: `src/Api/AdminConsole/Models/Request/Organizations/OrganizationUserRequestModels.cs`

- `OrganizationUserInviteRequestModel` (+ `.ToData()`, controller `:270/287`)
- `OrganizationUserAcceptRequestModel` (`:337`), `OrganizationUserAcceptInitRequestModel` (`:312`)
- `OrganizationUserConfirmRequestModel` (`:369`), `OrganizationUserBulkConfirmRequestModel` (`:378`)

Internal `Invite` flows `model.ToData()` → `OrganizationUserInvite`; public path uses `InviteOrganizationUsersRequest` / `OrganizationUserInviteCommandModel` (Core `InviteUsers/Models/`). **Why it matters:** the two paths have DIFFERENT request-model lineages; a new invite field must be wired in whichever path(s) you target, including the `ToData()`/mapping extension.

**Mirrored layer (`unknown` exact mirror obligation):** the public `MembersController` has its own public-API request/response contract; clients depend on it. Changing shapes here is an external API contract change.

---

## 5. Feature-flag coupling (Constants.cs) — relevant, moderate

`src/Core/Constants.cs` flags governing this flow:

- `:140 PublicMembersInviteRefactor` (`pm-33398...`) — gates the new invite command path (path fork above)
- `:139 BulkAutoConfirmOnLogin` (`pm-35803...`) — gates `GetPendingAutoConfirmUsersAsync` + bulk auto-confirm endpoints (controller `:824/834`, `[RequireFeature]`)
- `:137 AutomaticConfirmUsers` (`pm-19934...`)
- `:136 ScimInviteUserOptimization`, `:141 GenerateInviteLink`

**Why it matters:** `[RequireFeature(...)]` attributes on the controller bind endpoint availability to a flag literal. Removing/renaming a flag in `Constants.cs` breaks the controller attribute at compile time (same string), but the _behavioral fork_ inside the command (flag checked at runtime) is NOT compiler-enforced. Note: git same-commit co-change of `Constants.cs` with the invite dir / controller = **0** since 2024-06 — flags are added in their own commits ahead of the feature, so the coupling is logical, not historically co-committed.

---

## 6. Tests that must move with it

| Test                                                                                                                                                                                            | Layer it guards                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `test/Infrastructure.EFIntegration.Test/AdminConsole/Repositories/OrganizationUserRepositoryTests.cs`                                                                                           | **EF↔Dapper parity** — changed in the exemplar seam commit `4de10c83` |
| `test/Infrastructure.IntegrationTest/AdminConsole/Repositories/OrganizationUserRepository/{OrganizationUserRepositoryTests, OrganizationUserCreateTests, ConfirmManyOrganizationUsersTests}.cs` | repo create/confirm against real DB                                   |
| `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/ConfirmOrganizationUserCommandTests.cs`                                                                                     | confirm command logic                                                 |
| `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/InviteUsers/InviteOrganizationUserCommandTests.cs` + `Validation/InviteOrganizationUsersValidatorTests.cs`                  | invite command + validator chain                                      |
| `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/AutoConfirmUser/*` (4 files)                                                                                                | auto-confirm + validators                                             |
| `test/Core.Test/AdminConsole/Models/InviteOrganizationUsersRequestTests.cs`                                                                                                                     | invite request DTO                                                    |
| `test/Api.Test/AdminConsole/Controllers/OrganizationUsersControllerTests.cs`                                                                                                                    | controller                                                            |
| `test/Api.IntegrationTest/AdminConsole/Controllers/{OrganizationUsersControllerAcceptInitTests, OrganizationUserControllerBulkAutoConfirmTests, OrganizationUserControllerAutoConfirmTests}.cs` | end-to-end accept/auto-confirm                                        |
| `test/Core.Test/AdminConsole/Services/OrganizationServiceTests.cs`                                                                                                                              | legacy `InviteUsersAsync` path                                        |

**Why it matters:** the EFIntegration parity test is the only automated guard that the Dapper proc and the EF method produce the same result. Skip it and the dual-seam divergence ships undetected.

---

## 7. DI registration — `unknown`-adjacent (runtime binding, not compiler-checked at call site)

`src/Core/OrganizationFeatures/OrganizationServiceCollectionExtensions.cs` registers every command in this flow:

- `:156 IConfirmOrganizationUserCommand`, `:230 IAcceptOrgUserCommand`, `:234 IGetPendingAutoConfirmUsersQuery`
- `:241 IInviteOrganizationUsersCommand`, `:242 ISendOrganizationInvitesCommand`, `:243 IResendOrganizationInviteCommand`, `:244 IBulkResendOrganizationInvitesCommand`
- `:161-164` AutomaticallyConfirm + bulk + their validators

**Why it matters:** a NEW command/query injected into the controller compiles but throws at runtime (DI resolution) unless registered here. The interface↔controller link is compiler-checked; the interface↔registration link is **not** — `unknown` until runtime. (The Dapper-vs-EF repository binding itself is selected elsewhere at startup by DB provider config — `unknown` exact location, not traced.)

---

## Ranked summary — "what breaks / must change together"

1. **5-way data seam** (Dapper impl + EF impl + SQL proc + Migrator script + parity test), interface as 6th. Proven atomic in commit `4de10c83`. Compiler catches only the interface; proc + migration are invisible to it.
2. **Schema triple** (Core entity + EF model + table DDL + migration) for any column change.
3. **AdminConsole Core slice** — invite validator pipeline + confirm/accept commands (co-change up to 23).
4. **Request DTOs** in `OrganizationUserRequestModels.cs` + the two divergent invite-model lineages.
5. **Feature flags** in `Constants.cs` (`PublicMembersInviteRefactor`, `BulkAutoConfirmOnLogin`) — runtime fork, logically coupled (0 git co-commits).
6. **Tests** — EFIntegration parity test is the lone automated divergence guard.
7. **DI registration** in `OrganizationServiceCollectionExtensions.cs` — runtime-only binding, not compiler-checked.

**Single riskiest "easy to forget" change point:** the **SQL stored proc + its hand-written Migrator script** (`src/Sql/dbo/.../OrganizationUser_*.sql` + `util/Migrator/DbScripts/<date>_xx.sql`). They are outside the C# project graph, so the build is green even when they're wrong/missing — and a missed migration means the change compiles, passes EF tests, ships, and then silently fails (or runs stale proc) only on SqlServer deployments.
