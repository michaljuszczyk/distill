import type { Decision } from "@/types";
import { ArtifactView } from "./ArtifactView";
import { ExportActions } from "./ExportActions";

interface DecisionDetailProps {
  title: string;
  decision: Decision;
}

export function DecisionDetail({ title, decision }: DecisionDetailProps) {
  return (
    <div className="space-y-5">
      <ArtifactView title={title} summary={decision.summary} artifact={decision.artifact} />
      <div className="flex justify-end rounded-lg border border-white/10 bg-white/5 p-3">
        <ExportActions input={decision} />
      </div>
    </div>
  );
}
