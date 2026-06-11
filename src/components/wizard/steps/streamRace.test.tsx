import { act, useEffect, useReducer, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Risk #7: a re-submit/re-pick must abort the in-flight stream (`stop()`) before
// `submit()`, else the prior stream's stale `onFinish` can win the `*_LOADED` dispatch.
// The defense is ordering-only (no request-id guard in the reducer), so we assert the
// RESULTING reducer state, not call order (test-plan §2 anti-pattern).
//
// The mock models the AI SDK contract: `submit()` opens a stream; `stop()` aborts every
// live stream so its `onFinish` is suppressed. The test fires the FRESH stream's finish
// then the STALE one's (stale-resolves-after-fresh) and asserts fresh data survives.
const hub = vi.hoisted(() => ({
  streams: [] as { aborted: boolean; fired: boolean }[],
  onFinish: { current: null as null | ((r: { object: unknown; error: Error | undefined }) => void) },
}));

vi.mock("@ai-sdk/react", () => ({
  experimental_useObject: (opts: { onFinish: (r: { object: unknown; error: Error | undefined }) => void }) => {
    hub.onFinish.current = opts.onFinish;
    return {
      object: undefined,
      isLoading: false,
      error: new Error("stream error"),
      submit: () => {
        hub.streams.push({ aborted: false, fired: false });
      },
      stop: () => {
        for (const s of hub.streams) if (!s.fired) s.aborted = true;
      },
    };
  },
}));

import { WizardCtx } from "../context";
import { initialState, reducer } from "../reducer";
import type { Alternative, SocraticRound, WizardData, WizardState, WizardStep } from "../types";
import { SocraticStep } from "./SocraticStep";
import { AlternativesStep } from "./AlternativesStep";
import { AntiBiasStep } from "./AntiBiasStep";
import { ArtifactStep } from "./ArtifactStep";

const socratic1: SocraticRound = { questions: ["seed q"], answers: ["seed a"] };
const alts: Alternative[] = [
  { title: "Seed A", pros: ["p"], cons: ["c"] },
  { title: "Seed B", pros: ["p"], cons: ["c"] },
  { title: "Seed C", pros: ["p"], cons: ["c"] },
];
const seedArtifact = { needs: ["n"], criteria: ["c"], options: ["o"], risks: ["r"], open_questions: ["q"] };

const latest: { state: WizardState } = { state: initialState };

function Harness({ initial, children }: { initial: WizardState; children: ReactElement }) {
  const [state, dispatch] = useReducer(reducer, initial);
  useEffect(() => {
    latest.state = state;
  });
  return <WizardCtx.Provider value={{ state, dispatch }}>{children}</WizardCtx.Provider>;
}

function seed(step: WizardStep, data: WizardData): WizardState {
  return { ...initialState, step, data, pending: false, error: null };
}

function fireFinish(index: number, object: unknown) {
  const s = hub.streams[index];
  if (s.aborted) return; // an aborted stream's onFinish never fires
  s.fired = true;
  act(() => {
    hub.onFinish.current?.({ object, error: undefined });
  });
}

interface Case {
  name: string;
  node: ReactElement;
  initial: WizardState;
  fresh: unknown;
  stale: unknown;
  freshValue: (s: WizardState) => unknown;
  expected: unknown;
}

const cases: Case[] = [
  {
    name: "SocraticStep.retry",
    node: <SocraticStep />,
    initial: seed("socratic-1", { description: "d", socratic1 }),
    fresh: { questions: ["FRESH-Q"], needsFollowUp: false },
    stale: { questions: ["STALE-Q"], needsFollowUp: false },
    freshValue: (s) => s.data.socratic1?.questions[0],
    expected: "FRESH-Q",
  },
  {
    name: "AlternativesStep.retry",
    node: <AlternativesStep />,
    initial: seed("alternatives", { description: "d", socratic1, alternatives: alts }),
    fresh: { alternatives: [{ title: "FRESH", pros: ["p"], cons: ["c"] }] },
    stale: { alternatives: [{ title: "STALE", pros: ["p"], cons: ["c"] }] },
    freshValue: (s) => s.data.alternatives?.[0]?.title,
    expected: "FRESH",
  },
  {
    name: "AntiBiasStep.retry",
    node: <AntiBiasStep />,
    initial: seed("anti-bias", {
      description: "d",
      socratic1,
      alternatives: alts,
      antiBiasTechnique: "devils_advocate",
      antiBiasOutput: "seed md",
    }),
    fresh: { markdown: "FRESH" },
    stale: { markdown: "STALE" },
    freshValue: (s) => s.data.antiBiasOutput,
    expected: "FRESH",
  },
  {
    name: "ArtifactStep.retryStream",
    node: <ArtifactStep />,
    initial: seed("artifact", {
      description: "d",
      socratic1,
      alternatives: alts,
      antiBiasTechnique: "devils_advocate",
      antiBiasOutput: "seed md",
      artifact: seedArtifact,
      summary: "seed summary",
      savedDecisionId: "d1", // skip auto-save on the success dispatch
    }),
    fresh: { summary: "FRESH", ...seedArtifact },
    stale: { summary: "STALE", ...seedArtifact },
    freshValue: (s) => s.data.summary,
    expected: "FRESH",
  },
];

afterEach(() => {
  cleanup();
  hub.streams.length = 0;
  hub.onFinish.current = null;
  latest.state = initialState;
});

describe("Risk #7 — re-submit aborts the prior stream so a stale onFinish cannot win", () => {
  for (const c of cases) {
    it(`${c.name}: fresh request's data survives a late stale onFinish`, () => {
      render(<Harness initial={c.initial}>{c.node}</Harness>);

      // Two re-triggers: stream A (index 0), then the fresh stream B (index 1).
      const retry = () => fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      retry();
      retry();

      // Fresh (B) resolves first, then the stale (A) resolves later — the race window.
      fireFinish(1, c.fresh);
      fireFinish(0, c.stale);

      expect(c.freshValue(latest.state)).toBe(c.expected);
    });
  }
});
