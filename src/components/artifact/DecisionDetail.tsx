import { useState } from "react";
import type { Decision } from "@/types";
import { ArtifactView } from "./ArtifactView";
import { ExportActions } from "./ExportActions";

interface DecisionDetailProps {
  title: string;
  decision: Decision;
}

export function DecisionDetail({ title, decision }: DecisionDetailProps) {
  const [titleValue, setTitleValue] = useState(decision.title);
  const [note, setNote] = useState(decision.note);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [deleting, setDeleting] = useState(false);

  const dirty = titleValue !== decision.title || note !== decision.note;

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch(`/api/decisions/${decision.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: titleValue, note }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Reload so the heading + list reflect the new title.
      window.location.reload();
    } catch {
      setStatus("error");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this decision? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/decisions/${decision.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      window.location.href = "/dashboard";
    } catch {
      setDeleting(false);
      setStatus("error");
    }
  }

  return (
    <div className="space-y-5">
      <ArtifactView title={title} summary={decision.summary} artifact={decision.artifact} />

      <section className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="space-y-1.5">
          <label htmlFor="decision-title" className="block text-sm font-medium text-white/80">
            Title
          </label>
          <input
            id="decision-title"
            type="text"
            value={titleValue}
            maxLength={200}
            placeholder="Name this decision"
            onChange={(e) => {
              setTitleValue(e.target.value);
              setStatus("idle");
            }}
            className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="decision-note" className="block text-sm font-medium text-white/80">
            Outcome / notes
          </label>
          <textarea
            id="decision-note"
            value={note}
            maxLength={2000}
            rows={3}
            placeholder="What did you decide? How did it turn out?"
            onChange={(e) => {
              setNote(e.target.value);
              setStatus("idle");
            }}
            className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete decision"}
          </button>
          <div className="flex items-center gap-3">
            {status === "error" ? <span className="text-sm text-rose-300">Something went wrong</span> : null}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || status === "saving"}
              className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </section>

      <div className="flex justify-end rounded-lg border border-white/10 bg-white/5 p-3">
        <ExportActions input={decision} />
      </div>
    </div>
  );
}
