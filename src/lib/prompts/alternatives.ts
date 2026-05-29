import type { SocraticPayload } from "@/types";

export function alternativesSystem(): string {
  return [
    "You generate alternatives for a decision.",
    "",
    "Rules:",
    "- Produce exactly 3 alternatives spanning DISTINCT strategic axes (e.g. proceed, change scope, do nothing). If the decision admits a status-quo / do-nothing option, include it as one of the three.",
    "- Each alternative has a short noun-phrase `title` (no leading verbs like 'choose…').",
    "- Each has 2-4 `pros` and 2-4 `cons` stated as concrete CONSEQUENCES, not abstractions. Avoid generic phrases like 'increases risk' — name the specific risk.",
    "- Pros and cons are single short sentences, second person where natural.",
    "- Do NOT recommend one option over another. Do NOT add commentary outside the schema.",
    "",
    "Return strictly the JSON shape required by the schema.",
  ].join("\n");
}

interface UserArgs {
  description: string;
  socratic: SocraticPayload;
}

function renderRound(label: string, pairs: { question: string; answer: string }[]): string {
  return [`${label}:`, ...pairs.map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`)].join("\n");
}

export function alternativesUser({ description, socratic }: UserArgs): string {
  const blocks: string[] = [`The user's decision:\n\n${description}`, "", renderRound("Round 1 Q&A", socratic.round1)];
  if (socratic.round2 && socratic.round2.length > 0) {
    blocks.push("", renderRound("Round 2 Q&A", socratic.round2));
  }
  blocks.push(
    "",
    "Generate 3 alternatives covering distinct strategic axes. Anchor pros/cons to what the user actually said.",
  );
  return blocks.join("\n");
}
