import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WizardError } from "./types";

interface Props {
  error: WizardError | null;
  onRetry?: () => void;
}

function copyFor(error: WizardError): string {
  switch (error.kind) {
    case "llm":
      return "The AI service is having trouble. Try again?";
    case "network":
      return "Connection lost — try again";
    case "validation":
      return error.message;
  }
}

export function ErrorBanner({ error, onRetry }: Props) {
  if (!error) return null;
  return (
    <div
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-200"
    >
      <span className="flex items-center gap-2">
        <CircleAlert className="size-4 shrink-0" />
        {copyFor(error)}
      </span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} className="border-red-300/40 bg-transparent text-red-100">
          <RotateCw className="size-3" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
