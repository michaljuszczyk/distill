---
title: Invariant & Guardian-Aggregate Refactor Plan — OrganizationUser Membership Lifecycle
created: 2026-06-12
type: refactor-plan
---

# Invariant & Guardian-Aggregate Refactor Plan — Membership Lifecycle

> A **plan**, not an implementation. No production code was changed. Builds on the priors
> (`01-domain-distillation.md`, `org-member-invite/research.md`, `repo-map.md`) — their verdicts are
> taken as given, not re-derived. Every `file:line` below was re-verified against the working tree
> at HEAD (2026-06-12). Where a prior's line number drifted, the verified line is used and noted.
>
> **Source-of-truth limitation (carried from the distillation):** there is **no PRD** — bitwarden/server
> is open-source with no requirements doc. The "model" side of every invariant is the conceptual model
> implied by the domain language and the code's _own XML-doc comments_ (which function as de-facto spec,
> e.g. `OrganizationUserStatusType.cs:5-33`). This is weaker-signal than a true doc-vs-code diff.

---

## STEP 1 — Business invariants of organization membership

Rules that MUST always hold. Each cites docs (docstring) **and** code, with enforcement status.

| #      | Invariant (rule that must always hold)                                                                                                                                                                                                                                           | Doc/model source                                                                                                           | Code site(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I1** | Member status follows the legal path **Invited → Accepted → Confirmed**; **Revoked** is reachable from any active status and returns to the _prior_ status on restore. No other transition is legal (e.g. Invited→Confirmed, Confirmed→Accepted, Confirmed→Invited are illegal). | docstring `OrganizationUserStatusType.cs:11-33` ("the different stages of a member's lifecycle"; Revoked remarks `:28-32`) | Set imperatively at ≥9 sites: `AcceptOrgUserCommand.cs:176`, `ConfirmOrganizationUserCommand.cs:161`, `RevokeOrganizationUserCommand.cs:75`, plus seven "spawn-directly-as-X" sites: `OrganizationService.cs:592` (Invited), `CreateOrganizationUserExtensions.cs:20` (Invited), `ResellerClientOrganizationSignUpCommand.cs:119` (Invited), `SelfHostedOrganizationSignUpCommand.cs:155` (Confirmed), `InitPendingOrganizationCommand.cs:114` (Confirmed), `CloudOrganizationSignUpCommand.cs:286` (Confirmed), `UpgradePremiumToOrganizationCommand.cs:345` (Confirmed) | **DECLARED, partially & locally guarded.** No type/aggregate owns the transition table. Each transition command _re-implements its own_ guard — Accept rejects non-Invited (`AcceptOrgUserCommand.cs:148-151`) & Revoked (`:143-146`); Revoke rejects already-Revoked (`RevokeOrganizationUserCommand.cs:63-66`); Restore rejects non-Revoked (`RestoreOrganizationUserCommand.cs:78-81`). **But Confirm does NOT guard the source state in a fail-fast way** (see I-detail below) and the seven spawn sites bypass the path entirely. |
| **I2** | Field population must match status: **Invited** ⇒ `UserId` null & `Email` set; **Accepted/Confirmed** ⇒ `UserId` set & `Email` null; **Confirmed** ⇒ `Key` (org key encrypted to member's public key) set.                                                                       | docstrings `OrganizationUser.cs:28-44` (UserId `:29-31`, Email `:34-37`, Key `:41-43`)                                     | written on transition: Accept `AcceptOrgUserCommand.cs:176-178` (Status/UserId/Email=null); Confirm `ConfirmOrganizationUserCommand.cs:161-163` (Status/Key/Email=null)                                                                                                                                                                                                                                                                                                                                                                                                   | **DECLARED, never validated on write.** No code asserts the (status, field) consistency at save time. The type system permits a Confirmed row with null `Key` or null `UserId`.                                                                                                                                                                                                                                                                                                                                                        |
| **I3** | A member's status is **authoritative stored data**, not inferred.                                                                                                                                                                                                                | implied — `Status` is a first-class column (`OrganizationUser.cs:51`)                                                      | violated by `OrganizationUser.GetPriorActiveOrganizationUserStatusType():119-139`, esp. **`:126-138`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **VIOLATED for pre-snapshot revoked rows.** Prior status is **reverse-engineered from the null-pattern** of `UserId`/`Email`/`Key`: `UserId set + Email null ⇒ Accepted`; `+ Key set ⇒ Confirmed` (`:127-135`). Correct only if **I2** holds — which nothing enforces. Used in 3 places: `RestoreOrganizationUserCommand.cs:109`, `:247`, `:319`.                                                                                                                                                                                      |
| **I4** | An organization must always retain **≥1 Confirmed Owner** (or a Confirmed provider user).                                                                                                                                                                                        | rule text `HasConfirmedOwnersExceptQuery.cs:23-33` (`:39` filters `Status == Confirmed`; `:30` provider fallback)          | **ENFORCED, but duplicated across ≥5 call sites:** remove `RemoveOrganizationUserCommand.cs:154,209` (carried from prior), invite `OrganizationService.cs:559-564` (carried), revoke v1 `RevokeOrganizationUserCommand.cs:68-72`, revoke v2 `RevokeOrganizationUsersValidator.cs:36-37` (carried).                                                                                                                                                                                                                                                                        | **ENFORCED but DECENTRALIZED.** Correctness depends on every mutating path remembering to call the query. A new path can silently omit it.                                                                                                                                                                                                                                                                                                                                                                                             |
| **I5** | Only an **Owner** may create/modify/remove/**revoke/restore** another Owner; only ≥Admin may revoke/restore an Admin.                                                                                                                                                            | role rule `OrganizationUserType.cs:5`                                                                                      | revoke `RevokeOrganizationUserCommand.cs:27-37`; restore `RestoreOrganizationUserCommand.cs:43-53`; (carried) remove/update `OrganizationService.cs:953-956`                                                                                                                                                                                                                                                                                                                                                                                                              | **ENFORCED but DECENTRALIZED** (same re-implementation pattern as I4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **I6** | A member cannot **Accept** while violating org policy (SingleOrg / RequireTwoFactor / AutomaticUserConfirmation).                                                                                                                                                                | `AcceptOrgUserCommand` policy checks                                                                                       | SingleOrg `:196-211`, 2FA `:213-226`, auto-confirm `:228-259` (throws before `Status=Accepted` at `:176`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **ENFORCED** (fail-fast, throws before write).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **I7** | A member cannot be **Confirmed** if org requires 2FA and user has none (+ SingleOrg / auto-confirm).                                                                                                                                                                             | `ConfirmOrganizationUserCommand.CheckPoliciesAsync:182-225`                                                                | 2FA `:186/227-`, auto-confirm `:188-205`, SingleOrg `:212-224`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **ENFORCED in logic, but failure is SWALLOWED** — see I-detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **I8** | Restoring from Revoked must re-check **seat availability** and **policy compliance**.                                                                                                                                                                                            | restore command                                                                                                            | seat re-check `RestoreOrganizationUserCommand.cs:84-90` (`AutoAddSeatsAsync`); policy re-check `CheckPoliciesBeforeRestoreAsync` (prior-Invited users skip `:319`)                                                                                                                                                                                                                                                                                                                                                                                                        | **ENFORCED.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **I9** | Occupied seats ≤ `Seats`; autoscale ≤ `MaxAutoscaleSeats`.                                                                                                                                                                                                                       | `Organization.cs:89,221`                                                                                                   | invite + autoscale + restore (carried: `OrganizationService.cs` / `InviteOrganizationUsersCommand.cs` / `RestoreOrganizationUserCommand.cs:84-90`)                                                                                                                                                                                                                                                                                                                                                                                                                        | **ENFORCED, but arithmetic duplicated** across legacy service + new validator (distillation M4). _Out of scope for the chosen invariant; noted as I9 for completeness._                                                                                                                                                                                                                                                                                                                                                                |

**I-detail (the load-bearing finding) — Confirm swallows the guard instead of failing fast.**
`ConfirmOrganizationUserCommand.SaveChangesToDatabaseAsync` wraps the per-user policy/2FA checks (I7) and the
status write (I1/I2) in a `try { … } catch (BadRequestException e) { result.Add(Tuple.Create(orgUser, e.Message)); }`
loop (`ConfirmOrganizationUserCommand.cs:146-173`, catch at **`:170-173`**). A policy-violating or otherwise
illegal confirm is **not stopped** — the error is captured into a result tuple, the loop **continues**, and the
HTTP layer returns it as a per-row "soft" failure (`OrganizationUsersController.cs:383-384`). This is the exact
log-and-continue anti-pattern the refactor must eliminate for the _invariant_ checks (note: per-row partial
success in a **bulk** op is a legitimate UX; the fix is to separate "this row is ineligible" outcomes from
"this transition is illegal" invariant violations — the latter must hard-fail).
Source-state guard for Confirm is only a `.Where(...Status == Accepted)` **filter** (`:116-118`) — illegal-source
rows are silently dropped, not rejected.

---

## STEP 2 — Classify each invariant on 3 axes; choose the #1

**Axes:** (a) **CORE** — how central to product meaning; (b) **SPREAD** — across how many layers/files;
(c) **ENFORCEMENT** — Enforced / Declared-only / Violable.

| #                                | (a) Core-ness                                                                                               | (b) Spread                                                                                                                | (c) Enforcement                                                                                 | Composite                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| **I1 lifecycle transitions**     | **Highest** — _is_ the membership domain; its terminal Confirm step carries the Core key-exchange (I2 Key). | **Highest** — ≥9 write sites across 6+ files + 2 hosts; guards re-implemented per command; 7 spawn sites bypass entirely. | **Declared / locally-guarded / violable** — no owner of the transition table; Confirm swallows. | **#1**                              |
| I2 field↔status                  | High — underpins I3 and the key-exchange.                                                                   | Medium — 2 write sites, read everywhere.                                                                                  | **Declared, never validated** — fully violable.                                                 | #2 (fold into I1)                   |
| I3 stored-not-inferred           | High — surprising; the most fragile _line_ in the area.                                                     | Low — 1 helper, 3 call sites.                                                                                             | **Violated** by design for legacy rows.                                                         | #2 (fold into I1)                   |
| I4 ≥1 confirmed Owner            | High — governance/security.                                                                                 | High — ≥5 sites.                                                                                                          | Enforced but decentralized.                                                                     | #3                                  |
| I5 owners-manage-owners          | High — security.                                                                                            | High — re-implemented per command.                                                                                        | Enforced but decentralized.                                                                     | #3                                  |
| I6 / I7 policy-on-accept/confirm | Medium — enterprise differentiator.                                                                         | Medium — re-implemented per command.                                                                                      | I6 enforced; **I7 swallowed**.                                                                  | tie-in to #1 (Confirm)              |
| I8 restore re-checks             | Medium.                                                                                                     | Low.                                                                                                                      | Enforced.                                                                                       | —                                   |
| I9 seat limit                    | High (revenue)                                                                                              | Medium-high (duplicated)                                                                                                  | Enforced, duplicated.                                                                           | separate refactor (distillation #3) |

### Chosen #1 invariant

> **I1 — the OrganizationUser membership lifecycle state machine (Invited → Accepted → Confirmed, with
> Revoked⇄prior), together with its inseparable companions I2 (field↔status consistency) and I3
> (status is stored, not inferred).**

**3-axis rating: (a) Core = Highest · (b) Spread = Highest · (c) Enforcement = Declared-only / violable.**

**Justification (most-core AND weakest-enforced, simultaneously).**

- **Most core:** every member passes through this lifecycle; its terminal Confirm step _is_ the
  zero-knowledge key exchange (`OrganizationUser.Key`, `OrganizationUserStatusType.cs:21-23` "final step…
  including a key exchange"). The distillation ranks it the #1 refactor target; this plan validates that
  against fresh evidence and confirms it.
- **Weakest-enforced:** there is **no aggregate or type** that owns the legal transition table. Status is a
  plain enum field set imperatively at **≥9 sites** (verified: `grep "Status = OrganizationUserStatusType\."`
  → Accept `:176`, Confirm `:161`, Revoke `:75`, + 6 spawn sites in signup/upgrade commands). The guards
  that _do_ exist (Accept `:148-151`, Revoke `:63-66`, Restore `:78-81`) are **per-command re-implementations**
  — and Confirm's is a **filter (`:116-118`) + a swallowing catch (`:170-173`)**, not a fail-fast guard. I2 is
  never validated on write, and I3 _reverse-engineers_ lifecycle state from incidental column nullability
  (`OrganizationUser.cs:126-138`) — the single most fragile line in the area, correct only while the
  never-enforced I2 holds. The team has _recognized_ this (the half-built `StatusNew` v2,
  `OrganizationUser.cs:52-63`) but left two competing status models coexisting, making it worse today.

I4/I5 (decentralized owner/permission rules) are strong runners-up on **spread**, but they are _enforced_
everywhere they appear — the gap is duplication, not absence. I1 is the only invariant that is simultaneously
the most core _and_ genuinely violable. **I1 it is.** (I4/I5 get a natural home inside the same aggregate.)

---

## STEP 3 — Diagnose: where the I1/I2/I3 rule lives today, layer by layer

| Layer                              | Does it enforce the lifecycle invariant?                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client/UI** (out of repo)        | The Confirm flow's source-state correctness is effectively assumed upstream — server only _filters_ non-Accepted rows rather than rejecting them, so an out-of-order client request is silently no-op'd, not refused.                                                                                                               | `ConfirmOrganizationUserCommand.cs:116-118` (`.Where(... Status == Accepted ...)`)                                                                                                                                                                                                                                               |
| **Host / Controller** (`Api`)      | **No enforcement** (correct — thin). Delegates to commands.                                                                                                                                                                                                                                                                         | `OrganizationUsersController.cs:336-365` (Accept), `:367-373` (Confirm), `:375-385` (BulkConfirm)                                                                                                                                                                                                                                |
| **Core — Commands**                | **Inconsistent, per-command.** Accept guards source state & fails fast (`:143-151`). Revoke guards (`:63-66`) + checks I4 (`:68-72`) + I5 (`:27-37`). Restore guards (`:78-81`) + re-checks seats/policy (I8). **Confirm does NOT fail fast** — filters source (`:116-118`), and **swallows** policy/illegal failures (`:170-173`). | as cited                                                                                                                                                                                                                                                                                                                         |
| **Core — spawn sites (bypass)**    | **No transition concept at all** — these create a member _directly_ at a terminal status, never traversing the path.                                                                                                                                                                                                                | `SelfHostedOrganizationSignUpCommand.cs:155`, `InitPendingOrganizationCommand.cs:114`, `CloudOrganizationSignUpCommand.cs:286`, `UpgradePremiumToOrganizationCommand.cs:345` (→ Confirmed); `OrganizationService.cs:592`, `CreateOrganizationUserExtensions.cs:20`, `ResellerClientOrganizationSignUpCommand.cs:119` (→ Invited) |
| **Core — Entity**                  | **Anemic.** `OrganizationUser` exposes a public settable `Status` (`:51`) and a _read_ helper that **infers** prior state (`GetPriorActiveOrganizationUserStatusType:119-139`). It guards **nothing** on write; it has **no** transition methods.                                                                                   | `OrganizationUser.cs:51`, `:119-139`, `:141-155`                                                                                                                                                                                                                                                                                 |
| **Infrastructure** (Dapper/EF/Sql) | Persistence only — accepts whatever Status is set. Revoke/Restore go through dedicated repo methods (`RevokeManyAsync` Dapper `:610`, `RestoreAsync`), bypassing the entity's `Status`. I2/I3 invisible here.                                                                                                                       | dual stack (carried)                                                                                                                                                                                                                                                                                                             |

**Findings:**

1. **No single enforcement point.** The legal transition table exists only as docstring + tribal knowledge; it is
   re-encoded (partially, inconsistently) in 3 commands and ignored by 7 spawn sites and the Confirm filter.
2. **Confirm swallows the invariant check** (`:170-173`) — an illegal/ineligible confirm logs-and-continues
   instead of stopping (violates the fail-fast constraint).
3. **I2 is never validated** — the (status, fields) tuple can be inconsistent and nothing notices.
4. **I3 infers state from column shape** (`:126-138`) — fragile, correct only if I2 holds.
5. **Two competing status models** (`Status` + `StatusNew`) coexist mid-migration (`OrganizationUser.cs:52-63`).

---

## STEP 4 — Design: a guardian aggregate (single enforcement point)

### 4.1 Aggregate root — `OrganizationMembership`

A behavior-rich aggregate root that **owns the transition table** and is the _only_ place `Status`/`UserId`/
`Email`/`Key` change. The anemic `OrganizationUser` entity becomes the persistence/serialization shape behind it
(or the aggregate wraps it). All transition methods have **preconditions**; an illegal call throws a **named
domain error** — never silently mutates, never returns a soft tuple for invariant breaches.

```csharp
// New named domain error — replaces generic BadRequestException for lifecycle breaches.
public sealed class IllegalMembershipTransitionException : DomainException
{
    public IllegalMembershipTransitionException(
        OrganizationUserStatusType from, OrganizationUserStatusType to)
        : base($"Illegal membership transition: {from} → {to}.") { }
}

public sealed class MembershipInvariantViolationException : DomainException // I2/I4/I5 breaches
{
    public MembershipInvariantViolationException(string rule) : base(rule) { }
}

public sealed class OrganizationMembership   // AGGREGATE ROOT
{
    // Encapsulated state — setters are PRIVATE; the only mutators are the transition methods below.
    public Guid Id { get; }
    public Guid OrganizationId { get; }
    public OrganizationUserStatusType Status { get; private set; }
    public Guid? UserId { get; private set; }
    public string? Email { get; private set; }
    public string? Key { get; private set; }
    public OrganizationUserType Type { get; private set; }
    public RevocationReason? RevocationReason { get; private set; }
    private OrganizationUserStatusType? _statusBeforeRevoke;  // replaces StatusNew + the I3 inference

    // ---- The single source of truth for I1: the legal transition table ----
    private static readonly Dictionary<OrganizationUserStatusType, OrganizationUserStatusType[]> Legal = new()
    {
        [Invited]   = [Accepted, Revoked],
        [Accepted]  = [Confirmed, Revoked],
        [Confirmed] = [Revoked],
        [Revoked]   = [/* restore returns to _statusBeforeRevoke; no direct target */],
    };

    private void GuardTransition(OrganizationUserStatusType to)
    {
        if (!Legal[Status].Contains(to))
            throw new IllegalMembershipTransitionException(Status, to);   // FAIL-FAST, never swallowed
    }

    // ---- Domain methods (preconditions → state change → invariant assertion) ----

    public void Accept(Guid userId, IReadOnlyCollection<PolicyCheck> policyResults)
    {
        GuardTransition(Accepted);                 // I1: only Invited→Accepted
        AssertPoliciesPass(policyResults);         // I6 (fail-fast)
        Status = Accepted; UserId = userId; Email = null;
        AssertFieldsMatchStatus();                 // I2
    }

    public void Confirm(string orgKeyEncryptedToMember, IReadOnlyCollection<PolicyCheck> policyResults)
    {
        GuardTransition(Confirmed);                // I1: only Accepted→Confirmed — NO silent filter/swallow
        if (string.IsNullOrWhiteSpace(orgKeyEncryptedToMember))
            throw new MembershipInvariantViolationException("Confirmed member must have a Key.");  // I2 Key
        AssertPoliciesPass(policyResults);         // I7 (fail-fast — replaces the swallowing catch)
        Status = Confirmed; Key = orgKeyEncryptedToMember; Email = null;
        AssertFieldsMatchStatus();
    }

    public void Revoke(RevocationReason reason, bool actorIsOwner, bool wouldLeaveZeroConfirmedOwners)
    {
        if (Status == Revoked) throw new IllegalMembershipTransitionException(Revoked, Revoked); // "Already revoked"
        if (Type == Owner && !actorIsOwner)
            throw new MembershipInvariantViolationException("Only owners can revoke other owners.");  // I5
        if (wouldLeaveZeroConfirmedOwners)
            throw new MembershipInvariantViolationException("Organization must have at least one confirmed owner."); // I4
        _statusBeforeRevoke = Status;              // stored, NOT inferred (kills I3 inference)
        Status = Revoked; RevocationReason = reason;
    }

    public void Restore(bool actorIsOwner, SeatAvailability seats, IReadOnlyCollection<PolicyCheck> policyResults)
    {
        if (Status != Revoked) throw new IllegalMembershipTransitionException(Status, Status); // "Already active"
        if (Type == Owner && !actorIsOwner)
            throw new MembershipInvariantViolationException("Only owners can restore other owners."); // I5
        var target = _statusBeforeRevoke
            ?? throw new MembershipInvariantViolationException("Prior status unknown."); // legacy rows: see migration
        seats.AssertSeatAvailable();               // I8
        if (target != Invited) AssertPoliciesPass(policyResults);  // I8 (prior-Invited skip)
        Status = target; RevocationReason = null; _statusBeforeRevoke = null;
    }

    // Factory for the 7 "spawn-directly" sites: still funnels through the aggregate so I2 holds.
    public static OrganizationMembership SpawnInvited(Guid orgId, string email, OrganizationUserType type) { … }
    public static OrganizationMembership SpawnConfirmed(Guid orgId, Guid userId, string key, OrganizationUserType type) { … } // signup/upgrade

    private void AssertFieldsMatchStatus()   // I2 — the consistency the system never checked
    {
        switch (Status)
        {
            case Invited   when UserId is not null || Email is null:
            case Accepted  when UserId is null     || Email is not null:
            case Confirmed when UserId is null     || Email is not null || string.IsNullOrWhiteSpace(Key):
                throw new MembershipInvariantViolationException($"Field arrangement violates {Status} invariant.");
        }
    }
}
```

**What this design removes:** the public settable `Status` (`OrganizationUser.cs:51`), the
`GetPriorActiveOrganizationUserStatusType` **inference** (`:119-139`) — replaced by the stored
`_statusBeforeRevoke`, finishing the `StatusNew` migration the team already began — and the swallowing
`catch` in Confirm.

### 4.2 Repository — load/save the whole aggregate

```csharp
public interface IOrganizationMembershipRepository
{
    Task<OrganizationMembership?> GetByIdAsync(Guid id);
    Task<IReadOnlyList<OrganizationMembership>> GetManyAsync(IEnumerable<Guid> ids);
    Task SaveAsync(OrganizationMembership membership);          // single
    Task SaveManyAsync(IReadOnlyList<OrganizationMembership> m); // bulk confirm — ONE transaction
}
```

Loads/saves the whole aggregate (status + the four lifecycle fields + `_statusBeforeRevoke` persisted as the
existing `StatusNew` column) instead of scattered field writes. It wraps the existing dual Dapper/EF stack
(carried constraint — keep both impls + proc + migration changing together; the data seam is a proven 5-way
atomic change, see research §1). **Atomicity:** `SaveManyAsync` for BulkConfirm wraps all rows in **one
transaction** — either all eligible members confirm or none do; an `IllegalMembershipTransitionException`
aborts the transaction (vs today's per-row swallow). _(Per-row "ineligible" results — e.g. user lacks 2FA —
remain a returned outcome list, but illegal **transitions** and missing-Key now hard-fail the whole batch.)_

### 4.3 Thin API/route

Unchanged shape (controllers are already thin — `OrganizationUsersController.cs:367-373`):
**parse input → load aggregate → call domain method → `SaveAsync` → map domain error to HTTP.**
A new exception-mapping middleware turns `IllegalMembershipTransitionException` →
`400/409` and `MembershipInvariantViolationException` → `400`, so no controller grows logic. The Confirm
source-state guard moves from the server-side _filter_ (`:116-118`) into the aggregate (`GuardTransition`), and
from "swallow and report" to "throw and stop."

---

## STEP 5 — Before/after per site + phased refactor plan + tests + names

### 5.1 Before → After per current site of the rule

| Site (verified)                                                                                                                                                                                                                                                                                                        | Before                                                                | After                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AcceptOrgUserCommand.cs:143-151,176-178`                                                                                                                                                                                                                                                                              | Inline source-state guards + direct field writes                      | `membership.Accept(userId, policyResults)` — guard + I2 assert inside aggregate                                       |
| `ConfirmOrganizationUserCommand.cs:116-118`                                                                                                                                                                                                                                                                            | `.Where(Status == Accepted)` silent filter                            | `membership.Confirm(...)` throws `IllegalMembershipTransitionException` on bad source                                 |
| `ConfirmOrganizationUserCommand.cs:161-163`                                                                                                                                                                                                                                                                            | Direct `Status/Key/Email` writes                                      | Inside `Confirm()` with I2 Key assertion                                                                              |
| `ConfirmOrganizationUserCommand.cs:170-173`                                                                                                                                                                                                                                                                            | **`catch (BadRequestException) → result tuple` (swallow & continue)** | Invariant breaches **throw and abort the transaction**; only genuine per-row _eligibility_ results remain in the list |
| `RevokeOrganizationUserCommand.cs:27-37,63-77`                                                                                                                                                                                                                                                                         | Inline I5 + already-revoked + I4 + direct write                       | `membership.Revoke(reason, actorIsOwner, wouldLeaveZeroConfirmedOwners)`                                              |
| `RestoreOrganizationUserCommand.cs:78-81,107-111`                                                                                                                                                                                                                                                                      | Inline guard + `GetPriorActive…` **inference**                        | `membership.Restore(...)` using stored `_statusBeforeRevoke`                                                          |
| `OrganizationUser.cs:119-139`                                                                                                                                                                                                                                                                                          | **Inference from null-pattern**                                       | **Deleted** — replaced by stored prior status                                                                         |
| `OrganizationUser.cs:51`                                                                                                                                                                                                                                                                                               | public settable `Status`                                              | private setter; mutated only via aggregate methods                                                                    |
| 7 spawn sites (`SelfHostedOrganizationSignUpCommand.cs:155`, `InitPendingOrganizationCommand.cs:114`, `CloudOrganizationSignUpCommand.cs:286`, `UpgradePremiumToOrganizationCommand.cs:345`, `OrganizationService.cs:592`, `CreateOrganizationUserExtensions.cs:20`, `ResellerClientOrganizationSignUpCommand.cs:119`) | `new OrganizationUser { Status = … }`                                 | `OrganizationMembership.SpawnInvited/SpawnConfirmed(...)` factory — I2 still asserted                                 |
| I4 query `HasConfirmedOwnersExceptQuery.cs`                                                                                                                                                                                                                                                                            | Called at ≥5 sites                                                    | Result passed _into_ `Revoke`/remove as a precondition flag; the rule's _assertion_ lives in one place                |

### 5.2 Phased, reversible refactor plan (characterization-first — the repo has test discipline)

The repo has real test discipline to lean on: `test/Core.Test`, `test/Api.IntegrationTest`,
`test/Infrastructure.EFIntegration.Test` (the lone Dapper↔EF parity guard, `[CiSkippedTheory]`), and the
**5-DB CI matrix** `.github/workflows/test-database.yml`. Each phase is independently shippable and revertible.

- **Phase 0 — Characterization (no behavior change).** Write tests pinning _current_ behavior of all
  transitions incl. the Confirm swallow and the I3 inference, across all 5 DB providers. Lock the baseline.
- **Phase 1 — Introduce the aggregate, no callers yet.** Add `OrganizationMembership`, the two named
  exceptions, and the transition table as pure domain code with exhaustive unit tests. Zero production wiring.
- **Phase 2 — Repository seam.** Add `IOrganizationMembershipRepository` over the existing dual stack (no proc
  changes yet — wraps existing `IOrganizationUserRepository`). Add `SaveManyAsync` transaction. Parity test.
- **Phase 3 — Route Accept through the aggregate** (smallest, already fail-fast). Then **Revoke**, then
  **Restore** (this finishes the `StatusNew`→stored-prior migration and lets I3 inference be deleted once a
  data backfill populates `_statusBeforeRevoke`/`StatusNew` for legacy revoked rows).
- **Phase 4 — Route Confirm through the aggregate** — the behavior-changing step: replace the swallowing
  catch (`:170-173`) with fail-fast for invariant breaches while preserving per-row _eligibility_ results.
  Guard the change behind a feature flag (repo convention — `Constants.cs`) for safe rollout.
- **Phase 5 — Funnel the 7 spawn sites** through `Spawn*` factories so I2 holds universally.
- **Phase 6 — Tighten the entity.** Make `Status`/field setters private; delete
  `GetPriorActiveOrganizationUserStatusType` (`OrganizationUser.cs:119-139`) after the backfill.

### 5.3 Test cases (legal + illegal transitions)

**Legal:** Invited→Accepted; Accepted→Confirmed (with Key); Invited→Revoked→Invited;
Accepted→Revoked→Accepted; Confirmed→Revoked→Confirmed; SpawnInvited; SpawnConfirmed (with Key).
**Illegal (must throw `IllegalMembershipTransitionException`):** Invited→Confirmed; Confirmed→Accepted;
Confirmed→Invited; Accepted→Accepted; Revoked→Confirmed (direct); Restore when not Revoked; Revoke when
already Revoked.
**Invariant breaches (`MembershipInvariantViolationException`):** Confirm with null/empty Key;
Confirm/Accept leaving Email non-null or UserId null; Revoke last Confirmed Owner; non-Owner revokes/restores
Owner; Restore a legacy row with unknown prior status (pre-backfill).
**Fail-fast (regression for the swallow):** BulkConfirm where one row is an illegal transition → **whole batch
aborts**, DB unchanged (assert via integration test on all configured providers); a row that is merely
_ineligible_ (no 2FA) → still returned as a per-row result, not an exception.
**Parity:** every transition test runs on the 5-DB matrix; the EFIntegration parity test stays green.

### 5.4 New load-bearing names

`OrganizationMembership` (aggregate root) · `IOrganizationMembershipRepository` ·
`IllegalMembershipTransitionException` · `MembershipInvariantViolationException` ·
`OrganizationMembership.Accept/Confirm/Revoke/Restore` · `SpawnInvited`/`SpawnConfirmed` ·
`GuardTransition` · `AssertFieldsMatchStatus` · `_statusBeforeRevoke` (replaces the `StatusNew` snapshot +
the I3 inference).

---

## Limitations & honesty notes

- **No PRD** (carried): "model" = docstrings/domain language, not an authoritative spec.
- **Line numbers** verified at HEAD 2026-06-12; some prior citations (I4 remove sites, OrganizationService
  owner/seat sites) are **carried from `research.md`/`01-distillation.md` and re-attributed**, not re-opened
  this pass — flagged inline as "(carried)".
- The **`SaveManyAsync` single-transaction** claim is a _design target_; the current dual stack does bulk
  writes via proc/`UpdateRange` and the transaction boundary across the 5-way seam must be verified per
  provider during Phase 2 — marked as the riskiest implementation detail.
- Whether the 5-DB CI matrix actually runs all providers depends on `BW_TEST_*` env (research: test-runner
  providers `unknown` from source) — Phase 0/parity tests assume the matrix is live.
- This is a **plan only**; no production code was changed.
