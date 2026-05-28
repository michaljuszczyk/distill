import type { AntiBiasTechnique, Artifact } from "@/types";

export type WizardStep = "describe" | "socratic-1" | "socratic-2" | "alternatives" | "anti-bias" | "artifact";

export interface SocraticRound {
  questions: string[];
  answers: string[];
}

export interface Alternative {
  title: string;
  pros: string[];
  cons: string[];
}

export type WizardError =
  | { kind: "llm"; message: string }
  | { kind: "network"; message: string }
  | { kind: "validation"; field?: string; message: string };

export interface WizardData {
  description: string;
  socratic1?: SocraticRound;
  socratic2?: SocraticRound;
  needsFollowUp1?: boolean;
  alternatives?: Alternative[];
  antiBiasTechnique?: AntiBiasTechnique;
  antiBiasOutput?: string;
  acknowledgedAt?: number;
  artifact?: Artifact;
  summary?: string;
  savedDecisionId?: string;
}

export interface WizardState {
  step: WizardStep;
  data: WizardData;
  pending: boolean;
  error: WizardError | null;
}

export type Action =
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "GO_TO"; step: WizardStep }
  | { type: "REQUEST_START" }
  | { type: "REQUEST_FAIL"; error: WizardError }
  | { type: "SOCRATIC_LOADED"; round: 1 | 2; questions: string[]; needsFollowUp?: boolean }
  | { type: "SOCRATIC_ANSWER"; round: 1 | 2; index: number; value: string }
  | { type: "ALTERNATIVES_LOADED"; alternatives: Alternative[] }
  | { type: "PICK_TECHNIQUE"; technique: AntiBiasTechnique }
  | { type: "ANTI_BIAS_LOADED"; output: string; technique: AntiBiasTechnique }
  | { type: "ACKNOWLEDGE_ANTI_BIAS" }
  | { type: "ARTIFACT_LOADED"; artifact: Artifact; summary: string }
  | { type: "SAVED"; decisionId: string };
