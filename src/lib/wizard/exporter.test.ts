import { describe, expect, it } from "vitest";
import { artifactToFilename, artifactToMarkdown } from "./exporter";
import type { NewDecisionInput } from "@/types";

const SAMPLE: NewDecisionInput = {
  description: "Should I move to Berlin for a new role?\n\nMore context follows.",
  summary: "Move now vs wait a year vs stay.",
  artifact: {
    needs: ["proximity to job", "good schools for kids"],
    criteria: ["total commute under 45 min", "annual cost of living delta within budget"],
    options: ["move now", "wait a year", "stay put"],
    risks: ["kids change school mid-year"],
    open_questions: ["what does spouse think?", "what is the salary delta?"],
  },
  anti_bias_technique: "devils_advocate",
};

describe("artifactToMarkdown", () => {
  it("matches canonical template", () => {
    expect(artifactToMarkdown(SAMPLE)).toMatchInlineSnapshot(`
      "# Decision: Should I move to Berlin for a new role?

      ## Needs
      - proximity to job
      - good schools for kids

      ## Criteria
      - total commute under 45 min
      - annual cost of living delta within budget

      ## Options
      - move now
      - wait a year
      - stay put

      ## Risks
      - kids change school mid-year

      ## Open questions
      - what does spouse think?
      - what is the salary delta?

      ---
      > Summary: Move now vs wait a year vs stay.
      "
    `);
  });

  it("falls back to 'Decision' when description starts with blank lines", () => {
    const md = artifactToMarkdown({ ...SAMPLE, description: "   \n\n\t" });
    expect(md.startsWith("# Decision: Decision\n")).toBe(true);
  });
});

describe("artifactToFilename", () => {
  it("slugifies first non-empty line and appends .md", () => {
    expect(artifactToFilename(SAMPLE)).toBe("should-i-move-to-berlin-for-a-new-role.md");
  });

  it("truncates long descriptions to 60-char slug", () => {
    const long = "a".repeat(80);
    const out = artifactToFilename({ ...SAMPLE, description: long });
    expect(out).toBe(`${"a".repeat(60)}.md`);
  });

  it("collapses punctuation and whitespace", () => {
    const out = artifactToFilename({ ...SAMPLE, description: "  Hello, World!! 🌍 / 2026 " });
    expect(out).toBe("hello-world-2026.md");
  });

  it("falls back to 'decision' for empty description", () => {
    const out = artifactToFilename({ ...SAMPLE, description: "   " });
    expect(out).toBe("decision.md");
  });
});
