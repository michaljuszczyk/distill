import type { Alternative, SocraticPayload } from "@/types";

interface Payload {
  description: string;
  socratic: SocraticPayload;
  alternatives: Alternative[];
}

export function system(): string {
  return [
    "You surface hidden assumptions and unasked questions using the Rumsfeld matrix.",
    "",
    "Rules:",
    "- This is NOT a risk list. Do not enumerate generic risks. Surface ASSUMPTIONS the user appears to be making and QUESTIONS they have not asked themselves.",
    "- Anchor every item to specifics the user provided. Generic 'have you considered competition?' is forbidden — name the specific blind spot.",
    "",
    "OUTPUT FORMAT (the `markdown` field is a single long markdown string — do NOT stop after the heading):",
    "1. Line 1: `## Unknown unknowns`",
    "2. Line 2: one orienting sentence (10-25 words).",
    "3. Then 3-5 `###` subsections. Each subsection has a short title naming a hidden assumption or unasked question and 2-4 sentences explaining why this is invisible to the user and what would surface it. Blank lines between subsections.",
    "4. Final line, on its own line: `If you still want to proceed, here is what changed: ___.`",
    "",
    "TOTAL LENGTH: roughly 250-500 words. A bare heading is a FAILURE. Always include every subsection and the closing line before stopping.",
    "",
    "CRITICAL: the JSON `markdown` value MUST contain real newline escapes (`\\n` in the JSON string) between every section. NEVER concatenate sections onto a single line. Every `##` and `###` heading must be preceded by a blank line (two `\\n`) and followed by a newline before the body text.",
    "",
    "Return `{ markdown: <string> }` matching the schema.",
  ].join("\n");
}

function renderQA(pairs: { question: string; answer: string }[]): string {
  return pairs.map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`).join("\n\n");
}

function renderAlternatives(alts: Alternative[]): string {
  return alts
    .map((a, i) => `Alt ${i + 1}: ${a.title}\n  pros: ${a.pros.join("; ")}\n  cons: ${a.cons.join("; ")}`)
    .join("\n\n");
}

export function user({ description, socratic, alternatives }: Payload): string {
  const blocks: string[] = [`The user's decision:\n\n${description}`, "", "Round 1 Q&A:", renderQA(socratic.round1)];
  if (socratic.round2 && socratic.round2.length > 0) {
    blocks.push("", "Round 2 Q&A:", renderQA(socratic.round2));
  }
  blocks.push("", "Alternatives on the table:", renderAlternatives(alternatives));
  blocks.push("", "Identify the hidden assumptions and unasked questions specific to this decision.");
  return blocks.join("\n");
}
