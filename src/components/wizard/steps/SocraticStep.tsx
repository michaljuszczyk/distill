import { useEffect, useMemo, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PendingButton } from "../PendingButton";
import { ErrorBanner } from "../ErrorBanner";
import { SocraticSkeleton } from "../Skeleton";
import { useWizard } from "../context";
import { canAdvance } from "../reducer";
import { SocraticResponseSchema, type QAPair, type SocraticResponse } from "@/types";

type Round = 1 | 2;

interface PriorPayload {
  round1?: QAPair[];
}

function buildPriorPayload(round: Round, prior?: { questions: string[]; answers: string[] }): PriorPayload | undefined {
  if (round !== 2 || !prior) return undefined;
  return {
    round1: prior.questions.map((question, i) => ({ question, answer: prior.answers[i] ?? "" })),
  };
}

export function SocraticStep() {
  const { state, dispatch } = useWizard();
  const round: Round = state.step === "socratic-1" ? 1 : 2;
  const stored = round === 1 ? state.data.socratic1 : state.data.socratic2;
  const description = state.data.description;
  const priorPayload = useMemo(
    () => buildPriorPayload(round, round === 2 ? state.data.socratic1 : undefined),
    [round, state.data.socratic1],
  );

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/wizard/socratic",
    schema: SocraticResponseSchema,
    onFinish: ({ object: final, error: schemaError }) => {
      if (schemaError) {
        dispatch({ type: "REQUEST_FAIL", error: { kind: "llm", message: schemaError.message } });
        return;
      }
      if (final) {
        dispatch({
          type: "SOCRATIC_LOADED",
          round,
          questions: final.questions,
          needsFollowUp: final.needsFollowUp,
        });
      }
    },
    onError: (err) => {
      dispatch({ type: "REQUEST_FAIL", error: { kind: "network", message: err.message } });
    },
  });

  const submittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (stored) return;
    const key = `${round}::${description}`;
    if (submittedFor.current === key) return;
    submittedFor.current = key;
    dispatch({ type: "REQUEST_START" });
    submit({ description, priorAnswers: priorPayload });
  }, [stored, round, description, priorPayload, submit, dispatch]);

  function retry() {
    submittedFor.current = null;
    dispatch({ type: "REQUEST_START" });
    submit({ description, priorAnswers: priorPayload });
  }

  function continueNext() {
    if (round === 1) {
      const next = state.data.needsFollowUp1 ? "socratic-2" : "alternatives";
      dispatch({ type: "GO_TO", step: next });
    } else {
      dispatch({ type: "GO_TO", step: "alternatives" });
    }
  }

  const partial = object as Partial<SocraticResponse> | undefined;
  const questions: string[] = stored?.questions ?? (Array.isArray(partial?.questions) ? partial.questions : []);
  const showSkeleton = !stored && questions.length === 0;

  return (
    <section className="space-y-4">
      <p className="text-sm text-blue-100/70">
        {round === 1
          ? "Answer in your own words. There are no right answers — just be honest."
          : "A few follow-ups to deepen the answers you gave."}
      </p>

      {showSkeleton ? <SocraticSkeleton approxN={4} /> : null}

      {questions.length > 0 ? (
        <ul className="space-y-4">
          {questions.map((q, i) => (
            <li key={i} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
              <Label htmlFor={`socratic-${round}-${i}`} className="text-white">
                {q}
              </Label>
              <Textarea
                id={`socratic-${round}-${i}`}
                value={stored?.answers[i] ?? ""}
                onChange={(e) => {
                  dispatch({ type: "SOCRATIC_ANSWER", round, index: i, value: e.target.value });
                }}
                disabled={!stored}
                rows={3}
                className="border-white/20 bg-white/5 text-white placeholder:text-white/40"
                placeholder="…"
              />
            </li>
          ))}
        </ul>
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
