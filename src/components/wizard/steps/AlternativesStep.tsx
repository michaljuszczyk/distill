import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { PendingButton } from "../PendingButton";
import { ErrorBanner } from "../ErrorBanner";
import { AlternativesSkeleton } from "../Skeleton";
import { useWizard } from "../context";
import { canAdvance } from "../reducer";
import { AlternativesResponseSchema, type AlternativesResponse, type QAPair, type SocraticPayload } from "@/types";
import type { Alternative as WizardAlternative, SocraticRound } from "../types";

function toSocraticPayload(r1: SocraticRound, r2?: SocraticRound): SocraticPayload {
  const pairsFor = (r: SocraticRound): QAPair[] =>
    r.questions.map((question, i) => ({ question, answer: r.answers[i] ?? "" }));
  return r2 ? { round1: pairsFor(r1), round2: pairsFor(r2) } : { round1: pairsFor(r1) };
}

function normaliseAlt(a: AlternativesResponse["alternatives"][number]): WizardAlternative {
  return { title: a.title, pros: a.pros, cons: a.cons };
}

export function AlternativesStep() {
  const { state, dispatch } = useWizard();
  const description = state.data.description;
  const stored = state.data.alternatives;

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/wizard/alternatives",
    schema: AlternativesResponseSchema,
    onFinish: ({ object: final, error: schemaError }) => {
      if (schemaError) {
        dispatch({ type: "REQUEST_FAIL", error: { kind: "llm", message: schemaError.message } });
        return;
      }
      if (final) {
        dispatch({ type: "ALTERNATIVES_LOADED", alternatives: final.alternatives.map(normaliseAlt) });
      }
    },
    onError: (err) => {
      dispatch({ type: "REQUEST_FAIL", error: { kind: "network", message: err.message } });
    },
  });

  const submitted = useRef(false);
  useEffect(() => {
    if (stored || submitted.current) return;
    if (!state.data.socratic1) return;
    submitted.current = true;
    const payload = toSocraticPayload(state.data.socratic1, state.data.socratic2);
    dispatch({ type: "REQUEST_START" });
    submit({ description, socratic: payload });
  }, [stored, description, state.data.socratic1, state.data.socratic2, submit, dispatch]);

  function retry() {
    if (!state.data.socratic1) return;
    const payload = toSocraticPayload(state.data.socratic1, state.data.socratic2);
    dispatch({ type: "REQUEST_START" });
    submit({ description, socratic: payload });
  }

  function continueNext() {
    dispatch({ type: "GO_TO", step: "anti-bias" });
  }

  const partial = object as Partial<AlternativesResponse> | undefined;
  const partialAlts: (Partial<AlternativesResponse["alternatives"][number]> | undefined)[] = Array.isArray(
    partial?.alternatives,
  )
    ? partial.alternatives
    : [];
  const alternatives: (Partial<AlternativesResponse["alternatives"][number]> | undefined)[] = stored ?? partialAlts;
  const showSkeleton = !stored && alternatives.length === 0;

  return (
    <section className="space-y-4">
      <p className="text-sm text-blue-100/70">
        Three alternatives covering distinct strategic axes. Read all three before continuing.
      </p>

      {showSkeleton ? <AlternativesSkeleton /> : null}

      {alternatives.length > 0 ? (
        <div className="grid items-stretch gap-4 sm:grid-cols-3">
          {alternatives.map((alt, i) => (
            <article
              key={i}
              className="flex h-full flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-5 text-white shadow-sm"
            >
              <h3 className="text-base leading-snug font-semibold text-white">
                {alt?.title ?? <span className="text-white/40">…</span>}
              </h3>
              <div className="border-t border-white/10" />
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">Pros</p>
                <ul className="space-y-1.5 text-sm text-white/85">
                  {(alt?.pros ?? []).map((p, j) => (
                    <li key={j} className="flex gap-2">
                      <span aria-hidden className="mt-1 size-1 shrink-0 rounded-full bg-emerald-300/80" />
                      <span className="leading-snug">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold tracking-wider text-rose-300 uppercase">Cons</p>
                <ul className="space-y-1.5 text-sm text-white/85">
                  {(alt?.cons ?? []).map((c, j) => (
                    <li key={j} className="flex gap-2">
                      <span aria-hidden className="mt-1 size-1 shrink-0 rounded-full bg-rose-300/80" />
                      <span className="leading-snug">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <ErrorBanner error={state.error} onRetry={retry} />
      {error && !state.error ? <ErrorBanner error={{ kind: "llm", message: error.message }} onRetry={retry} /> : null}

      <div className="flex justify-end">
        <PendingButton
          pending={isLoading}
          onClick={continueNext}
          disabled={!canAdvance(state)}
          icon={<ArrowRight className="size-4" />}
          pendingText="Thinking…"
        >
          Continue
        </PendingButton>
      </div>

      {isLoading ? (
        <button type="button" onClick={stop} className="text-xs text-white/60 underline hover:text-white">
          Stop
        </button>
      ) : null}
    </section>
  );
}
