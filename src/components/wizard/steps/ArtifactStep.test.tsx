import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Action } from "../types";

// Risk #2 protection lives on the CLIENT, not the artifact route: a provider stream
// error surfaces as an empty/invalid stream (the route returns 200, see
// `context/foundation/lessons.md`). These tests assert the real guarantee — the user
// sees a visible error and NO fabricated artifact is committed or saved.
//
// The AI SDK hook is mocked so the test controls the stream outcome. `hoisted.error`
// drives the hook's error state; `hoisted.opts` captures the `onFinish`/`onError`
// callbacks the component registered, so we can fire a stream outcome by hand.
const hoisted = vi.hoisted(() => ({
  opts: null as { onFinish?: (r: unknown) => void; onError?: (e: Error) => void } | null,
  error: undefined as Error | undefined,
  submit: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  experimental_useObject: (opts: typeof hoisted.opts) => {
    hoisted.opts = opts;
    return { object: undefined, submit: hoisted.submit, isLoading: false, error: hoisted.error, stop: hoisted.stop };
  },
}));

import { WizardCtx } from "../context";
import { initialState } from "../reducer";
import type { WizardState } from "../types";
import { ArtifactStep } from "./ArtifactStep";

const fullData: WizardState["data"] = {
  description: "should I move?",
  socratic1: { questions: ["q"], answers: ["a"] },
  alternatives: [
    { title: "Move now", pros: ["closer"], cons: ["disrupt"] },
    { title: "Wait", pros: ["stable"], cons: ["commute"] },
    { title: "Stay", pros: ["no churn"], cons: ["stagnation"] },
  ],
  antiBiasTechnique: "devils_advocate",
  antiBiasOutput: "## Devil's advocate\n…",
};

function renderStep(state: WizardState, dispatch: (a: Action) => void = vi.fn()) {
  return render(
    <WizardCtx.Provider value={{ state, dispatch }}>
      <ArtifactStep />
    </WizardCtx.Provider>,
  );
}

afterEach(() => {
  cleanup();
  hoisted.opts = null;
  hoisted.error = undefined;
  hoisted.submit.mockReset();
  hoisted.stop.mockReset();
});

describe("ArtifactStep — provider failure surfaces a visible error, no fabricated artifact (Risk #2)", () => {
  it("renders a visible error banner and no saved-artifact UI when the stream errors", () => {
    hoisted.error = new Error("stream failed");
    renderStep({ ...initialState, step: "artifact", data: { description: "should I move?" }, error: null });

    // Visible error to the user (llm-kind copy from ErrorBanner).
    expect(screen.getByText("The AI service is having trouble. Try again?")).toBeInTheDocument();
    // No fabricated artifact presented as saved/exportable.
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("dispatches REQUEST_FAIL and never commits or saves an artifact on a schema-invalid finish", () => {
    const dispatch = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderStep({ ...initialState, step: "artifact", data: fullData, error: null }, dispatch);

    // The mounted step submitted the request (mock no-op) and signalled pending.
    expect(dispatch).toHaveBeenCalledWith({ type: "REQUEST_START" });

    // Simulate the SDK finishing with an unparseable object (the empty/invalid stream
    // a provider failure produces). Assert the step actually registered onFinish first,
    // so this doesn't pass vacuously if a refactor drops the callback.
    expect(hoisted.opts?.onFinish).toBeTypeOf("function");
    hoisted.opts?.onFinish?.({ object: { summary: 42 }, error: new Error("schema invalid") });

    const dispatched = dispatch.mock.calls.map(([a]) => (a as Action).type);
    expect(dispatched).toContain("REQUEST_FAIL");
    expect(dispatched).not.toContain("ARTIFACT_LOADED");
    expect(dispatched).not.toContain("SAVED");
    // No save attempt was made to /api/decisions.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
