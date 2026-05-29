import type { NewDecisionInput } from "@/types";

export function firstNonEmptyLine(input: string): string {
  const lines = input.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function renderSection(heading: string, items: string[]): string {
  const body = items.map((it) => `- ${it.trim()}`).join("\n");
  return `## ${heading}\n${body}`;
}

export function artifactToMarkdown(input: NewDecisionInput): string {
  const title = firstNonEmptyLine(input.description) || "Decision";
  const { artifact, summary } = input;
  const sections = [
    `# Decision: ${title}`,
    renderSection("Needs", artifact.needs),
    renderSection("Criteria", artifact.criteria),
    renderSection("Options", artifact.options),
    renderSection("Risks", artifact.risks),
    renderSection("Open questions", artifact.open_questions),
    `---\n> Summary: ${summary.trim()}`,
  ];
  return sections.join("\n\n") + "\n";
}

export function artifactToFilename(input: NewDecisionInput): string {
  const source = firstNonEmptyLine(input.description) || "decision";
  const slug = source
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "decision"}.md`;
}
