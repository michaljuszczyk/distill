import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock the AI SDK streaming hook so the step never touches the network. With a
// seeded `stored` round the init effect early-returns, so the hook only needs to
// report an idle shape; this isolates the state-survival assertion (FR-031).
vi.mock("@ai-sdk/react", () => ({
  experimental_useObject: () => ({
    object: undefined,
    submit: vi.fn(),
    isLoading: false,
    error: undefined,
    stop: vi.fn(),
  }),
}));

import { WizardCtx } from "../context";
import { initialState } from "../reducer";
import type { WizardState } from "../types";
import { SocraticStep } from "./SocraticStep";

function renderSeeded(state: WizardState) {
  return render(
    <WizardCtx.Provider value={{ state, dispatch: vi.fn() }}>
      <SocraticStep />
    </WizardCtx.Provider>,
  );
}

afterEach(cleanup);

describe("SocraticStep — state survival on error (FR-031)", () => {
  it("keeps the user's typed answer rendered and editable when a request has failed", () => {
    const state: WizardState = {
      ...initialState,
      step: "socratic-1",
      data: {
        description: "should I take the job offer?",
        socratic1: {
          questions: ["What outcome are you hoping for?"],
          answers: ["a stable income and room to grow"],
        },
      },
      pending: false,
      error: { kind: "network", message: "fetch failed" },
    };

    renderSeeded(state);

    // The previously typed answer survives the failure: still on screen, still editable.
    const answer = screen.getByLabelText("What outcome are you hoping for?");
    expect(answer).toHaveValue("a stable income and room to grow");
    expect(answer).not.toBeDisabled();

    // The failure is surfaced to the user (network-kind banner + retry affordance).
    expect(screen.getByText("Connection lost — try again")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
