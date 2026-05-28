import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { PendingButton } from "../PendingButton";
import { useWizard } from "../context";
import { canAdvance } from "../reducer";

export function DescribeStep() {
  const { state, dispatch } = useWizard();
  const [touched, setTouched] = useState(false);
  const empty = state.data.description.trim().length === 0;
  const showError = touched && empty;

  function handleContinue() {
    if (empty) {
      setTouched(true);
      return;
    }
    dispatch({ type: "GO_TO", step: "socratic-1" });
  }

  return (
    <section className="space-y-4">
      <label htmlFor="describe" className="block text-sm text-blue-100/80">
        Describe the decision you&apos;re facing. A paragraph or two is plenty.
      </label>
      <Textarea
        id="describe"
        value={state.data.description}
        onChange={(e) => {
          dispatch({ type: "SET_DESCRIPTION", value: e.target.value });
        }}
        placeholder="What's on your mind?"
        rows={8}
        className={`bg-white/5 text-white placeholder:text-white/40 ${
          showError ? "border-red-400/60 focus-visible:ring-red-400" : "border-white/20"
        }`}
      />
      {showError ? <p className="text-xs text-red-300">Please describe the decision before continuing.</p> : null}
      <div className="flex justify-end">
        <PendingButton
          pending={state.pending}
          onClick={handleContinue}
          icon={<ArrowRight className="size-4" />}
          disabled={touched && !canAdvance(state)}
        >
          Continue
        </PendingButton>
      </div>
    </section>
  );
}
