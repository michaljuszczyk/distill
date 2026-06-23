# Artifact 2 — Structure (Project-Reference Dependency Graph)

**Method (C#-adapted):** dependency-cruiser is JS-only and does not apply. Instead, parsed every `**/*.csproj` `<ProjectReference>` plus `bitwarden-server.slnx`. Deterministic, zero-install. Graph is **project-level** (assembly references), not namespace/type-level.

**What this graph CANNOT see** (treat as `unknown`, not "uncoupled"):

- **Runtime DI wiring** — services bound by string/config in `SharedWeb/.../ServiceCollectionExtensions.cs`, host `Program.cs`/`Startup`. (This is how Dapper-vs-EF is actually chosen — see below.)
- **Reflection / keyed services** (e.g. `AddKeyedSingleton<IGrantRepository>("cosmos")`).
- **The stored-procedure layer (`src/Sql`)** — referenced as a `.sqlproj` (deploy-time), invoked by Dapper via raw SQL strings at runtime. Zero C# project edges, but it is a real, heavily-coupled dependency (git proves it: Artifact 1 §4).

---

## Top 5 observations

| #   | Area                                             | What found                                                                                                                                                                                                                                              | Evidence                                                                            | Why it matters for change                                                                                                        | Link to Artifact 1                                                            | What to check next                                                   |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | **`Core` is the mega-hub**                       | Fan-in = **24**; references nothing itself (leaf-up). Every host, every util, every infra project depends on it.                                                                                                                                        | ProjectReference graph                                                              | Any change to a Core interface ripples everywhere; Core is where you start reading.                                              | Core = #1 by commits (3,776) — hub _and_ hottest. Structure matches activity. | Whether Core is sub-modularized internally (it is, by domain folder) |
| 2   | **`SharedWeb` is the web composition hub**       | Fan-in = 12. References Core **+ BOTH** `Infrastructure.Dapper` **and** `Infrastructure.EntityFramework`. Every web host (Api, Identity, Admin, Billing, Events, EventsProcessor, Icons, Notifications, Scim, Sso) depends on it.                       | ProjectReference graph                                                              | It is the **DI root**; its `ServiceCollectionExtensions.cs` decides which data layer is live. Single most leveraged config file. | That file = #2 hottest file (50 commits)                                      | The 800+-line `ServiceCollectionExtensions.cs` registration order    |
| 3   | **TWO live data-access impls behind one switch** | `SharedWeb` references both Dapper and EF. Runtime selection in `AddDatabaseRepositories`: **SqlServer ⇒ Dapper (+ `Sql/dbo` stored procs); Postgres/MySql/Sqlite ⇒ EF.** Mutually exclusive, chosen from `GlobalSettings.DatabaseProvider` at startup. | csproj refs + `ServiceCollectionExtensions.cs:98-123`                               | **Every repository change must be made twice** (Dapper SP + EF) or one provider silently breaks. The core tech-debt seam.        | Dapper↔EF co-change = 92; EF↔Sql = 90 (Artifact 1 §4)                         | Are there repos implemented in only one of the two? (drift risk)     |
| 4   | **Thin entry points, fat Core**                  | All hosts are thin: they reference `Core` (+`SharedWeb`, +`Commercial.*`) and contain mostly controllers/config. Business logic lives in Core.                                                                                                          | Graph: Api/Identity/Admin/Billing/Events/Icons/Notifications each → Core, SharedWeb | Classic layered monolith. To understand a feature, read Core, not the host.                                                      | Api host churn (1,134) is high but `Core/*` churn is far higher               | Host-specific middleware in each `Program.cs`                        |
| 5   | **Commercial split is structural**               | `bitwarden_license/src/Commercial.Core` (fan-in 4) and `Commercial.Infrastructure.EntityFramework` layer enterprise features on top of Core. `Api`, `Admin`, `Billing` reference them; OSS-only builds would not.                                       | Graph + `.slnx` "src - Bitwarden License" folder                                    | Some logic is dual-licensed and lives outside `src/`. Don't assume `src/` is the whole picture.                                  | `bitwarden_license/src` = 152 commits                                         | Which features are Commercial-only (Scim, Sso are separate hosts)    |

---

## Layering (project graph)

```
Entry hosts (thin):  Api  Identity  Admin  Billing  Events  EventsProcessor  Icons  Notifications  Scim  Sso
                          \        \        |        /        /
                           ----> SharedWeb <----  (+ Commercial.Core for Api/Admin/Billing)
                                    |  \         \
                                    |   \          ----> Infrastructure.Dapper ---->(raw SQL)----> Sql/dbo (stored procs)
                                    |    ----> Infrastructure.EntityFramework
                                    v
                                  Core  (fan-in 24, depends on nothing)
```

- **Hosts** → Core + SharedWeb (+ Commercial.\* where licensed).
- **SharedWeb** → Core + Dapper + EF (binds the data layer).
- **Dapper / EF** → Core only (they implement Core's repository interfaces).
- **`Sql` (.sqlproj)** → no C# edges; reached only through Dapper's raw SQL at runtime (`unknown` to this graph, real per git).
- **util/Migrator** → Core; carries the hand-written T-SQL migration scripts that mirror `Sql/dbo`.

## The Dapper / EF / Sql triad — detail

| Layer             | Project                                  | Role                                                       | Active?                                          |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Stored procedures | `src/Sql` (`.sqlproj`, `Sql/dbo`)        | Canonical T-SQL for the **SqlServer** path                 | **Live** — 438 commits, #2 area in 2026-Q2       |
| Dapper repos      | `src/Infrastructure.Dapper`              | Calls the stored procs; the production SqlServer data path | **Live** — 136 commits                           |
| EF repos          | `src/Infrastructure.EntityFramework`     | The Postgres/MySql/Sqlite path (self-host / non-SqlServer) | **Live** — 324 commits (more active than Dapper) |
| EF migrations     | `util/{MySql,Postgres,Sqlite}Migrations` | Generated EF migrations per provider                       | generated (filtered from Artifact 1)             |
| SQL migrations    | `util/Migrator/DbScripts`                | Hand-written T-SQL migrations mirroring `Sql/dbo`          | live, hand-authored                              |

**Relationship:** the two impls are **parallel, not layered** — neither calls the other. A repository interface defined in `Core` has (ideally) one Dapper impl + one EF impl + one stored proc + matching migrations. The 92-commit Dapper↔EF co-change proves devs keep them in sync by hand; any commit that touches only one is a **drift/bug risk**. EF being _more_ active than Dapper suggests the non-SqlServer path is where newer investment goes, but SqlServer/Dapper remains the cloud-production default.

## Cross-check: structure vs activity (Artifact 1)

- **Match:** Core (hub) = hottest module; SharedWeb DI file = #2 hottest file; AdminConsole/Billing dominate both the graph's busiest sub-trees and git churn. Structure and activity largely agree.
- **Mismatch / hidden:** `src/Sql` is **#3–#4 by churn but invisible in the C# project graph** (no `<ProjectReference>` points at it). A reader trusting only the project graph would miss the single most-coupled-by-git layer. This is the headline gap.
- **Hidden coupling:** `Constants.cs` co-changes with all 12 modules (feature flags) — invisible to a dependency graph, only git reveals it.
