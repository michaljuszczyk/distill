import { createContext, useContext, type Dispatch } from "react";
import type { Action, WizardState } from "./types";

export interface WizardCtxValue {
  state: WizardState;
  dispatch: Dispatch<Action>;
}

export const WizardCtx = createContext<WizardCtxValue | null>(null);

export function useWizard(): WizardCtxValue {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error("useWizard must be used inside <WizardApp />");
  return ctx;
}
