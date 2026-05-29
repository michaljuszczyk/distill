import type { Alternative, SocraticPayload } from "@/types";

interface Payload {
  description: string;
  socratic: SocraticPayload;
  alternatives: Alternative[];
}

export function system(): string {
  return [
    "You run a pre-mortem (Gary Klein) on the user's apparent decision.",
    "",
    "Rules:",
    "- Write in PAST TENSE, as though 12 months from now the decision has already failed. 'It failed because…', 'we discovered that…'. Never present tense, never 'could fail'.",
    "- The failure story must be plausible and anchored to specifics from the user's description and Q&A. Do NOT invent unrelated risks.",
    "",
    "OUTPUT FORMAT (the `markdown` field is a single long markdown string — do NOT stop after the heading):",
    "1. Line 1: `## Pre-mortem`",
    "2. Line 2: one orienting sentence in past tense (10-25 words).",
    "3. Then 3-5 `###` subsections. Each subsection has a short title naming a distinct failure mode and 2-4 sentences in past tense explaining what went wrong and why. Blank lines between subsections.",
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
  blocks.push("", "Alternatives considered:", renderAlternatives(alternatives));
  blocks.push("", "Twelve months have passed. The decision failed. Tell the failure story in past tense.");
  return blocks.join("\n");
}
