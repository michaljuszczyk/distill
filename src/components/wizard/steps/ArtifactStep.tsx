import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { ErrorBanner } from "../ErrorBanner";
import { ArtifactSkeleton } from "../Skeleton";
import { useWizard } from "../context";
import { ArtifactView } from "@/components/artifact/ArtifactView";
import { ExportActions } from "@/components/artifact/ExportActions";
import { firstNonEmptyLine } from "@/lib/wizard/exporter";
import {
  ArtifactResponseSchema,
  type ArtifactResponse,
  type Artifact,
  type NewDecisionInput,
  type QAPair,
  type SocraticPayload,
} from "@/types";
import type { Alternative as WizardAlternative, SocraticRound, WizardState } from "../types";

function toSocraticPayload(r1: SocraticRound, r2?: SocraticRound): SocraticPayload {
  const pairsFor = (r: SocraticRound): QAPair[] =>
    r.questions.map((question, i) => ({ question, answer: r.answers[i] ?? "" }));
  return r2 ? { round1: pairsFor(r1), round2: pairsFor(r2) } : { round1: pairsFor(r1) };
}

function alternativesForPayload(alts: WizardAlternative[]) {
  return alts.map((a) => ({ title: a.title, pros: a.pros, cons: a.cons }));
}

function buildSavePayload(state: WizardState, artifact: Artifact, summary: string): NewDecisionInput | null {
  if (!state.data.antiBiasTechnique) return null;
  return {
    description: state.data.description,
    summary,
    artifact,
    anti_bias_technique: state.data.antiBiasTechnique,
  };
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";

export function ArtifactStep() {
  const { state, dispatch } = useWizard();
  const stored = state.data.artifact;
  const storedSummary = state.data.summary;
  const savedDecisionId = state.data.savedDecisionId;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>(savedDecisionId ? "saved" : "idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitted = useRef(false);
  const savedOnce = useRef(!!savedDecisionId);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const save = useCallback(
    async (payload: NewDecisionInput) => {
      setSaveStatus("saving");
      setSaveError(null);
      try {
        const res = await fetch("/api/decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status !== 201) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setSaveStatus("failed");
          setSaveError(body.error ?? `Save failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { id: string };
        dispatch({ type: "SAVED", decisionId: body.id });
        setSaveStatus("saved");
      } catch (err) {
        setSaveStatus("failed");
        setSaveError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [dispatch],
  );

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/wizard/artifact",
    schema: ArtifactResponseSchema,
    onFinish: ({ object: final, error: schemaError }) => {
      if (schemaError) {
        dispatch({ type: "REQUEST_FAIL", error: { kind: "llm", message: schemaError.message } });
        return;
      }
      if (!final) return;
      const { summary, ...artifact } = final;
      dispatch({ type: "ARTIFACT_LOADED", artifact, summary });
      if (savedOnce.current) return;
      const payload = buildSavePayload(stateRef.current, artifact, summary);
      if (!payload) return;
      savedOnce.current = true;
      void save(payload);
    },
    onError: (err) => {
      dispatch({ type: "REQUEST_FAIL", error: { kind: "network", message: err.message } });
    },
  });

  useEffect(() => {
    if (stored || submitted.current) return;
    if (
      !state.data.socratic1 ||
      !state.data.alternatives ||
      !state.data.antiBiasTechnique ||
      !state.data.antiBiasOutput
    )
      return;
    submitted.current = true;
    const payload = {
      description: state.data.description,
      socratic: toSocraticPayload(state.data.socratic1, state.data.socratic2),
      alternatives: alternativesForPayload(state.data.alternatives),
      technique: state.data.antiBiasTechnique,
      antiBiasMarkdown: state.data.antiBiasOutput,
    };
    dispatch({ type: "REQUEST_START" });
    submit(payload);
  }, [
    stored,
    state.data.description,
    state.data.socratic1,
    state.data.socratic2,
    state.data.alternatives,
    state.data.antiBiasTechnique,
    state.data.antiBiasOutput,
    submit,
    dispatch,
  ]);

  const partial = object as Partial<ArtifactResponse> | undefined;
  const displayArtifact: Partial<Artifact> = stored ?? {
    needs: partial?.needs?.filter((v): v is string => typeof v === "string"),
    criteria: partial?.criteria?.filter((v): v is string => typeof v === "string"),
    options: partial?.options?.filter((v): v is string => typeof v === "string"),
    risks: partial?.risks?.filter((v): v is string => typeof v === "string"),
    open_questions: partial?.open_questions?.filter((v): v is string => typeof v === "string"),
  };
  const displaySummary = storedSummary ?? (typeof partial?.summary === "string" ? partial.summary : "");
  const showSkeleton = !stored && !partial;

  function retrySave() {
    if (!stored || !storedSummary) return;
    const payload = buildSavePayload(state, stored, storedSummary);
    if (!payload) return;
    void save(payload);
  }

  function retryStream() {
    if (
      !state.data.socratic1 ||
      !state.data.alternatives ||
      !state.data.antiBiasTechnique ||
      !state.data.antiBiasOutput
    )
      return;
    stop();
    const payload = {
      description: state.data.description,
      socratic: toSocraticPayload(state.data.socratic1, state.data.socratic2),
      alternatives: alternativesForPayload(state.data.alternatives),
      technique: state.data.antiBiasTechnique,
      antiBiasMarkdown: state.data.antiBiasOutput,
    };
    dispatch({ type: "REQUEST_START" });
    submit(payload);
  }

  const streamErrorVisible = !!error && !state.error;

  const exportInput: NewDecisionInput | null =
    stored && storedSummary && state.data.antiBiasTechnique
      ? {
          description: state.data.description,
          summary: storedSummary,
          artifact: stored,
          anti_bias_technique: state.data.antiBiasTechnique,
        }
      : null;

  return (
    <section className="space-y-5">
      <p className="text-sm text-blue-100/70">
        Your structured decision. Auto-saves when the stream completes. Copy or download as Markdown.
      </p>

      {showSkeleton ? <ArtifactSkeleton /> : null}

      {!showSkeleton ? (
        <ArtifactView
          title={firstNonEmptyLine(state.data.description) || "Untitled"}
          summary={displaySummary}
          artifact={displayArtifact}
        />
      ) : null}

      <ErrorBanner error={state.error} onRetry={retryStream} />
      {streamErrorVisible ? (
        <ErrorBanner error={{ kind: "llm", message: error.message }} onRetry={retryStream} />
      ) : null}

      {stored ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-sm">
            {saveStatus === "saved" ? (
              <span className="flex items-center gap-1 text-emerald-300">
                <Check className="size-4" /> Saved
              </span>
            ) : saveStatus === "saving" ? (
              <span className="text-white/70">Saving…</span>
            ) : saveStatus === "failed" ? (
              <span className="text-rose-300">Save failed</span>
            ) : (
              <span className="text-white/60">Idle</span>
            )}
          </div>
          {exportInput ? <ExportActions input={exportInput} /> : null}
        </div>
      ) : null}

      {saveStatus === "failed" ? (
        <ErrorBanner error={{ kind: "network", message: saveError ?? "Save failed — try again" }} onRetry={retrySave} />
      ) : null}

      {isLoading ? (
        <button type="button" onClick={stop} className="text-xs text-white/60 underline hover:text-white">
          Stop
        </button>
      ) : null}
    </section>
  );
}
