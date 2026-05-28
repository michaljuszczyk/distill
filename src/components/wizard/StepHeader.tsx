import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WizardStep } from "./types";
import { previousStep, stepOrdinal } from "./reducer";

const TITLES: Record<WizardStep, string> = {
  describe: "Describe",
  "socratic-1": "Reflect (round 1)",
  "socratic-2": "Reflect (round 2)",
  alternatives: "Alternatives",
  "anti-bias": "Anti-bias check",
  artifact: "Artifact",
};

interface Props {
  step: WizardStep;
  onBack: (prev: WizardStep) => void;
}

export function StepHeader({ step, onBack }: Props) {
  const prev = previousStep(step);
  return (
    <header className="mb-6 flex items-center gap-3">
      <Button
        variant="ghost"
        size="sm"
        disabled={!prev}
        onClick={() => {
          if (prev) onBack(prev);
        }}
        className="text-white/80 hover:bg-white/10"
        aria-label="Back"
      >
        <ArrowLeft className="size-4" />
        Back
      </Button>
      <h1 className="text-lg font-semibold text-white">
        Step {stepOrdinal(step)} of 6 — {TITLES[step]}
      </h1>
    </header>
  );
}
