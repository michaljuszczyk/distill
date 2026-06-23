# Org Member Invite / Accept / Confirm — Test Gaps & Coverage

Lens: TEST GAPS / COVERAGE. Analysis only, current state. Evidence is real `file:line`.
Inferences flagged `unknown`. I did **not** run the tests; "covered" = a test asserting that path exists, not proof it passes.

## 1. The path under test (production code)

Entry: `src/Api/AdminConsole/Controllers/OrganizationUsersController.cs`

| Action              | line | Delegates to                                                               |
| ------------------- | ---- | -------------------------------------------------------------------------- |
| `Invite`            | :270 | `IOrganizationService.InviteUsersAsync` (**legacy** `OrganizationService`) |
| `BulkReinvite`      | :292 | `IBulkResendOrganizationInvitesCommand.BulkResendInvitesAsync`             |
| `Reinvite` (single) | :305 | `IResendOrganizationInviteCommand.ResendInviteAsync`                       |
| `AcceptInit`        | :312 | `IInitPendingOrganizationCommand.InitPendingOrganizationAsync`             |
| `Accept`            | :337 | `IAcceptOrgUserCommand.AcceptOrgUserByEmailTokenAsync`                     |
| `Confirm` (single)  | :369 | `IConfirmOrganizationUserCommand.ConfirmUserAsync`                         |
| `BulkConfirm`       | :377 | `IConfirmOrganizationUserCommand.ConfirmUsersAsync`                        |

**CRITICAL ROUTING FACT** — the Admin-Console/web `Invite` action calls the **legacy**
`OrganizationService.InviteUsersAsync` (`src/Core/AdminConsole/Services/Implementations/OrganizationService.cs:470`).
The newer `InviteOrganizationUsersCommand` is **NOT** wired to this controller. Its only callers are
SCIM (`bitwarden_license/src/Scim/Users/PostUserCommand.cs`) and the Public API
(`src/Api/AdminConsole/Public/Controllers/MembersController.cs`). All of its tests are named
`InviteScimOrganizationUserAsync_...` — they exercise the SCIM/public surface, **not** the web invite flow.
Do not conflate the two when reasoning about coverage of the controller's `Invite`.

## 2. Where the tests live

UNIT (Core.Test / Api.Test — NSubstitute mocks, no DB):

- `test/Core.Test/AdminConsole/Services/OrganizationServiceTests.cs` — 64 facts/theories; covers the **legacy** invite path actually used by the controller. `Sut.InviteUsersAsync(...)` at :59,:89,:116,... `InviteUser_*` / `InviteUsers_*` cases.
- `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/AcceptOrgUserCommandTests.cs` — 68 facts/theories; deep coverage of Accept.
- `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/ConfirmOrganizationUserCommandTests.cs` — 99 facts/theories; deep coverage of Confirm (single + bulk).
- `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/InviteUsers/ResendOrganizationInviteCommandTests.cs`
- `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/InviteUsers/BulkResendOrganizationInvitesCommandTests.cs`
- `test/Core.Test/AdminConsole/OrganizationFeatures/OrganizationUsers/InviteUsers/InviteOrganizationUserCommandTests.cs` — 14 theories, **SCIM/public path only** (`InviteScimOrganizationUserAsync_*`).
- `test/Api.Test/AdminConsole/Controllers/OrganizationUsersControllerTests.cs` — controller-level: `Invite_Success` (:247), `Invite_NotAuthorizedToGiveAccessToCollections_Throws` (:272), several `Accept_*` (:113–:474), `BulkReinvite_UsesBulkResendOrganizationInvitesCommand` (:907).

INTEGRATION (real DB, repository layer):

- `test/Infrastructure.IntegrationTest/AdminConsole/Repositories/OrganizationUserRepository/OrganizationUserRepositoryTests.cs` — `[Theory, DatabaseData]`. Relevant write-path: `CreateManyAsync_NoId_Works` (:858), `CreateManyAsync_WithId_Works` (:892), `CreateManyAsync_WithCollectionAndGroup_SaveSuccessfully` (:927). `GetCountByOnlyOwnerAsync_*` cases (:20–:192) cover the confirmed-owner invariant at the data layer.
- `test/Infrastructure.EFIntegration.Test/AdminConsole/Repositories/OrganizationUserRepositoryTests.cs` — `[CiSkippedTheory, EfOrganizationUserAutoData]`: `CreateAsync_Works_DataMatches` (:16), `ReplaceAsync_Works_DataMatches` (:54), `DeleteAsync_Works_DataMatches` (:106). EF-only round-trip checks. Note `CiSkipped` → **skipped in CI**.

## 3. Dapper vs EF — are BOTH data-access impls tested? (silent-drift risk)

Mechanism: `test/Infrastructure.IntegrationTest/DatabaseDataAttribute.cs`. For each DB the test
config enables, it builds a provider: `SqlServer && !UseEf` → **Dapper** (`AddDapperServices`, :112);
everything else → **EF** (`AddEfServices`, :138). It iterates `config.GetDatabases()` (:47) and
emits a `Skip("Unconfigured")` row for any of MySql/Postgres/Sqlite/SqlServer not present (:86-93).

**Conclusion:** the shared `OrganizationUserRepositoryTests` is _written_ provider-agnostically, so it
CAN cover both Dapper (SqlServer) and EF (Postgres/MySql/Sqlite) — **but only for the providers
actually configured in the runner's test config**, which I could not inspect (`unknown` — depends on
CI env / user-secrets `BW_TEST_*`). If only SqlServer-Dapper (or only Postgres-EF) is configured, the
other path is silently `Skip`-ped, not failed. So coverage of "both paths" is **conditional and not
guaranteed** by the source alone. This is the core silent-drift risk: the Dapper stored procs
(`src/Sql/dbo/.../OrganizationUser_CreateMany.sql`, `OrganizationUser_CreateManyWithCollectionsAndGroups.sql`)
and the EF `OrganizationUserRepository` are only kept in lockstep if the runner enables both, and the
EF-specific file is `CiSkipped` regardless.

## 4. Untested / thinly-tested branches

CONTROLLER (`OrganizationUsersControllerTests.cs`) — gaps:

- **`Confirm` (single, :369) — NO dedicated controller test.** The only `Confirm` hits are
  `AutomaticallyConfirmOrganizationUserAsync_*` (a different action) and `PutResetPasswordEnrollment_ConfirmedUser_*`.
- **`BulkConfirm` (:377) — NO controller test.**
- **`Reinvite` single (:305) — NO controller test** (only `BulkReinvite` is tested at :907).
- **`AcceptInit` (:312) — NO controller test** (token/`UnauthorizedAccessException` branch at :317 unexercised at controller level).
- `Invite` collection-authorization branch IS covered (`Invite_NotAuthorizedToGiveAccessToCollections_Throws` :272), but the **`model.Collections` empty/null skip-path** vs populated path beyond the authorized/not-authorized split is thin.

SEAT-LIMIT / PERMISSION INVARIANTS:

- Legacy invite seat/autoscale logic IS unit-covered in `OrganizationServiceTests.cs`: `InviteUsers_WithSecretsManager_Passes` (:594) and `InviteUsers_WithSecretsManager_WhenErrorIsThrown_RevertsAutoscaling` (:637, the autoscale-revert/error path). Seat counts mocked via `GetOccupiedSeatCountByOrganizationIdAsync` (:74,:110,...).
- Permission invariants for invite are well covered: `InviteUsers_NoOwner_Throws` (:103), `NonOwnerConfiguringOwner` (:125), `NonAdminConfiguringAdmin` (:144), custom-permission matrix (:165–:324).
- Confirm "last/only confirmed owner" invariant: data-layer only (`GetCountByOnlyOwnerAsync_*`). Whether the Confirm _command_ re-checks this is `unknown` from this pass.

ERROR / EDGE PATHS that are unit-isolated only (no integration coverage of the full invite→accept→confirm sequence):

- The flow is **never exercised end-to-end** in an integration/API test. There is no `Api.IntegrationTest` walking invite → accept-token → confirm against a real DB (`unknown` if one exists elsewhere, but none surfaced under the OrganizationUsers controller search). Each stage is unit-isolated with mocks; the repository writes are integration-tested in isolation. The seam between command logic and the actual SQL/EF persistence for this flow is therefore **not** covered by a single test.
- Accept token edge cases ARE strong at unit level: expired/invalid/email-mismatch/null-orguser (`AcceptOrgUserByToken_*` :323–:540).

## 5. Honesty / limits

- I did not run any test; "covered" means an asserting test exists in source.
- Whether both Dapper and EF actually execute is config-dependent and `unknown` without the runner's `BW_TEST_*` settings.
- The EF-specific repo round-trip tests are `CiSkipped` → likely not run in CI.
