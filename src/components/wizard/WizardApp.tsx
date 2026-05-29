import { useReducer } from "react";
import { ErrorBanner } from "./ErrorBanner";
import { StepHeader } from "./StepHeader";
import { initialState, reducer } from "./reducer";
import { DescribeStep } from "./steps/DescribeStep";
import { SocraticStep } from "./steps/SocraticStep";
import { AlternativesStep } from "./steps/AlternativesStep";
import { AntiBiasStep } from "./steps/AntiBiasStep";
import { WizardCtx } from "./context";
import type { WizardStep } from "./types";

function Placeholder({ step }: { step: WizardStep }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
      Step <code>{step}</code> not yet implemented in this phase.
    </div>
  );
}

interface StepBodyProps {
  step: WizardStep;
}

function StepBody({ step }: StepBodyProps) {
  switch (step) {
    case "describe":
      return <DescribeStep />;
    case "socratic-1":
    case "socratic-2":
      return <SocraticStep />;
    case "alternatives":
      return <AlternativesStep />;
    case "anti-bias":
      return <AntiBiasStep />;
    default:
      return <Placeholder step={step} />;
  }
}

export default function WizardApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <WizardCtx.Provider value={{ state, dispatch }}>
      <StepHeader
        step={state.step}
        onBack={(prev) => {
          dispatch({ type: "GO_TO", step: prev });
        }}
      />
      <ErrorBanner error={state.error} />
      <div className="mt-4">
        <StepBody step={state.step} />
      </div>
    </WizardCtx.Provider>
  );
}
