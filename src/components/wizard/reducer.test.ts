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
