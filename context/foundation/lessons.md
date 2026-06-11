# Lessons Learned

Project-specific recurring rules and incident learnings. Append-only — do not reorder or rewrite past entries. Use `/10x-lesson` to add a new entry when a pattern emerges that should influence future framing, research, planning, implementation, or review.

Entry format:

```markdown
## <short rule title>

- **Context**: where this rule applies (subsystem, work phase, file pattern)
- **Problem**: what breaks without the rule
- **Rule**: imperative, 1-2 sentences
- **Applies to**: frame / research / plan / plan-review / implement / impl-review / all
```

## Abort the prior stream before re-submitting

- **Context**: Any `useObject`/`streamObject` wizard step with a retry or re-pick path (`src/components/wizard/steps/*.tsx`).
- **Problem**: Re-submitting without calling `stop()` first lets an in-flight stream's `onFinish` race the new submission — the later-resolving stream wins the `*_LOADED` dispatch, pairing stale data with the new request. Recurred across reviews: fixed first in AntiBiasStep (F6), then found again in AlternativesStep.retry() and ArtifactStep.retryStream() (F1).
- **Rule**: Call `stop()` as the first statement of every retry/re-pick handler, before `submit()`.
- **Applies to**: implement / impl-review
- **Update (testing-wizard-failure-path)**: a third instance — `SocraticStep.retry()` — was found still missing `stop()` and fixed test-first; all four step handlers (AntiBias pick/retry, Alternatives retry, Artifact retryStream, Socratic retry) now comply and are guarded by `src/components/wizard/steps/streamRace.test.tsx`.

## Default to client:only="react" for React in .astro pages

- **Context**: Any `.astro` page that mounts a React component — i.e. server-rendered (bare or `client:load`/`client:visible`) React in this Astro 6 + React 19 project. Dev mode specifically.
- **Problem**: Server-rendering React throws `jsxDEV is not a function` at runtime in dev (Vite SSR jsx-dev-runtime mismatch). `npm run build` passes (prod uses `jsx`/`jsxs`), so it slips through automated checks and only surfaces when a human loads the page. The wizard already adopted `client:only` to dodge this.
- **Rule**: When mounting a React component from an `.astro` page, default to `client:only="react"` (the project's established pattern). Don't trust `npm run build` to catch render failures — verify any React-bearing page in `npm run dev` before claiming it works.
- **Applies to**: implement / impl-review

## streamObject swallows stream errors — provider failures don't reach the route's catch

- **Context**: `src/pages/api/wizard/*.ts` — any route that calls `streamObject`/`streamText` (AI SDK v6) with an `onError` callback and streams the result (e.g. via `streamWithRetry` reading `textStream`).
- **Problem**: AI SDK delivers _streamed_ provider errors to the `onError` callback (which our routes only `console.error`) and then **closes `textStream` cleanly** — it does NOT throw on read. So `streamWithRetry`'s first `read()` sees `{done:true}` and the route returns **HTTP 200 with an empty body**. The route's `catch` (NonRetryableError → 500) and the whole retry path are unreachable for streamed provider errors; they only catch _pre-stream_ throws (e.g. `getModel()` throwing `OpenRouterUnconfiguredError`). Result: a provider 5xx during streaming is a silent 200 at the server. The user is still protected, but on the **client** — an empty/invalid stream trips `useObject`'s `onFinish` schema check → `REQUEST_FAIL` → visible banner, with no `*_LOADED`/save.
- **Rule**: Don't assume a route's provider-error translation is reachable for streamed failures — it isn't, unless the route inspects the full `stream` for `error` parts (or awaits `.object`). Test provider-failure handling at the **client** (`useObject` `onFinish`/`onError`), not the streaming route. If server-side surfacing is required, that's a route behavior change (inspect error parts / pre-flight before committing the 200), not a test.
- **Applies to**: plan / research / implement / impl-review
