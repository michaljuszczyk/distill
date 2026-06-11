import { describe, expect, it } from "vitest";
import { canAdvance, initialState, reducer } from "./reducer";
import type { WizardState } from "./types";

describe("wizard reducer", () => {
  it("SET_DESCRIPTION updates description", () => {
    const next = reducer(initialState, { type: "SET_DESCRIPTION", value: "buy a house" });
    expect(next.data.description).toBe("buy a house");
  });

  it("GO_TO transitions step", () => {
    const next = reducer(initialState, { type: "GO_TO", step: "socratic-1" });
    expect(next.step).toBe("socratic-1");
  });

  it("REQUEST_FAIL leaves data intact (FR-031)", () => {
    const seeded: WizardState = {
      ...initialState,
      step: "socratic-1",
      data: {
        description: "x",
        socratic1: { questions: ["q1"], answers: ["a1"] },
      },
      pending: true,
    };
    const next = reducer(seeded, {
      type: "REQUEST_FAIL",
      error: { kind: "llm", message: "boom" },
    });
    expect(next.pending).toBe(false);
    expect(next.error).toEqual({ kind: "llm", message: "boom" });
    expect(next.data).toBe(seeded.data);
    expect(next.data.socratic1?.answers[0]).toBe("a1");
  });

  it("REQUEST_FAIL preserves description and a multi-field data (FR-031)", () => {
    const seeded: WizardState = {
      ...initialState,
      step: "anti-bias",
      data: {
        description: "should I take the job offer?",
        socratic1: { questions: ["q1"], answers: ["a1"] },
        alternatives: [{ title: "Stay", pros: ["known"], cons: ["stagnant"] }],
        antiBiasOutput: "## Devils Advocate\n…",
      },
      pending: true,
    };
    const next = reducer(seeded, {
      type: "REQUEST_FAIL",
      error: { kind: "network", message: "fetch failed" },
    });
    expect(next.pending).toBe(false);
    expect(next.error).toEqual({ kind: "network", message: "fetch failed" });
    expect(next.data).toBe(seeded.data);
    expect(next.data.description).toBe("should I take the job offer?");
    expect(next.data.alternatives).toBe(seeded.data.alternatives);
    expect(next.data.antiBiasOutput).toBe("## Devils Advocate\n…");
  });

  it("canAdvance returns false on anti-bias until acknowledgedAt is set", () => {
    const base: WizardState = {
      ...initialState,
      step: "anti-bias",
      data: {
        description: "x",
        antiBiasOutput: "## Devils Advocate\n…",
      },
    };
    expect(canAdvance(base)).toBe(false);
    const acknowledged = reducer(base, { type: "ACKNOWLEDGE_ANTI_BIAS" });
    expect(canAdvance(acknowledged)).toBe(true);
  });

  it("GO_TO artifact is refused without acknowledgedAt", () => {
    const base: WizardState = {
      ...initialState,
      step: "anti-bias",
      data: { description: "x", antiBiasOutput: "md" },
    };
    const next = reducer(base, { type: "GO_TO", step: "artifact" });
    expect(next.step).toBe("anti-bias");
  });

  it("ACKNOWLEDGE_ANTI_BIAS stamps data.acknowledgedAt once", () => {
    const base: WizardState = {
      ...initialState,
      data: { description: "x", antiBiasOutput: "md" },
    };
    const next = reducer(base, { type: "ACKNOWLEDGE_ANTI_BIAS" });
    expect(next.data.acknowledgedAt).toBeTypeOf("number");
  });

  it("ACKNOWLEDGE_ANTI_BIAS is a no-op when antiBiasOutput is undefined", () => {
    const next = reducer(initialState, { type: "ACKNOWLEDGE_ANTI_BIAS" });
    expect(next.data.acknowledgedAt).toBeUndefined();
  });
});
