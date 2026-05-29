import type { Artifact } from "@/types";

interface SectionProps {
  heading: string;
  items?: (string | undefined)[];
}

function ArtifactSection({ heading, items }: SectionProps) {
  const visible = items?.filter((s): s is string => typeof s === "string" && s.trim().length > 0) ?? [];
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold tracking-wider text-white/60 uppercase">{heading}</h2>
      {visible.length === 0 ? (
        <p className="text-xs text-white/40 italic">…</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-white/85">
          {visible.map((item, i) => (
            <li key={i} className="flex gap-2 leading-snug">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-white/40" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ArtifactViewProps {
  title: string;
  summary?: string;
  artifact: Partial<Artifact>;
}

export function ArtifactView({ title, summary, artifact }: ArtifactViewProps) {
  return (
    <article className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-5">
      <header className="space-y-1">
        <h1 className="text-xl leading-snug font-semibold text-white">Decision: {title || "Untitled"}</h1>
        {summary ? <p className="text-sm text-white/70 italic">{summary}</p> : null}
      </header>
      <ArtifactSection heading="Needs" items={artifact.needs} />
      <ArtifactSection heading="Criteria" items={artifact.criteria} />
      <ArtifactSection heading="Options" items={artifact.options} />
      <ArtifactSection heading="Risks" items={artifact.risks} />
      <ArtifactSection heading="Open questions" items={artifact.open_questions} />
    </article>
  );
}
