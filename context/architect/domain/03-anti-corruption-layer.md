---
title: Anti-Corruption Layer Refactor Plan — Containing the Stripe SDK Leak (Billing)
created: 2026-06-12
type: refactor-plan
---

# Anti-Corruption Layer Refactor Plan — Containing the Stripe.net SDK Leak

> A **plan**, not an implementation. **No production code was changed.** Builds on the priors
> (`01-domain-distillation.md`, `02-invariant-aggregate-refactor.md`, `repo-map.md`) — their verdicts are
> taken as given, not re-derived. Every `file:line` cited below was verified against the working tree at
> HEAD (2026-06-12) via `grep`/file reads. Counts come from the baseline `rg`/`grep` runs reproduced in
> STEP 6.
>
> **Source-of-truth limitation (carried):** bitwarden/server is open-source with **no PRD**. The "should be
> swappable" intent in STEP 2/3 is read from the code's _own_ abstractions (the `GatewayType` enum, the
> `IStripeAdapter`/`ISubscriberService` interfaces, the `IBraintreeService` parallel) — not from a
> requirements doc. This is weaker-signal than a true doc-vs-code diff and is flagged inline.

---

## STEP 0 — Stack, external dependencies, layers

**Stack.** C#/.NET 10 (`global.json` → SDK `10.0.103`) monolith. Ten thin web hosts over one large
business library `Core`; dual Dapper+T-SQL / EF data stack selected at runtime (carried from `repo-map.md`).
**No central package management** — there is **no `Directory.Packages.props`**; every `*.csproj` declares its
own `<PackageReference>` versions (verified: `find … Directory.Packages.props` → none).

**External dependencies of interest (parsed from `*.csproj PackageReference`).** All payment/billing/flag/mail
SDKs are declared in exactly **one** project — `src/Core/Core.csproj` — and reach hosts transitively through
`Core` (`grep -rl … --include=*.csproj`):

| Package           | Declared in                   | Role                                                                                   |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| **Stripe.net**    | `src/Core/Core.csproj` (only) | Primary payment gateway: customers, subscriptions, invoices, payment methods, webhooks |
| **Braintree**     | (transitive; used in `Core`)  | Secondary payment gateway (PayPal / legacy) — a _second_ SDK leaking the same seam     |
| LaunchDarkly      | `src/Core/Core.csproj`        | Feature flags                                                                          |
| MailKit / MimeKit | `src/Core/Core.csproj`        | SMTP mail delivery                                                                     |

**Layers (per `repo-map.md`).** Hosts (`Api`, `Billing`, `Admin`, `Identity`, …) → `SharedWeb` (DI root) →
`Core` (domain/business) → `Infrastructure.Dapper` / `Infrastructure.EntityFramework` (persistence) →
`Sql/dbo` (stored procs). Commercial code in `bitwarden_license/`.

---

## STEP 1 — Candidate leaking dependencies (discovery, not assumption)

A _package reference_ in one project is not itself a leak — `Core.csproj` legitimately owns the dependency.
The leak is measured by **how many files across how many layers know the library's _types_**. Baseline file
counts (distinct `.cs` files matching `using <Lib>` / `<Lib>.<Type>`):

| Candidate                                                 | Files (src)                             | Layers touched                                                 | Verdict                                                                                                                                                                               |
| --------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stripe.net**                                            | **101** (114 incl. `bitwarden_license`) | **Core 63 · Billing-host 28 · Api 6 · Admin 4 · commercial 7** | **WORST LEAK — chosen.** Same SDK on both sides of the host↔domain boundary; types in API wire contracts; mapping duplicated 5+ ways; a _second_ SDK (Braintree) leaks the same seam. |
| DataProtector `Tokenable` (e.g. `OrgUserInviteTokenable`) | 45                                      | Core 35 · Identity 5 · Api 4 · SharedWeb 1                     | Spread, but a _framework_ abstraction (ASP.NET `IDataProtector`), not a swappable 3rd-party SDK; already funneled through `IDataProtectorTokenFactory`. Not the worst.                |
| MailKit / MimeKit                                         | 3                                       | Core 3                                                         | **Already contained** behind `IMailDeliveryService` (distillation: 5 swappable impls). Not a leak.                                                                                    |
| LaunchDarkly                                              | 2                                       | Core 1 · SharedWeb 1                                           | **Already contained** behind a flag-service seam. Not a leak.                                                                                                                         |

> Note: the Stripe count uses `using Stripe;` + `Stripe.<Type>` patterns. `IStripeAdapter` itself does
> `using Stripe;` then references bare `Customer`/`Subscription`, so the per-line `Stripe.` count _under_-counts
> usage inside files that alias the namespace — the file-level count (101/114) is the honest figure.

---

## STEP 2 — Classify each candidate; choose the worst

**Axes:** (a) **layers/files touched**, (b) **risk/cost of swapping the library today**, (c)
**intent-vs-code gap** (does the code _declare_ it should be swappable while not honoring it?).

| Candidate               | (a) Spread                                                                         | (b) Swap cost today                                                                                                                     | (c) Intent-vs-code gap                                                                                                                                                                                                                                                                                                   | Composite |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **Stripe.net**          | **Highest** — 114 files, 4 host/domain layers, incl. **wire contracts & webhooks** | **Highest** — touching 114 files across hosts + domain + commercial; types in HTTP responses mean a swap is also a **public-API break** | **Strong** — `GatewayType` enum (`GatewayType.cs:5-21`) declares Stripe/Braintree/AppStore/PlayStore/PayPal/Bank as interchangeable gateways, and an `IStripeAdapter`/`ISubscriberService` abstraction _exists_ — yet `Stripe.*` types still appear in 100+ callers, and the abstraction itself **returns Stripe types** | **WORST** |
| DataProtector Tokenable | High                                                                               | Medium (already behind a factory)                                                                                                       | Low — already abstracted                                                                                                                                                                                                                                                                                                 | —         |
| MailKit                 | Low                                                                                | Low                                                                                                                                     | None — honored seam                                                                                                                                                                                                                                                                                                      | —         |
| LaunchDarkly            | Low                                                                                | Low                                                                                                                                     | None — honored seam                                                                                                                                                                                                                                                                                                      | —         |

### Chosen worst leak

> **Stripe.net — the payment-gateway SDK.** It is simultaneously the **most spread** (114 files across
> Core, the Billing host, Api, Admin, and commercial), the **most expensive to swap** (its types sit in
> API **wire contracts** returned to clients, so replacement breaks the public contract, not just internal
> code), and the **strongest intent-vs-code gap**: the codebase _declares_ gateway-agnosticism via the
> `GatewayType` enum and even _built_ an adapter (`IStripeAdapter`) and a parallel `IBraintreeService` —
> proving the team intends multiple gateways — yet the adapter is **Stripe-shaped** (its method signatures
> are Stripe types), so `Stripe.*` still leaks into 100+ files. The abstraction exists in name but does not
> contain the dependency.

---

## STEP 3 — Diagnose: the leaks and the duplication (file:line)

### 3a — Intent declared, code does not honor it (the load-bearing finding)

- **Declared gateway-agnosticism:** `GatewayType` enum lists seven interchangeable gateways —
  `Stripe=0, Braintree=1, AppStore=2, PlayStore=3, BitPay=4, PayPal=5, Bank=6`
  (`src/Core/Enums/GatewayType.cs:5-21`). The domain _also_ defines a provider-neutral
  `PaymentMethodType` (`src/Core/Enums/PaymentMethodType.cs`). Domain entities store gateway ids
  abstractly — `Gateway`/`GatewayCustomerId`/`GatewaySubscriptionId` on `ISubscriber`
  (`src/Core/Entities/ISubscriber.cs:10-12`), `Organization` (`src/Core/AdminConsole/Entities/Organization.cs:168,173,178`),
  `User` (`src/Core/Entities/User.cs:82-86`), `Transaction` (`src/Core/Entities/Transaction.cs:21`).
  **The entity layer is clean** — it correctly stores opaque string ids, not Stripe objects. Good.
- **But the abstraction leaks Stripe:** the supposed seam, `IStripeAdapter`, is **named after Stripe and
  typed in Stripe** — `using Stripe;` then `Task<Customer> CreateCustomerAsync(CustomerCreateOptions …)`,
  `Task<Subscription> …`, `Task<Invoice> …` (`src/Core/Billing/Services/IStripeAdapter.cs:5,11-…`). It is a
  thin pass-through, not an anti-corruption layer. The higher-level `ISubscriberService` likewise traffics in
  Stripe types in its own contract/docs (`src/Core/Billing/Services/ISubscriberService.cs:99-102` returns/
  documents `Stripe.Customer`, `Stripe.PaymentMethod`).
- **The concrete adapter news-up 19 Stripe SDK service clients directly** in its constructor —
  `new CustomerService()`, `new SubscriptionService()`, `new InvoiceService()`, `new PaymentMethodService()`,
  … (`src/Core/Billing/Services/Implementations/StripeAdapter.cs:40-58`) — and the SDK is configured via
  **static global state** set in three separate hosts: `StripeConfiguration.ApiKey = …`
  (`src/Api/Startup.cs:82`, `src/Billing/Startup.cs:43`, `src/Admin/Startup.cs:47`).

> Intent-vs-code gap, quoted: the code declares `[Display(Name = "Stripe")] Stripe = 0, [Display(Name =
"Braintree")] Braintree = 1, …` (`GatewayType.cs:6-9`) — a polymorphic gateway concept — while the only
> abstraction over the gateway, `IStripeAdapter`, hard-codes the Stripe type vocabulary. The code says
> "gateway"; the seam says "Stripe."

### 3b — Dangerous boundary leak: Stripe types in API wire contracts

Stripe SDK objects are returned to HTTP clients (a swap = a breaking public-API change):

- `src/Api/Billing/Models/Responses/InvoicesResponse.cs:1,8,24,31` — `using Stripe;` and
  `From(IEnumerable<Invoice> invoices)` / `From(Invoice invoice)` projecting `invoice.HostedInvoiceUrl` etc.
  straight off `Stripe.Invoice`.
- `src/Api/Billing/Models/Responses/ProviderSubscriptionResponse.cs:8,28-29` — `From(Subscription
subscription, …)` takes `Stripe.Subscription` as the source for a response DTO.
- Inbound too: `src/Api/Billing/Controllers/StripeController.cs:18-25` builds `SetupIntentCreateOptions`
  (Stripe request type) inside an API controller.

### 3c — Dangerous boundary leak: the SDK on both sides of the host↔domain boundary

The **Billing host** parses and dispatches Stripe webhooks, and the **Core domain** consumes Stripe types —
the same SDK on both sides of the boundary:

- Webhook entry: `src/Billing/Controllers/StripeController.cs` (`using Stripe;`, parses `Stripe.Event`,
  validates `StripeConfiguration.ApiVersion`, dispatches to a processor).
- Event extraction contract typed in Stripe: `src/Billing/Services/IStripeEventService.cs` declares
  `Task<Charge> GetCharge(Event …)`, `Task<Customer> GetCustomer(Event …)`, `Task<Invoice> …`,
  `Task<PaymentMethod> …`, `Task<SetupIntent> …`, `Task<Subscription> …` — six Stripe types in one interface.
- **14 webhook handlers** under `src/Billing/Services/Implementations/*Handler.cs`
  (`ChargeRefundedHandler`, `PaymentFailedHandler`, `SubscriptionUpdatedHandler`,
  `InvoiceCreatedHandler`, …) each read raw `Stripe.Invoice`/`Stripe.Subscription`/`Stripe.Charge`
  properties directly (e.g. `PaymentFailedHandler.cs:34-49` reads `invoice.Status`, `invoice.AttemptCount`).

### 3d — Duplicated reconstruction of the library's objects (the duplication signal)

The Stripe `Customer`/`PaymentMethod`/`IPaymentSource` → domain payment-source mapping is **re-implemented at
least five times**, each independently switching on Stripe's magic strings (`"card"`, `"us_bank_account"`) and
re-reading `customer.InvoiceSettings.DefaultPaymentMethod`:

| #   | Site                                                                   | Evidence                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `PaymentSource.From(Stripe.Customer)`                                  | `src/Core/Billing/Models/PaymentSource.cs:14-29` (`switch(defaultPaymentMethod.Type)` on `"card"`/`"us_bank_account"`) — **and** the same record also maps **Braintree** customers (`:48-90`) and Stripe legacy sources (`:111-150`) |
| 2   | `BillingInfo.BillingSource(Stripe.PaymentMethod)` / `(IPaymentSource)` | `src/Core/Billing/Models/BillingInfo.cs:18-58` — a _parallel_ re-implementation of #1 (card/bank/legacy-source), **plus** Braintree overloads (`:60-93`)                                                                             |
| 3   | `MaskedPaymentMethod.From(...)` — 7 overloads                          | `src/Core/Billing/Payment/Models/MaskedPaymentMethod.cs:43-83` (`From(BankAccount)`, `From(Card)`, `From(PaymentMethodCard)`, `From(SetupIntent)`, `From(SourceCard)`, `From(PaymentMethodUsBankAccount)`, `From(PayPalAccount)`)    |
| 4   | `GetPaymentMethodQuery`                                                | `src/Core/Billing/Payment/Queries/GetPaymentMethodQuery.cs:54-74` (`customer.InvoiceSettings.DefaultPaymentMethod.Type switch`)                                                                                                      |
| 5   | `StripePaymentService`                                                 | `src/Core/Billing/Services/Implementations/StripePaymentService.cs` (reconstructs from `customer.InvoiceSettings?.DefaultPaymentMethod?.Type == "card"` and legacy `customer.DefaultSource`)                                         |

Three of these (#1, #2, #3) _also_ duplicate the **Braintree** mapping alongside the Stripe mapping — so the
duplication spans **two** SDKs at once. This is exactly the "duplicated reconstruction of the library's
objects in several places" leak signal.

### 3e — Layer-by-layer summary

| Layer                          | Knows Stripe today?               | Evidence                                                                           |
| ------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------- |
| **API wire contracts**         | **YES (dangerous)**               | `InvoicesResponse.cs:1,8`; `ProviderSubscriptionResponse.cs:8,28`                  |
| **API controllers**            | YES                               | `StripeController.cs:18-25` (Api); 6 files total                                   |
| **Billing host (webhooks)**    | YES (14 handlers + event service) | `Billing/Controllers/StripeController.cs`; `IStripeEventService.cs`; `*Handler.cs` |
| **Core — services/models**     | YES (63 files; the duplication)   | §3d sites; `IStripeAdapter.cs`; `ISubscriberService.cs`                            |
| **Core — entities**            | **NO (clean)**                    | `ISubscriber.cs:10-12` stores opaque gateway ids only                              |
| **Infrastructure (Dapper/EF)** | **NO (clean)**                    | `grep` → 0 files                                                                   |
| **Admin / commercial**         | YES                               | `Admin` 4 files; `bitwarden_license` 7 files                                       |

---

## STEP 4 — Design the ACL: domain value objects + a narrow port + a Stripe adapter

The goal: **one place** knows Stripe's shape. Everything else speaks a small set of **domain value objects**
through a **narrow port**. The existing `IStripeAdapter` is _not_ that port — it is Stripe-typed; it becomes an
internal detail of the adapter (or is deleted). The new port returns domain types only.

### 4.1 Domain value objects (the single place that knows the dependency's shape)

These replace the raw Stripe objects everywhere outside the adapter. They own mapping **to/from the library
type** and **to/from persistence** (the opaque gateway ids already on `ISubscriber`).

```csharp
namespace Bit.Core.Billing.Domain;   // gateway-agnostic — no `using Stripe;`

// Replaces the 5 duplicated PaymentSource/BillingSource/MaskedPaymentMethod reconstructions.
public sealed record DomainPaymentMethod(
    PaymentMethodType Type,         // existing domain enum — NOT a Stripe string
    string Description,             // "VISA, *4242, 04/2027"
    bool NeedsVerification,
    string? CardBrand = null);

public sealed record DomainSubscription(
    string GatewaySubscriptionId,
    SubscriptionStatus Status,      // domain enum, mapped from Stripe's status strings
    DateTime? CurrentPeriodEnd,
    int Seats,
    bool CancelAtPeriodEnd);

public sealed record DomainInvoice(
    string GatewayInvoiceId,
    InvoiceStatus Status,           // domain enum
    decimal AmountDue,
    int AttemptCount,
    string? HostedInvoiceUrl);

public sealed record DomainCustomer(
    string GatewayCustomerId,
    decimal Balance,
    DomainPaymentMethod? DefaultPaymentMethod);

// Webhook events become a closed domain union — the 14 handlers stop touching Stripe.Event.
public abstract record BillingEvent(string GatewayEventId);
public sealed record InvoicePaymentFailed(string GatewayEventId, DomainInvoice Invoice) : BillingEvent(GatewayEventId);
public sealed record SubscriptionCanceled(string GatewayEventId, DomainSubscription Subscription) : BillingEvent(GatewayEventId);
// … one record per handled event type (mirrors the existing 14 handlers)
```

The **only** Stripe-aware mapping lives in the adapter assembly (§4.3), e.g.:

```csharp
// INTERNAL to the adapter — the ONE place that knows Stripe's "card"/"us_bank_account" vocabulary.
internal static class StripeMapping
{
    public static DomainPaymentMethod ToDomain(Stripe.Customer c) { /* the logic now duplicated 5×, once */ }
    public static DomainSubscription ToDomain(Stripe.Subscription s) { … }
    public static DomainInvoice      ToDomain(Stripe.Invoice i) { … }
    public static BillingEvent       ToDomain(Stripe.Event e) { … }   // replaces IStripeEventService + 14 raw reads
}
```

### 4.2 The narrow port (domain interface — Stripe-free)

```csharp
namespace Bit.Core.Billing.Ports;   // NO `using Stripe;` anywhere in this file

// The rest of the codebase knows ONLY this. Gateway-agnostic, honoring the GatewayType intent.
public interface IPaymentGateway
{
    Task<DomainCustomer>      GetCustomerAsync(string gatewayCustomerId);
    Task<DomainPaymentMethod?> GetDefaultPaymentMethodAsync(string gatewayCustomerId);
    Task<DomainSubscription>  GetSubscriptionAsync(string gatewaySubscriptionId);
    Task<DomainSubscription>  CreateSubscriptionAsync(CreateSubscriptionRequest request);  // request = domain DTO
    Task<IReadOnlyList<DomainInvoice>> ListInvoicesAsync(string gatewayCustomerId);
    Task CancelSubscriptionAsync(string gatewaySubscriptionId, CancelReason reason);
}

// Inbound webhook parsing — the narrow seam for the Billing host.
public interface IBillingWebhookParser
{
    BillingEvent Parse(string payload, string signatureHeader);   // throws domain error on bad signature
}
```

### 4.3 The adapter (the single place that knows the library)

```csharp
namespace Bit.Core.Billing.Adapters.Stripe;   // the ONLY assembly/dir allowed to `using Stripe;`

internal sealed class StripePaymentGateway : IPaymentGateway
{
    private readonly IStripeClient _client;   // injected, not static global state (kills StripeConfiguration.ApiKey)

    public async Task<DomainPaymentMethod?> GetDefaultPaymentMethodAsync(string id)
    {
        var customer = await _client.GetCustomerAsync(id, /* options */);
        return StripeMapping.ToDomain(customer);     // the once-and-only mapping
    }
    // … other methods map Stripe → Domain via StripeMapping
}

internal sealed class StripeWebhookParser : IBillingWebhookParser
{
    public BillingEvent Parse(string payload, string sig)
        => StripeMapping.ToDomain(Stripe.EventUtility.ConstructEvent(payload, sig, _secret));
}
```

A future Braintree adapter implements the **same** `IPaymentGateway` — finally honoring `GatewayType.Braintree`
and collapsing the dual-SDK duplication in `PaymentSource`/`BillingInfo`/`MaskedPaymentMethod`.

### 4.4 Thin API / host

- `InvoicesResponse.From(...)` / `ProviderSubscriptionResponse.From(...)` take `DomainInvoice` /
  `DomainSubscription` instead of `Stripe.Invoice` / `Stripe.Subscription` — the wire contract no longer
  exposes Stripe.
- The Billing host's webhook controller calls `IBillingWebhookParser.Parse(...)` → gets a `BillingEvent` →
  dispatches; the 14 handlers switch on the domain union, never on `Stripe.Event`.
- `StripeConfiguration.ApiKey` static assignment in the three `Startup.cs` files is replaced by an injected,
  configured `IStripeClient` registered once in `SharedWeb` — confined to the adapter registration.

---

## STEP 5 — Prove isolation + before/after

### 5.1 A library swap touches only the adapter

| Concern                                                                 | Before (swap Stripe→X today)                                                          | After (swap Stripe→X)                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| DB tables / stored procs / migrations                                   | Untouched (entities already store opaque `Gateway*Id`) — _this part is already clean_ | Untouched                                                   |
| API wire contracts (`InvoicesResponse`, `ProviderSubscriptionResponse`) | **Break** — they expose `Stripe.Invoice`/`Stripe.Subscription`                        | Untouched — they speak `DomainInvoice`/`DomainSubscription` |
| Core services / 5 duplicated mappers                                    | **Edit ~63 Core files**                                                               | Untouched — they speak `IPaymentGateway` + domain VOs       |
| Billing host / 14 webhook handlers                                      | **Edit all 14 + event service**                                                       | Untouched — they speak `BillingEvent`                       |
| Admin / commercial billing                                              | **Edit ~11 files**                                                                    | Untouched                                                   |
| The gateway integration itself                                          | scattered across 114 files                                                            | **New adapter assembly only**                               |

### 5.2 Before/after for the duplicated sites

| Site                                                            | Before                                                                                 | After                                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PaymentSource.cs:14-29` (Stripe `From`)                        | Switches on `"card"`/`"us_bank_account"`, reads `InvoiceSettings.DefaultPaymentMethod` | **Deleted** — replaced by `StripeMapping.ToDomain(Customer)` returning `DomainPaymentMethod` |
| `BillingInfo.cs:18-58`                                          | Parallel re-implementation of the same mapping                                         | **Deleted** — callers consume `DomainPaymentMethod`                                          |
| `MaskedPaymentMethod.cs:43-83` (7 overloads)                    | 7 Stripe/Braintree `From` overloads                                                    | Collapses into the adapter's single mapper                                                   |
| `GetPaymentMethodQuery.cs:54-74`                                | `DefaultPaymentMethod.Type switch`                                                     | Calls `IPaymentGateway.GetDefaultPaymentMethodAsync`                                         |
| `IStripeEventService.cs` (6 Stripe-typed methods) + 14 handlers | Each reads raw `Stripe.*`                                                              | `IBillingWebhookParser` + handlers on `BillingEvent`                                         |
| `InvoicesResponse.cs:8,24`                                      | `From(Stripe.Invoice)` in a response                                                   | `From(DomainInvoice)`                                                                        |
| `StripeConfiguration.ApiKey` × 3 Startups                       | Static global state                                                                    | Injected `IStripeClient` in adapter registration                                             |

---

## STEP 6 — Verification + phased plan

### 6.1 Success criterion (grep-based)

> **`rg`/`grep` for `using Stripe` / `Stripe.<Type>` returns ONLY files under the adapter directory**
> (`src/Core/Billing/Adapters/Stripe/**`) **and the SharedWeb DI registration line.** Zero matches in
> `src/Api`, `src/Admin`, the Billing host outside the webhook-controller wiring, the rest of `Core`, and
> `bitwarden_license`.

### 6.2 Baseline (run now)

```
$ grep -rlE --include="*.cs" '(using Stripe;|using Stripe\.|Stripe\.[A-Z])' src/ bitwarden_license/ | wc -l
114
$ … | sed -E 's#(src|bitwarden_license)/([^/]+)/.*#\1/\2#' | sort | uniq -c | sort -rn
  63 src/Core
  28 src/Billing
   7 bitwarden_license/src
   6 src/Api
   6 bitwarden_license/test
   4 src/Admin
$ grep -rlE --include="*.cs" 'Stripe\.[A-Z]' src/Infrastructure.Dapper src/Infrastructure.EntityFramework | wc -l
0
```

**Baseline = 114 files (101 in `src/` + 13 in `bitwarden_license/`) across 5 layer groups; infra clean.**
Target after refactor: **~1 directory** (the adapter) + 1 DI line.

### 6.3 Who knows the dependency: today vs after

|                                             | Today             | After                                                       |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| API wire contracts                          | 2 files           | 0                                                           |
| API/Admin controllers + startups            | ~12 files         | 0 (startups use injected client via adapter)                |
| Billing host (webhooks + handlers)          | ~28 files         | webhook controller calls the port; mapping lives in adapter |
| Core services/models (incl. 5 duplications) | 63 files          | 0 outside adapter                                           |
| Commercial                                  | 13 files          | 0                                                           |
| **Adapter dir**                             | 0 (doesn't exist) | **all of it**                                               |

### 6.4 Phased, reversible plan (characterization-first; repo convention = feature flags in `Constants.cs`,

5-DB CI matrix, `Core.Test`/`Api.IntegrationTest`)

- **Phase 0 — Characterize.** Pin current behavior of payment-source reconstruction (all 5 sites), invoice/
  subscription responses, and the 14 webhook handlers with tests. Lock the baseline grep count (114).
- **Phase 1 — Introduce domain VOs + ports (no callers).** Add `Bit.Core.Billing.Domain.*`, `IPaymentGateway`,
  `IBillingWebhookParser`, and the closed `BillingEvent` union as pure, Stripe-free domain code with unit tests.
- **Phase 2 — Build the Stripe adapter.** New `Adapters/Stripe/` dir: `StripePaymentGateway`,
  `StripeWebhookParser`, and the single `StripeMapping` (consolidating the 5 duplicated mappers). Inject
  `IStripeClient`; register in `SharedWeb`. The legacy `IStripeAdapter` becomes an internal detail or is wrapped.
- **Phase 3 — Migrate read paths.** Point `GetPaymentMethodQuery`, `InvoicesResponse`,
  `ProviderSubscriptionResponse` at the port + domain VOs. Delete `PaymentSource`/`BillingInfo` reconstruction.
  Wire-contract change is internal (same JSON shape, different source type) — assert via integration tests.
- **Phase 4 — Migrate webhooks.** Route the Billing host through `IBillingWebhookParser`; convert the 14
  handlers to the `BillingEvent` union. Behind a feature flag for safe rollout.
- **Phase 5 — Kill static config.** Replace `StripeConfiguration.ApiKey` in the 3 `Startup.cs` files with the
  injected client confined to adapter registration.
- **Phase 6 — Second gateway (optional, proves the ACL).** Implement `BraintreePaymentGateway : IPaymentGateway`
  and delete the Braintree branches duplicated inside `PaymentSource`/`BillingInfo`/`MaskedPaymentMethod`.
- **Phase 7 — Enforce.** Add a CI grep gate: `using Stripe`/`Stripe.<Type>` allowed only under the adapter dir.

---

## Limitations & honesty notes

- **No PRD** (carried): the "should be swappable" intent is inferred from the code's own `GatewayType` enum and
  `IStripeAdapter`/`IBraintreeService` abstractions, not an authoritative spec.
- **Counts** are file-level (`using Stripe;` / `Stripe.<Type>`). Files that alias the namespace and use bare
  `Customer`/`Invoice` are counted by the `using Stripe;` match but their per-type line counts are _under_-stated;
  the 114-file figure is the honest, reproducible baseline.
- **Line numbers** verified at HEAD 2026-06-12; fast-moving billing files may drift. The 14-handler list and the
  commercial 7-file count were enumerated by a search pass and spot-verified, not each opened line-by-line.
- **Braintree** is the second leaking gateway SDK; it shares the same seam and is folded into the same ACL, but
  a full Braintree file census was not run (focus was the worst leak, Stripe).
- The **`IStripeClient`-injection / kill-static-config** step assumes Stripe.net supports an injectable client
  (it does, via `IStripeClient`); the exact DI wiring is a design target to verify in Phase 2.
- This is a **plan only**; no production code was changed.
