import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { artifactToFilename, artifactToMarkdown } from "@/lib/wizard/exporter";
import type { NewDecisionInput } from "@/types";

interface ExportActionsProps {
  input: NewDecisionInput;
}

export function ExportActions({ input }: ExportActionsProps) {
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function copy() {
    const md = artifactToMarkdown(input);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setExportError(null);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setExportError("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  function download() {
    try {
      const md = artifactToMarkdown(input);
      const filename = artifactToFilename(input);
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportError(null);
    } catch {
      setExportError("Couldn't download — your browser blocked the file.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            void copy();
          }}
          className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          onClick={download}
          className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          <Download className="size-4" />
          Download
        </Button>
      </div>
      {exportError ? (
        <p role="status" aria-live="polite" className="text-xs text-rose-300">
          {exportError}
        </p>
      ) : null}
    </div>
  );
}
