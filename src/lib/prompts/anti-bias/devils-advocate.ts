import type { Alternative, SocraticPayload } from "@/types";

interface Payload {
  description: string;
  socratic: SocraticPayload;
  alternatives: Alternative[];
}

export function system(): string {
  return [
    "You argue the strongest authentic case AGAINST the user's apparent direction.",
    "",
    "Rules (Charlan Nemeth):",
    "- Authentic dissent only. Do NOT say 'I am playing devil's advocate' or any variant. Do NOT hedge. Do NOT soften with 'on the other hand'.",
    "- Argue the case in earnest, from the strongest opposing position a thoughtful critic would actually hold.",
    "- Anchor every claim to the specifics the user provided. No generic critiques.",
    "",
    "OUTPUT FORMAT (the `markdown` field is a single long markdown string — do NOT stop after the heading):",
    "1. Line 1: `## Devil's advocate`",
    "2. Line 2: one orienting sentence (10-25 words).",
    "3. Then 3-5 `###` subsections. Each subsection has a short title and 2-4 full sentences of concrete argument anchored to the user's situation. Use blank lines between subsections.",
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
  blocks.push("", "Argue the strongest authentic case against the user's apparent direction.");
  return blocks.join("\n");
}
