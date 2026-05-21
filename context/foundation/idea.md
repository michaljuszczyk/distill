# Distill — MVP (wsad do /10x-shape)

## Pomysł w jednym zdaniu

Aplikacja, która prowadzi mnie sokratejskim wywiadem przez **dowolną nietrywialną decyzję** (zakup laptopa, wybór podłogi, framework, hire, AGD), uwzględnia jakie kryteria są dla mnie ważne, robi anti-bias check i wypluwa ustrukturyzowany dokument z potrzebami, opcjami i ryzykami — gotowy jako wsad do dalszego researchu konkretów (cen, modeli, recenzji).

## Główny problem

Podejmuję decyzje "z głowy" — czytam recenzje, googluję, pytam znajomych, ale każdy mówi przez pryzmat swoich kryteriów. W połowie procesu nie wiem już co dla **mnie** ważne, czego szukam i dlaczego rozważam dane opcje. Łatwo wpaść w confirmation bias (szukam potwierdzenia decyzji którą już półświadomie podjąłem) lub paraliż decyzyjny.

Pain points:
- Klient/szef mówi X, ale potrzebuje Y — programiści (i nie tylko) tracą czas na implementację złych rzeczy
- Zakupy nietrywialne (laptop, AGD, samochód, remont) → setki opcji, zero personal clarity
- Brak narzędzia, które wymusi precyzję **zanim** wejdę w research cen / specyfikacji
- ChatGPT free-form pomaga, ale nie wymusza struktury ani anti-bias

## Persona (wstępna)

Ja: programista, racjonalista, patrzę na opłacalność i parametry, ale zdaję sobie sprawę że są ludzie bardziej emocjonalni (estetyka, wartości, prestiż). Aplikacja powinna pasować do różnych profili — nie ocenia, eksponuje wagi.

Use case dla mnie najczęstszy: decyzje zakupowe (zakup sprzętu, wybór narzędzia/biblioteki), decyzje techniczne (framework, baza, hosting).

## Najmniejszy zestaw funkcjonalności (MVP, 6 tyg.)

1. **Auth** — Supabase Auth (email / magic link). Jeden user, brak organizacji/teamów.
2. **CRUD encji `Decision`** — create / list / view / delete swoich decyzji.
3. **Decision Wizard (6-krokowy flow):**
   - Krok 1: Opisz decyzję (1-3 zdania, free text)
   - Krok 2: AI generuje 4-6 pytań sokratejskich → odpowiadasz po kolei
   - Krok 3: AI proponuje 3 alternatywy z trade-offami
   - Krok 4: Anti-bias pass — wybierasz 1 z 3 technik: **devil's advocate** / **pre-mortem** / **unknown unknowns**
   - Krok 5: AI generuje finalny dokument (structured markdown — potrzeby, kryteria, opcje, ryzyka, pytania do dalszego researchu)
   - Krok 6: Zapisz / Export (download .md lub copy do schowka)
4. **Tylko 1 typ decyzji** — general / free-form. **BRAK domain packów (laptop/dom/hire) na MVP.**
5. **1 LLM** — OpenRouter z 1 modelem (preferencja: Claude Sonnet 4.6 lub GPT-5).
6. **Storage** — Supabase Postgres. Tabele: `decisions`, `decision_messages` (sesja Q&A).
7. **Test E2E** — Playwright happy path: "user loguje się → tworzy decyzję → przechodzi wizard → widzi output → wraca do listy".
8. **CI/CD** — GitHub Actions: build + lint + test + deploy do Cloudflare Pages on merge to `main`.

## Co NIE wchodzi w zakres MVP

- Profile quiz (rationalist / emotional / pragmatic / conservative) → moduł 2
- Domain packs (laptop / dom / hire / framework) → moduł 2
- Chained anti-bias (3 techniki w sekwencji, nie wybór) → moduł 2
- WebSearch integration (real-time data o opcjach) → moduł 3
- Decision history semantic search → moduł 3
- Multi-user / sharing / collaborative mode → moduł 3
- Follow-up review ("3 mies. później — jak wyszło?") → moduł 4
- Voice mode (decyzje dyktowane z telefonu) → moduł 4
- Eval framework + preview deploys per PR → moduł 5
- Monetization (subskrypcje, marketplace templates) → po kursie

## Logika biznesowa (nie pusty CRUD!)

Sokratejski wywiad + alternatives generation + anti-bias = **AI to logika biznesowa**, nie CRUD. Reguła:

> "Każda decyzja przechodzi przez wywiad (≥ 4 pytania), alternatywy (≥ 3), anti-bias pass (≥ 1 technika). Output musi mieć: needs, options, risks, open questions."

## Kryteria sukcesu

- Mogę odpalić wizard dla realnej decyzji (np. wybór monitora) i dostać użyteczny output w ≤ 15 min
- Co najmniej 1 anti-bias pass realnie zmienia/uzupełnia decyzję w 50%+ przypadków testowych
- Aplikacja działa na publicznym URL z auth
- E2E happy path test zielony
- CI/CD bramuje deploy
- Cały MVP w 50-72h pracy po godzinach (6 tyg.)

## Tech stack (wstępna intuicja, /10x-tech-stack-selector zweryfikuje)

- Frontend: Astro + React islands (zgodnie z rekomendacjami kursu)
- Auth + DB: Supabase
- Hosting: Cloudflare Pages / Workers
- AI: OpenRouter (Claude Sonnet 4.6 default)
- Testy: Playwright (E2E)
- CI: GitHub Actions

## Otwarte pytania (do sesji /10x-shape)

- Czy 1 typ decyzji general wystarczy dla wow demo, czy lepiej 2 starterowe? (intuicja: 1 — anti-bias jest wow)
- Anti-bias = wybór 1 z 3, czy chained w sekwencji? (intuicja: wybór na MVP)
- Czy zapisana sesja może być wznowiona, czy decyzja musi być w jednym posiedzeniu? (intuicja: jedno posiedzenie na MVP)
- Czy export tylko markdown, czy też PDF/JSON? (intuicja: tylko md)
- Czy potrzebuję domain registration na 6 tyg., czy `*.pages.dev` wystarczy do zgłoszenia? (intuicja: `pages.dev` wystarczy)
- Jak udowodnić że anti-bias naprawdę działa? Eval framework w MVP czy moduł 5? (intuicja: moduł 5)
