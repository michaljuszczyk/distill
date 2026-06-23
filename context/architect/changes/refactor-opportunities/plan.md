---
change-id: refactor-opportunities
date: 2026-06-12
last_updated: 2026-06-12
status: plan-reviewed
scope: safe-slice
repo: bitwarden/server
head: ba946392836097ef21ed71b3f7d16192fbc45b0a
builds-on:
  - context/changes/refactor-opportunities/research.md # Candidate A (ranked + verified)
  - context/changes/org-member-invite/research.md # flow research
  - context/changes/org-member-invite/_intent.md # intent verdicts
tags:
  - plan
  - safe-slice
  - strangler-fig
---

# Plan — Candidate A (SAFE SLICE): web-path invite vNext entry point, inert behind a flag

> **What this is:** a reversible, **three-phase** plan (Phase 0 spike → Phase 1 characterization → Phase 2 inert entry point) to advance the in-flight invite-command Strangler Fig **one safe step** for the web/AdminConsole surface. It does **not** flip any flag and does **not** delete the legacy path. Those are maintainer-owned, out of scope (see "What we are explicitly NOT doing").
>
> **Grounding:** every step cites real `file:line` from the priors, re-confirmed at HEAD `ba9463928`. Uncertain items are tagged `unknown`.
>
> **Evidence tags:** **evidence** = statically confirmed at `file:line` · **inference** = reasoned from evidence · **unknown** = not statically resolvable.

---

## Biggest risk

**Reusing the Imported wrapper's event semantics would silently relabel every web/AdminConsole invite audit event as `EventSystemUser.PublicApi`** — and the parity test **cannot catch it**, because events are config-disabled in the test host (`WebApplicationFactoryBase.cs:139-142`). `InviteImportedOrganizationUsersAsync` hard-codes `EventSystemUser.PublicApi` (`InviteOrganizationUsersCommand.cs:65/99`); routing the web `Invite` action through it would mis-attribute the actor on every web/AdminConsole invite, an audit-log corruption invisible to a green test suite. **This is why Phase 2 must build a NEW web-specific command wrapper with the correct `EventSystemUser`, not reuse the Imported wrapper.** **[evidence + inference]**

---

## Plan review (folded in)

**Verdict: SOUND-WITH-FIXES.** An adversarial plan-review confirmed the slice is reversible and correctly graded, but flagged four MUST-FIX items, now incorporated:

1. **Phase 0 precondition spike (new, gates the whole plan):** prove the integration-test host can mint/obtain a valid `OrgUserInviteTokenable` and POST `/accept` **without** modifying production code. If infeasible, Phase 1's "walk the real token path" premise collapses → replan. The former `unknown` "token-capture hook" item is now this blocking phase.
2. **Phase 2 re-scoped from "copy the MembersController wrapper" to "build a web entry point":** the web model is BULK (`Emails`, IEnumerable) vs the public model's SINGLE `Email`; the web controller must NEW-load the `Organization` and resolve `performedBy`/`performedAt`; and it must use a **NEW web-specific command wrapper** with the correct `EventSystemUser` (NOT the `PublicApi`-logging Imported wrapper). Phase 2 is genuine new production logic, still flag-gated/OFF.
3. **Error-path parity added to the Phase 1 contract:** assert the LEGACY already-invited and seat-limit error responses (HTTP status + message), since the legacy path throws its own `BadRequestException` texts that differ from the command wrappers' mapped exceptions (`MembersController.cs:203-209`). Previously only happy-path end state was pinned.
4. **Feature-flag decision settled:** recommend a **SEPARATE web flag** rather than reusing `PublicMembersInviteRefactor` (`Constants.cs:140`); one shared flag couples web rollout to the public-API flip. Decision to be confirmed before Phase 2 (see "Phase 2 / flag decision").

All four graded properties survive the revision (see "The four graded properties").

---

## Anchors (re-confirmed this pass)

| Thing                                                                 | Location                                                                                                                                                                                  | Note                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web invite action (legacy, unflagged)                                 | `src/Api/AdminConsole/Controllers/OrganizationUsersController.cs:268-288` (call `:286`)                                                                                                   | `Invite(orgId, OrganizationUserInviteRequestModel)` → `_organizationService.InviteUsersAsync(...)` **[evidence]**                                                                                                                                               |
| Shared command core (private)                                         | `src/Core/.../InviteUsers/InviteOrganizationUsersCommand.cs:114` `InviteOrganizationUsersAsync`                                                                                           | both publics wrap it **[evidence]**                                                                                                                                                                                                                             |
| Wrapper _shape_ reference (structure only — do NOT copy its behavior) | `InviteOrganizationUsersCommand.cs:80` `InviteImportedOrganizationUsersAsync`                                                                                                             | ~30-line public wrapper over the core; useful as a structural template, but its `EventSystemUser.PublicApi` actor is WRONG for web (see "## Biggest risk") — Phase 2 builds a new web wrapper **[evidence]**                                                    |
| Controller-switch pattern to mirror                                   | `src/Api/AdminConsole/Public/Controllers/MembersController.cs:173-210` (flag `:174`, vNext return `:176`, vNext def `:187`, command call `:194`)                                          | classic Strangler Fig switch **[evidence]**                                                                                                                                                                                                                     |
| Existing public-API flag (do NOT silently reuse for web)              | `src/Core/Constants.cs:140` `PublicMembersInviteRefactor = "pm-33398-refactor-members-invite-org-users-command"`                                                                          | gates the **public-API** vNext; reusing it for web couples the two rollouts — Phase 2 recommends a **separate** web flag **[evidence]**                                                                                                                         |
| Command DI registration                                               | `src/Core/OrganizationFeatures/OrganizationServiceCollectionExtensions.cs:241` `AddScoped<IInviteOrganizationUsersCommand, …>`                                                            | already registered; injectable into the web controller. NB: registration lives here, but the command **implementation** lives under `src/Core/AdminConsole/OrganizationFeatures/OrganizationUsers/InviteUsers/InviteOrganizationUsersCommand.cs` **[evidence]** |
| Imported wrapper's event actor (the trap)                             | `InviteOrganizationUsersCommand.cs:65/99` `EventSystemUser.PublicApi`                                                                                                                     | `InviteImportedOrganizationUsersAsync` hard-codes `PublicApi`; reusing it would mislabel web invites — see "## Biggest risk" **[evidence]**                                                                                                                     |
| Org load needed by web vNext                                          | `src/Core/.../IOrganizationRepository.GetByIdAsync(orgId)`                                                                                                                                | the new web wrapper must NEW-load the `Organization`; legacy web call (`OrganizationUsersController.cs:286`) passes only orgId+userId, so the org object is not in hand **[evidence + inference]**                                                              |
| Web request model (needs an adapter)                                  | `src/Api/AdminConsole/Models/Request/Organizations/OrganizationUserRequestModels.cs:14` (`ToData()` `:27`)                                                                                | has `ToData()`; **no `ToInviteRequest` adapter exists** (public model `MemberCreateRequestModel.ToInviteRequest` `:50-76` is the pattern to copy) **[evidence]**                                                                                                |
| Api integration test project                                          | `test/Api.IntegrationTest/Api.IntegrationTest.csproj`                                                                                                                                     | hosts controller e2e tests **[evidence]**                                                                                                                                                                                                                       |
| OrganizationUsers test home                                           | `test/Api.IntegrationTest/AdminConsole/Controllers/OrganizationUserControllerTests.cs` (+ `…AcceptInitTests.cs`)                                                                          | where the new characterization test lands **[evidence]**                                                                                                                                                                                                        |
| Test fixture                                                          | `test/Api.IntegrationTest/Factories/ApiApplicationFactory.cs` → `IntegrationTestCommon/Factories/WebApplicationFactoryBase.cs`                                                            | `IClassFixture<ApiApplicationFactory>`; in-memory DB **[evidence]**                                                                                                                                                                                             |
| Flag control in tests                                                 | `WebApplicationFactoryBase.cs:112` `UpdateConfiguration("globalSettings:launchDarkly:flagValues:<key>", "true"/"false")`; default config (`:128-159`) leaves `pm-33398-…` **unset → OFF** | real `IFeatureService`, LaunchDarkly flagValues; default = legacy path **[evidence]**                                                                                                                                                                           |
| Test helper that skips the token path                                 | `test/Api.IntegrationTest/Helpers/OrganizationTestHelpers.cs:58` `CreateUserAsync(... userStatusType = Confirmed)`                                                                        | seeds status directly — why the token path is uncovered today **[evidence]**                                                                                                                                                                                    |
| CI: integration-test runner                                           | `.github/workflows/test.yml:53` "Test OSS solution" runs `dotnet test ./test` (the WHOLE `./test` tree, SQLite in-memory) — **not** the scoped `./test/Api.IntegrationTest`               | runs Phase 1 + Phase 2 build/tests **[evidence]**                                                                                                                                                                                                               |
| CI: 5-DB Dapper↔EF parity guard                                       | `.github/workflows/test-database.yml` (DBs `:125-138`; path triggers `:12-20`/`:24-32`; workdir `test/Infrastructure.IntegrationTest` `:122`)                                             | only triggers on `src/Sql`/Migrations/`Infrastructure.*`/`Entities`; **NOT expected to trigger** for this control-flow-only slice **[evidence + inference]**                                                                                                    |

**Key scoping fact (from research Lens c):** this slice is a **Core/Api control-flow change that reuses existing repository writes** — it does not change any write signature, proc, EF model, or migration, so it should **not** trigger the 5-way data-write tax nor the `test-database.yml` path filters. **[inference, grounded in research verified #3]** If Phase 2 turns out to require a new write path, that is a stop-and-replan signal.

---

## The four graded properties — where each is satisfied

1. **CHARACTERIZATION BEFORE TOUCH** → Phase 1 is a hard gate; Phase 2 may not start until Phase 1 is merged and green. Phase 0 (a no-prod-code spike) _precedes_ the characterization so the test's token-path premise is proven feasible before it is written. See "Phase 0" + "Phase 1" + "Gate G1".
2. **PHASES SEPARATELY REVERSIBLE, CHEAPEST-FIRST** → Phase 0 (throwaway spike, no merge) → Phase 1 (test-only, cheapest mergeable, zero production risk) → Phase 2 (production wrapper, inert). Each is its own PR (Phase 0 may be a scratch branch) with an explicit revert. See "Reversibility" under each phase.
3. **EACH PHASE HAS AUTO + MANUAL VERIFICATION** → every phase lists a concrete `dotnet test` target + the CI workflow that runs it, plus manual steps; Phase 0's "verification" is the binary go/replan finding. See "Verification" under each phase.
4. **MECHANISMS LAND GREEN, ENFORCEMENT ENABLED SEPARATELY** → Phase 2 ships with its flag **OFF by default**, so behavior is byte-identical to today; the new web wrapper exists but is dormant. Turning it on is explicitly a later, separate step **outside this plan**. Re-scoping Phase 2 to genuine new production logic does **not** weaken this: the logic is unreachable in default config until a maintainer flips the (recommended-separate) web flag. See "Phase 2" + "What we are explicitly NOT doing".

---

## Phase 0 — Precondition spike: prove the token path is reachable from the test host _(throwaway; no production code; GATES the whole plan)_

**Why this gates everything:** Phase 1's entire premise is "walk the **real** token path." If the Api.IntegrationTest host cannot mint or obtain a valid `OrgUserInviteTokenable` and POST `/accept` **without modifying production code**, then Phase 1 cannot be written as designed and the plan must be re-thought (e.g. a different seam, or accepting a narrower characterization). This was formerly an `unknown` ("token-capture hook"); it is now a blocking, do-it-first spike.

**Goal (binary):** in a scratch test (not for merge), obtain a valid invite token for a seeded `OrganizationUser` and successfully POST `users/{id}/accept`, using **only test DI / test seams** — no `src/` edits.

**Most likely mechanism (to confirm):** resolve `IDataProtectorTokenFactory<OrgUserInviteTokenable>` from the test host's DI and **mint** the tokenable from the seeded `OrganizationUser` id + email — the same factory `accept` consumes (`AcceptOrgUserCommand.cs:69-75`). Fallback: capture the token from a test/Noop mail seam if one is observable. **[inference]**

**Outcome → decision:**

- **GO:** a token can be obtained with zero production changes → proceed to Phase 1, wiring the proven mechanism into the characterization test.
- **REPLAN (stop):** no production-code-free path exists → the "real token path" characterization is infeasible; return to planning before writing any Phase 1 test.

### Verification — Phase 0

- **Automated:** the scratch test's `/accept` call returns success and the seeded member reaches `Status=Accepted` — run via `dotnet test` on the scratch branch.
- **Manual:** confirm the spike diff contains **no `src/` file** (test-project + test-DI only). If a production change was needed to get the token, that is the REPLAN signal, not a fix to apply.

### Reversibility — Phase 0

Throwaway scratch branch; nothing merges. Discard the branch regardless of outcome — only the GO/REPLAN finding carries forward. **[evidence — no merge, no production file]**

---

## Phase 1 — Characterization test for the web invite flow _(test-only; cheapest mergeable; lands first)_

**Goal:** pin the _current_ observable behavior of the web/AdminConsole invite path **before any production code is touched**, by adding an e2e **invite → accept → confirm** sequence test that walks the real token path (which no test does today — research verified #16; the existing `AcceptInit` test covers only the one-step pending-org flow), **plus** the legacy error responses (below). This is finding F, reclassified as A's prerequisite. **Prereq:** Phase 0 returned GO (token path reachable without production changes).

**Where:** `test/Api.IntegrationTest/AdminConsole/Controllers/OrganizationUserControllerTests.cs` (new test method(s)), using `IClassFixture<ApiApplicationFactory>` exactly like the existing tests in that file. **[evidence]**

**What it asserts (current legacy behavior — flag left at default OFF):**

- POST `users/invite` (`OrganizationUsersController.cs:268`) creates a member at `Status=Invited` (no direct seeding — do **not** use `CreateUserAsync(...userStatusType:)` which short-circuits the token path, `OrganizationTestHelpers.cs:58`). **[evidence]**
- The invitee accepts via the emailed **token** (`POST users/{id}/accept`) → `Status=Accepted`, `UserId` bound, `Email=null` (research flow table; `AcceptOrgUserCommand.cs:176-178`). **[evidence]**
- An admin confirms (`POST users/{id}/confirm`) → `Status=Confirmed`, `Key` set, `Email=null` (`ConfirmOrganizationUserCommand.cs:161-163`). **[evidence]**
- Assert the observable end state (member rows / statuses). Capturing email/event/push/billing side-effects is desirable but those seams are config-disabled in the test host (`WebApplicationFactoryBase.cs:139-143`); assert what the in-memory host can observe and mark deeper side-effect parity as `unknown` for this slice. **[inference]**

**Error-path parity (MUST pin, not just happy path):** assert the LEGACY path's failure responses so a later vNext cutover can be diffed against them:

- **Already-invited** email → the legacy response's HTTP status + message text.
- **Seat-limit exceeded** → the legacy response's HTTP status + message text.

These are load-bearing because the **legacy path throws its own `BadRequestException` texts that differ from the command wrappers' mapped exceptions** (`MembersController.cs:203-209`) — so a vNext cutover that "passes the happy-path test" could still silently change error contracts. Pin the legacy texts now; the Phase-2 flag-ON test (below) must reproduce them. **[evidence + inference]**

**Token path:** use the mechanism proven GO in **Phase 0** (resolve `IDataProtectorTokenFactory<OrgUserInviteTokenable>` from test DI and mint, as accept consumes it — `AcceptOrgUserCommand.cs:69-75`). No `unknown` remains here: if Phase 0 had not returned GO, this phase would not start.

**Flag state for Phase 1:** leave `PublicMembersInviteRefactor` at its **default (unset → OFF)** — Phase 1 characterizes the **legacy** path, the one production still uses. Do not call `UpdateConfiguration` for this flag in Phase 1. **[evidence — `WebApplicationFactoryBase.cs:128-159` sets no value for `pm-33398-…`]**

### Verification — Phase 1

- **Automated:** locally scope with `dotnet test ./test/Api.IntegrationTest` (the new test must pass). In CI it runs under `.github/workflows/test.yml:53` "Test OSS solution", which runs the whole `dotnet test ./test` (not the scoped project), SQLite in-memory. **[evidence]**
- **Automated (regression):** full OSS suite stays green — `dotnet test ./test` locally / `test.yml` in CI. Test-only change touches no `src/Sql`/`Infrastructure.*`/`Entities` path, so `test-database.yml` is **not** expected to trigger; if it does, no production code changed, so a green run is the only expectation. **[inference]**
- **Manual:**
  1. Run the new test in isolation and confirm it is **actually exercising the legacy path** (e.g. breakpoint/log at `OrganizationUsersController.cs:286` / `OrganizationService.InviteUsersAsync`), not a seeded shortcut.
  2. Temporarily break an assertion (flip an expected status) and confirm the test **fails** — proves it is load-bearing, not a tautology.
  3. Confirm no production file is in the diff (Phase 1 is test-only).

### Reversibility — Phase 1

Single test-only PR. Revert = `git revert` the commit; deletes the test, zero production impact (nothing else depends on it). **[evidence — no production file touched]**

---

## Gate G1 (hard stop between phases)

> **Phase 2 may not begin until Phase 1 is merged to `main` and green in CI (`test.yml`).** The characterization test (happy path **and** the pinned legacy error contracts) is the safety net that makes Phase 2's **new web wrapper** reversible-and-safe (research Lens c "First prerequisite step"). No production invite code is written before this gate clears. Note: Phase 2 is **not** a mechanical wrapper-copy — see "## Biggest risk" and the re-scope below.

---

## Phase 2 — Web-path vNext **entry point**: new web-specific command wrapper, flag-gated, shipped INERT _(production; second; reversible)_

**Goal:** introduce a flag-gated `_vNext` branch on `OrganizationUsersController.Invite` that routes the web/AdminConsole invite through the shared command core via a **NEW web-specific public command wrapper** — shipped with the flag **OFF**, so runtime behavior is identical to today. This is **genuine new production logic, not inert sugar** (and emphatically not a 1:1 copy of the public-API wrapper): the web surface differs from the public API in shape, inputs, and event semantics (below). The mechanism lands green and dormant; enabling it is a separate later step (Property 4).

> **Why "entry point," not "copy the `MembersController` wrapper":** three concrete divergences make a copy wrong (and one of them is silent — see "## Biggest risk").

**Re-scoped work (all additive; legacy path untouched):**

1. **Flag decision — recommend a SEPARATE web flag (settle BEFORE Phase 2).** Do **not** silently reuse `FeatureFlagKeys.PublicMembersInviteRefactor` (`Constants.cs:140`): it is the public-API flag, and one shared flag **couples web rollout to the public-API flip** — flipping it lights up **both** surfaces at once, removing independent rollback. **Recommendation:** add a distinct web flag (a one-line `Constants.cs` addition) so web and public-API vNext can be enabled/reverted independently. _If maintainers intend lockstep rollout,_ document that consequence explicitly and reuse the shared flag with eyes open. This is a **decision to settle at the start of Phase 2**, not an implementation `unknown`. **[evidence + inference]**

2. **Fan-out adapter — BULK→N, not 1:1.** The web request model is **bulk**: `OrganizationUserInviteRequestModel.Emails` is an `IEnumerable<string>` (`OrganizationUserRequestModels.cs:14`, `ToData()` `:27`), whereas the public model carries a **single** `MemberCreateRequestModel.Email`. So the adapter must **fan N emails into N invite models** — it is **NOT** a copy of `MemberCreateRequestModel.ToInviteRequest` (`:50-76`), which maps one email. Build a web `ToInviteRequest(...)` that expands `Emails` into the per-email invite set the command core expects. This is the heaviest part (research: web increment lacks any scaffold). **[evidence + inference]**

3. **Controller must NEW-load the `Organization` and resolve actor/time.** The legacy web call (`OrganizationUsersController.cs:286`) passes only `orgId` + `userId`; the command core wants the `Organization` object plus `performedBy`/`performedAt`. The `_vNext` branch must `IOrganizationRepository.GetByIdAsync(orgId)` and resolve `performedBy`/`performedAt` from the request context — this is new logic the legacy path never had. **[evidence + inference]**

4. **NEW web-specific command wrapper with the correct `EventSystemUser` — do NOT reuse `InviteImportedOrganizationUsersAsync`.** That wrapper hard-codes `EventSystemUser.PublicApi` (`InviteOrganizationUsersCommand.cs:65/99`); reusing it would relabel every web/AdminConsole invite audit event as `PublicApi` — **silently** (see "## Biggest risk"). Add a new public wrapper over the core `InviteOrganizationUsersAsync` (`:114`) that logs the correct web/AdminConsole actor. The command is already DI-registered (`OrganizationServiceCollectionExtensions.cs:241`; implementation under `Core/AdminConsole/OrganizationFeatures/OrganizationUsers/InviteUsers/`). **[evidence]**

5. **Wire the controller switch.** Inject `IInviteOrganizationUsersCommand` into `OrganizationUsersController`; in `Invite` (`:268`): `if (_featureService.IsEnabled(<web flag>)) return InviteUsersAsync_vNext(...);` else fall through to the **unchanged** legacy `:286` call. `InviteUsersAsync_vNext` calls the new web wrapper and maps `Success`/`Failure` and errors as `MembersController` does (`:196-209`), **reproducing the legacy error texts pinned in Phase 1** (the `void`/204-returning `Invite` action is simpler than the public model's JSON body, but the error contract must match — `MembersController.cs:203-209`). **[evidence + inference]**

**Inert-by-default guarantee:** the test host leaves the gating flag unset → OFF (`WebApplicationFactoryBase.cs:128-159`), and default LaunchDarkly state in every environment is OFF unless a maintainer flips it. So at merge, the web path runs **exactly the legacy code** it runs today; the `_vNext` branch (and its new wrapper) is unreachable in default config. New production logic, but dormant. **[evidence + inference]**

### Verification — Phase 2

- **Automated (parity, flag OFF — the load-bearing check):** the Phase-1 characterization test (happy path + error contracts) must **still pass unchanged** with the flag at default OFF — proves the legacy path is byte-identical (mechanism is inert). `dotnet test ./test/Api.IntegrationTest`. **[evidence]**
- **Automated (mechanism wakes up, flag ON):** add a sibling test that calls `factory.UpdateConfiguration("globalSettings:launchDarkly:flagValues:<web-flag-key>", "true")` **before** acting, then runs the same invite→accept→confirm assertions **and the already-invited / seat-limit error assertions** via the `_vNext` path, expecting the **same** observable end state and the **same pinned legacy error texts**. This proves parity of the new path **without** enabling it anywhere real. **[evidence + inference]**
  - **Caveat (cannot be tested here — see "## Biggest risk"):** event-actor parity (`EventSystemUser`) is **NOT** checked by this test, because events are config-disabled in the test host (`WebApplicationFactoryBase.cs:139-142`). The "use a new web wrapper, not the Imported one" requirement is therefore enforced by **review** (confirm wrapper #4 does not call `InviteImportedOrganizationUsersAsync`), not by a green test. **[evidence]**
- **Automated (regression):** full OSS suite green — `dotnet test ./test` / `test.yml`. Control-flow-only change: `test-database.yml` path filters (`:12-32`) do **not** match `src/Api`/`src/Core/...InviteUsers`, so the 5-DB parity job is **not** expected to trigger. **[evidence + inference]**
- **Manual:**
  1. With flag **OFF** (default), exercise web invite locally and confirm it hits legacy `:286` (breakpoint/log) — mechanism dormant.
  2. With flag **ON** locally only, exercise a **multi-email** web invite and confirm it hits `_vNext` → fan-out adapter → new web wrapper → `InviteOrganizationUsersAsync` core (`:114`), producing one `Invited` member **per email**.
  3. **Event-actor review (the silent risk):** read the new wrapper and confirm it logs the correct web/AdminConsole `EventSystemUser`, **not** `EventSystemUser.PublicApi` — and that `_vNext` does **not** call `InviteImportedOrganizationUsersAsync`. The test suite cannot catch this (events disabled in test host), so it must be caught here. **[evidence — `InviteOrganizationUsersCommand.cs:65/99`]**
  4. Diff review: confirm legacy `:286` call and its request model are **untouched**; every changed line traces to the additive switch / fan-out adapter / new wrapper / org-load / injection / (web) flag.
  5. Confirm no **default-on** flag flip is in the diff. (A new web-flag _definition_ in `Constants.cs` is expected per the flag decision; what is forbidden is shipping it default-ON.)

### Reversibility — Phase 2

Single production PR, additive only. Two-layer reversibility:

- **Instant (no deploy):** flag is OFF by default; nothing to "turn off."
- **Full revert:** `git revert` the PR removes the `_vNext` method, the fan-out adapter, the new web wrapper, the org-load, the controller injection, and the (web) flag definition; legacy path is already the live path, so revert is behavior-neutral. **[evidence — legacy `:286` never modified]**

---

## Reversibility & ordering summary (Property 2)

| Phase                           | Cost / risk                                   | Independent revert                                                   | Why this order                                                                                       |
| ------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **0 — precondition spike**      | Throwaway; no prod, no merge                  | Discard scratch branch                                               | Proves Phase 1's token-path premise before it is written; GATES the plan                             |
| **1 — characterization test**   | Cheapest mergeable; test-only; zero prod risk | `git revert` (deletes test only)                                     | Must exist first — it is the net Phase 2 falls into (Gate G1); pins happy path **+ error contracts** |
| **2 — inert vNext entry point** | Higher; **new** additive prod logic; dormant  | `git revert` (removes additive code + web flag; legacy already live) | Needs the Phase-1 net before any prod invite code is written                                         |

Spike-then-cheapest/safest-first, each its own PR (Phase 0 a scratch branch), each independently revertible.

---

## What we are explicitly NOT doing (out of scope — maintainer-owned)

- **NOT flipping any invite-refactor flag to default-on** (the recommended new web flag, or `PublicMembersInviteRefactor`) for the web surface or any surface. The new wrapper ships OFF; enabling is a separate later step (Property 4). **[brief HARD STOP]**
- **NOT deleting the legacy path** — `OrganizationService.InviteUserAsync`/`InviteUsersAsync`/`SaveUsersSendInvitesAsync` (`OrganizationService.cs:432/470/508`) stay; web/import/provider still call legacy unflagged (research caller map). **[brief HARD STOP]**
- **NOT retiring either flag** (`PublicMembersInviteRefactor`, `ScimInviteUserOptimization`) — flag-lifecycle cleanup is the in-flight migration owner's call (intent item 3). **[brief HARD STOP]**
- **NOT building the import or provider-setup vNext branches** — out of this slice (only web). **[scope]**
- **NOT touching any data-write path** — no proc, EF model, migration, or `IOrganizationUserRepository` signature changes (avoids the 5-way tax). If Phase 2 appears to need one, **stop and replan**. **[inference — research verified #3]**
- **NOT splitting/restructuring** `OrganizationUserRequestModels.cs`, `OrganizationService`, or the DI root — rejected candidates I–L (research "Considered and rejected").

## Unknowns to resolve during implementation (not blocking the plan)

- _(Resolved by elevation — no longer `unknown`:)_ the token-capture hook is now blocking **Phase 0**; the flag choice is now the **Phase 2 flag decision** (recommend separate web flag).
- Exact `_vNext` error mapping for the `void`-returning web `Invite` action — must reproduce the **legacy** texts pinned in Phase 1 (vs the public model's JSON body). **[unknown — bounded by the Phase 1 contract]**
- Deeper side-effect parity (email/push/billing) under the in-memory test host, where those seams are disabled. **Event-actor parity specifically is enforced by review, not test** (see "## Biggest risk"). **[unknown]**
