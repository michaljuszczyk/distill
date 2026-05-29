import { useEffect, useRef } from "react";
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);
  return (
    <header className="mb-6 flex items-center gap-3">
      <Button
        variant="ghost"
        size="sm"
        disabled={!prev}
        onClick={() => {
          if (prev) onBack(prev);
        }}
        className="text-white/80 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        aria-label="Back"
      >
        <ArrowLeft className="size-4" />
        Back
      </Button>
      <h1
        ref={headingRef}
        tabIndex={-1}
        aria-live="polite"
        className="text-lg font-semibold text-white focus-visible:outline-none"
      >
        Step {stepOrdinal(step)} of 6 — {TITLES[step]}
      </h1>
    </header>
  );
}
