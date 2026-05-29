import { useRef } from "react";
import { ArrowRight, Check } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import { PendingButton } from "../PendingButton";
import { ErrorBanner } from "../ErrorBanner";
import { AntiBiasSkeleton } from "../Skeleton";
import { useWizard } from "../context";
import { canAdvance } from "../reducer";
import { AntiBiasResponseSchema, type AntiBiasTechnique, type QAPair, type SocraticPayload } from "@/types";
import type { Alternative as WizardAlternative, SocraticRound } from "../types";

const TECHNIQUE_META: Record<AntiBiasTechnique, { title: string; blurb: string }> = {
  devils_advocate: {
    title: "Devil's advocate",
    blurb: "Strongest case against your direction, argued in earnest.",
  },
  pre_mortem: {
    title: "Pre-mortem",
    blurb: "Imagine it has already failed. Write the failure story.",
  },
  unknown_unknowns: {
    title: "Unknown unknowns",
    blurb: "Surface hidden assumptions, blind spots, and unasked questions.",
  },
};

const TECHNIQUE_ORDER: AntiBiasTechnique[] = ["devils_advocate", "pre_mortem", "unknown_unknowns"];

function toSocraticPayload(r1: SocraticRound, r2?: SocraticRound): SocraticPayload {
  const pairsFor = (r: SocraticRound): QAPair[] =>
    r.questions.map((question, i) => ({ question, answer: r.answers[i] ?? "" }));
  return r2 ? { round1: pairsFor(r1), round2: pairsFor(r2) } : { round1: pairsFor(r1) };
}

function alternativesForPayload(alts: WizardAlternative[]) {
  return alts.map((a) => ({ title: a.title, pros: a.pros, cons: a.cons }));
}

const ACK_COPY = "I've read this — and I've decided what to do with it.";

function normalizeMarkdown(src: string): string {
  let out = src
    .replace(/([^\n])(#{1,6}\s)/g, "$1\n\n$2")
    .replace(/(#{1,6}\s[^\n]*?)(?=\s+[A-Z][^#\n]{40,})/g, "$1\n\n");
  out = out.replace(/(If you still want to proceed,)/g, "\n\n$1");
  return out;
}

const MD_COMPONENTS: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="mt-4 mb-3 text-xl font-semibold text-white first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mt-5 mb-2 text-lg font-semibold text-white first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mt-4 mb-1.5 text-base font-semibold text-white/95" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="my-2 leading-relaxed text-white/85" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-white/85" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-white/85" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-white" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="text-white/90 italic" {...props}>
      {children}
    </em>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="my-3 border-l-2 border-white/30 pl-3 text-white/75 italic" {...props}>
      {children}
    </blockquote>
  ),
  code: ({ children, ...props }) => (
    <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-white" {...props}>
      {children}
    </code>
  ),
  hr: () => <hr className="my-4 border-white/15" />,
};

export function AntiBiasStep() {
  const { state, dispatch } = useWizard();
  const technique = state.data.antiBiasTechnique;
  const output = state.data.antiBiasOutput;
  const acknowledged = state.data.acknowledgedAt !== undefined;
  const lastSubmittedTechnique = useRef<AntiBiasTechnique | null>(null);

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/wizard/anti-bias",
    schema: AntiBiasResponseSchema,
    onFinish: ({ object: final, error: schemaError }) => {
      if (schemaError) {
        dispatch({ type: "REQUEST_FAIL", error: { kind: "llm", message: schemaError.message } });
        return;
      }
      if (final && lastSubmittedTechnique.current) {
        dispatch({
          type: "ANTI_BIAS_LOADED",
          output: final.markdown,
          technique: lastSubmittedTechnique.current,
        });
      }
    },
    onError: (err) => {
      dispatch({ type: "REQUEST_FAIL", error: { kind: "network", message: err.message } });
    },
  });

  function pick(t: AntiBiasTechnique) {
    if (isLoading) return;
    if (!state.data.socratic1 || !state.data.alternatives) return;
    stop();
    dispatch({ type: "PICK_TECHNIQUE", technique: t });
    lastSubmittedTechnique.current = t;
    dispatch({ type: "REQUEST_START" });
    const payload = {
      description: state.data.description,
      socratic: toSocraticPayload(state.data.socratic1, state.data.socratic2),
      alternatives: alternativesForPayload(state.data.alternatives),
      technique: t,
    };
    submit(payload);
  }

  function retry() {
    if (!technique || !state.data.socratic1 || !state.data.alternatives) return;
    stop();
    lastSubmittedTechnique.current = technique;
    dispatch({ type: "REQUEST_START" });
    const payload = {
      description: state.data.description,
      socratic: toSocraticPayload(state.data.socratic1, state.data.socratic2),
      alternatives: alternativesForPayload(state.data.alternatives),
      technique,
    };
    submit(payload);
  }

  function acknowledge() {
    dispatch({ type: "ACKNOWLEDGE_ANTI_BIAS" });
  }

  function continueNext() {
    dispatch({ type: "GO_TO", step: "artifact" });
  }

  const partial = object;
  const streamingMarkdown = !output && typeof partial?.markdown === "string" ? partial.markdown : "";
  const markdown = output ?? streamingMarkdown;
  const showSkeleton = !!technique && !output && markdown.length === 0;

  return (
    <section className="space-y-5">
      <p className="text-sm text-blue-100/70">
        Pick one anti-bias technique. You&apos;ll have to acknowledge what it tells you before continuing.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {TECHNIQUE_ORDER.map((t) => {
          const meta = TECHNIQUE_META[t];
          const isSelected = technique === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                pick(t);
              }}
              disabled={isLoading && !isSelected}
              aria-pressed={isSelected}
              className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                isSelected
                  ? "border-purple-400/70 bg-purple-500/15 text-white"
                  : "border-white/10 bg-white/5 text-white hover:border-white/30 hover:bg-white/10"
              } ${isLoading && !isSelected ? "opacity-50" : ""}`}
            >
              <span className="text-sm font-semibold text-white">{meta.title}</span>
              <span className="text-xs text-white/70">{meta.blurb}</span>
            </button>
          );
        })}
      </div>

      {showSkeleton ? <AntiBiasSkeleton /> : null}

      {markdown ? (
        <article className="rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-white/85">
          <ReactMarkdown components={MD_COMPONENTS}>{normalizeMarkdown(markdown)}</ReactMarkdown>
        </article>
      ) : null}

      <ErrorBanner error={state.error} onRetry={retry} />
      {error && !state.error ? <ErrorBanner error={{ kind: "llm", message: error.message }} onRetry={retry} /> : null}

      {output ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-sm text-white/80">{ACK_COPY}</p>
          {acknowledged ? (
            <span className="flex items-center gap-1 text-sm text-emerald-300">
              <Check className="size-4" /> Acknowledged
            </span>
          ) : (
            <Button
              type="button"
              onClick={acknowledge}
              className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
            >
              Acknowledge
            </Button>
          )}
        </div>
      ) : null}

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
