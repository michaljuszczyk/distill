import type { Action, WizardState, WizardStep } from "./types";

export const initialState: WizardState = {
  step: "describe",
  data: { description: "" },
  pending: false,
  error: null,
};

export function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "SET_DESCRIPTION":
      return { ...state, data: { ...state.data, description: action.value } };

    case "GO_TO": {
      if (action.step === "artifact" && state.data.acknowledgedAt === undefined) {
        return state;
      }
      return { ...state, step: action.step, error: null };
    }

    case "REQUEST_START":
      return { ...state, pending: true, error: null };

    case "REQUEST_FAIL":
      return { ...state, pending: false, error: action.error };

    case "SOCRATIC_LOADED": {
      const key = action.round === 1 ? "socratic1" : "socratic2";
      const prior = state.data[key];
      const answers = prior?.answers ?? action.questions.map(() => "");
      return {
        ...state,
        pending: false,
        data: {
          ...state.data,
          [key]: { questions: action.questions, answers },
          ...(action.round === 1 && action.needsFollowUp !== undefined ? { needsFollowUp1: action.needsFollowUp } : {}),
        },
      };
    }

    case "SOCRATIC_ANSWER": {
      const key = action.round === 1 ? "socratic1" : "socratic2";
      const round = state.data[key];
      if (!round) return state;
      const answers = round.answers.slice();
      answers[action.index] = action.value;
      return { ...state, data: { ...state.data, [key]: { ...round, answers } } };
    }

    case "ALTERNATIVES_LOADED":
      return { ...state, pending: false, data: { ...state.data, alternatives: action.alternatives } };

    case "PICK_TECHNIQUE":
      return {
        ...state,
        data: {
          ...state.data,
          antiBiasTechnique: action.technique,
          antiBiasOutput: undefined,
          acknowledgedAt: undefined,
        },
      };

    case "ANTI_BIAS_LOADED":
      return {
        ...state,
        pending: false,
        data: { ...state.data, antiBiasOutput: action.output, antiBiasTechnique: action.technique },
      };

    case "ACKNOWLEDGE_ANTI_BIAS":
      if (state.data.antiBiasOutput === undefined) return state;
      return { ...state, data: { ...state.data, acknowledgedAt: Date.now() } };

    case "ARTIFACT_LOADED":
      return { ...state, pending: false, data: { ...state.data, artifact: action.artifact, summary: action.summary } };

    case "SAVED":
      return { ...state, data: { ...state.data, savedDecisionId: action.decisionId } };

    default:
      return state;
  }
}

const STEP_ORDER: WizardStep[] = ["describe", "socratic-1", "socratic-2", "alternatives", "anti-bias", "artifact"];

export function stepOrdinal(step: WizardStep): number {
  return STEP_ORDER.indexOf(step) + 1;
}

export function previousStep(step: WizardStep): WizardStep | null {
  const i = STEP_ORDER.indexOf(step);
  if (i <= 0) return null;
  return STEP_ORDER[i - 1];
}

export function canAdvance(state: WizardState): boolean {
  const { step, data } = state;
  switch (step) {
    case "describe":
      return data.description.trim().length > 0;
    case "socratic-1":
      return !!data.socratic1 && data.socratic1.answers.every((a) => a.trim().length > 0);
    case "socratic-2":
      return !!data.socratic2 && data.socratic2.answers.every((a) => a.trim().length > 0);
    case "alternatives":
      return (data.alternatives?.length ?? 0) === 3;
    case "anti-bias":
      return data.antiBiasOutput !== undefined && data.acknowledgedAt !== undefined;
    case "artifact":
      return data.artifact !== undefined;
    default:
      return false;
  }
}
