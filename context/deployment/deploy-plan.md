# Pierwsze wdrożenie distill na Cloudflare Workers

## Context

PRD i `tech-stack.md` zakładają manualny deploy MVP, `infrastructure.md` rekomenduje **Cloudflare Workers + Static Assets** (free plan, observability on od dnia 1). Stack już zbootstrapowany: `astro.config.mjs` używa `@astrojs/cloudflare`, `wrangler.jsonc` ma `nodejs_compat` + `observability.enabled`. Brakuje trzech rzeczy, by zrobić pierwszy `wrangler deploy`:

1. Nazwa Workera w `wrangler.jsonc` to wciąż `10x-astro-starter` (sub-domena `*.workers.dev` — chcemy `distill`).
2. Brak `head_sampling_rate` w `observability` (zalecane przez `infrastructure.md` step 3 dla 100% retencji na free tier).
3. Brak secrets na Cloudflare (`SUPABASE_URL`, `SUPABASE_KEY`) — bez nich SSR + middleware Supabase wyrzucą błąd.

Cel: pierwsza działająca instancja na `distill.<account>.workers.dev` + baseline CPU-ms z `wrangler tail` dla SSR `/` i `/auth/signin`, żeby od razu wiedzieć czy free tier (10 ms CPU/request) wystarczy.

Decyzje użytkownika (potwierdzone): Supabase remote istnieje, `wrangler` zalogowany, rename na `distill` OK, smoke test bez LLM (current pages).

## Approach

### Krok 1 — Update `wrangler.jsonc` (jedyna zmiana w repo)

Plik: `wrangler.jsonc` (jedyna edycja kodu w całym wdrożeniu)

- `"name": "10x-astro-starter"` → `"name": "distill"`
- `"observability": { "enabled": true }` → `"observability": { "enabled": true, "head_sampling_rate": 1 }`

Wszystko inne (main entry `@astrojs/cloudflare/entrypoints/server`, `assets.directory: ./dist`, `compatibility_date: 2026-05-08`, `compatibility_flags: ["nodejs_compat"]`) zgodne z layoutem opisanym w `infrastructure.md` punkt 2 — nie ruszamy.

Nie wpisujemy `SUPABASE_KEY` ani `SUPABASE_URL` do `[vars]` (risk register, row 6: secrets-in-vars to high-impact mistake).

### Krok 2 — Local `.dev.vars` (sanity check przed deploy)

`.dev.vars` jest w `.gitignore`, brak go w drzewie. Utworzyć z istniejącymi credentialami Supabase remote:

```
SUPABASE_URL=...
SUPABASE_KEY=...
```

Potem `npm run dev` — sprawdzić że `/` SSR + `/auth/signin` działają lokalnie z prawdziwym Supabase (nie tylko local stack). Jeśli middleware (`src/middleware.ts:7`) prawidłowo tworzy klienta i zwraca user/null bez błędów — gotowe do deploy.

### Krok 3 — Set production secrets

User uruchamia interaktywnie (nie agent — secrets to human-in-loop wg `infrastructure.md` "Operational Story / Approval"):

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Verify: `npx wrangler secret list` — powinno pokazać oba klucze (bez wartości).

### Krok 4 — Build + deploy

```bash
npm run build
npx wrangler deploy
```

`npm run build` wymaga `SUPABASE_URL`/`SUPABASE_KEY` w env (CLAUDE.md hard rule + envField `access: "secret"` w `astro.config.mjs:19-20`) — w shellu: `export $(grep -v '^#' .dev.vars | xargs)` przed buildem (lub jednorazowo `SUPABASE_URL=... SUPABASE_KEY=... npm run build`).

`wrangler deploy` zwraca URL produkcyjny `https://distill.<account>.workers.dev`.

### Krok 5 — Day-1 smoke test (baseline CPU)

W jednym terminalu:

```bash
npx wrangler tail
```

W drugim/przeglądarce: odwiedzić `https://distill.<account>.workers.dev/` oraz `https://distill.<account>.workers.dev/auth/signin` (po kilka razy, żeby uniknąć cold-start outlier).

Z `wrangler tail` zanotować `cpuTime` per request:

- **5–8 ms** → free tier realny, można zostać.
- **12–18 ms** → przełączyć na Workers Paid ($5/mo) **przed** dodaniem pierwszego wizard-stepa z LLM (infrastructure.md step 6).
- **>20 ms / 1027 errors** → pre-mortem scenariusz; jeszcze przed Paid sprawdzić co w middleware zjada CPU (Supabase SSR `getUser()` jest podejrzane).

To jest baseline **bez LLM** — gdy pierwszy wizard-step pójdzie, trzeba powtórzyć i dodać LLM-call CPU do bilansu.

## Critical files

- `wrangler.jsonc` — jedyny edytowany plik (rename + head_sampling_rate).

**Read-only references** (nie zmieniamy, ale plan się o nie opiera):

- `astro.config.mjs:7,11,16-22` — adapter cloudflare + `output: "server"` + envField schema.
- `src/middleware.ts:6-25` — middleware uruchamia się na każdym requeście, dolicza ~ms CPU do każdego SSR (kluczowe dla baseline).
- `.env.example` — kontrakt kluczy.
- `.gitignore` — potwierdza że `.dev.vars` i `.env*` poza commitem.
- `context/foundation/infrastructure.md` "Getting Started" punkty 1–6 — kanoniczna sekwencja, plan się z niej wywodzi.

## Verification

End-to-end check po wdrożeniu:

1. `npx wrangler deployments list` — najnowszy deployment widoczny, status success.
2. `curl -I https://distill.<account>.workers.dev/` — HTTP 200, header `cf-ray` obecny (= edge serving).
3. Otworzyć URL w przeglądarce — Welcome strona renderuje się, brak errorów w `wrangler tail`.
4. Otworzyć `/auth/signin` — formularz renderuje się, middleware nie wybucha (`context.locals.user = null` flow).
5. `wrangler tail` przez ~5 requestów: zapisać CPU-ms baseline (cel: <10 ms). Jeśli >10 ms ale brak 1027 → ostrzeżenie, nie blocker.
6. Cloudflare dashboard → Workers → distill → Observability → potwierdzić że logi się retencjonują (`head_sampling_rate: 1`).
7. Rollback drill (opcjonalny, ale wg `infrastructure.md` "Operational Story / Rollback" warto raz przećwiczyć): `npx wrangler rollback --message "drill"` na pustym deployment ID, potwierdzić że poprzedni hash wraca, potem deploy z powrotem.

## Out of scope (świadomie)

- CI/CD pipeline — PRD non-goal, manualny deploy.
- Custom domain (mapowanie poza `*.workers.dev`) — po MVP.
- Supabase migracje produkcji — brak `supabase/migrations/`; gdy pojawi się pierwsza tabela, `supabase db push` osobno przed deployem (rollback Workers ≠ rollback migracji, ryzyko z `infrastructure.md`).
- LLM endpoint baseline — wraca w iteracji z pierwszym wizard-step.
- Pre-commit audit `wrangler.jsonc` na secret-leakage — risk register row 6 sugeruje, ale to praca poza zakresem pierwszego deploya.
