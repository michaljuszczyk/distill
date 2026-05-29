import type { Alternative, AntiBiasTechnique, SocraticPayload } from "@/types";

interface Payload {
  description: string;
  socratic: SocraticPayload;
  alternatives: Alternative[];
  technique: AntiBiasTechnique;
  antiBiasMarkdown: string;
}

const TECHNIQUE_LABEL: Record<AntiBiasTechnique, string> = {
  devils_advocate: "Devil's advocate",
  pre_mortem: "Pre-mortem",
  unknown_unknowns: "Unknown unknowns",
};

export function artifactSystem(): string {
  return [
    "You synthesise a structured decision artifact from the user's description, their Socratic Q&A, the alternatives on the table, and the anti-bias output they just read.",
    "",
    "Rules:",
    "- Produce 5 arrays AND a `summary`:",
    "  - `needs`: what the user needs from the chosen direction. 2-5 items.",
    "  - `criteria`: the criteria by which a good outcome would be judged. 2-5 items.",
    "  - `options`: short labels for the realistic options, drawn from the alternatives + any sharper variants the Q&A surfaced. 2-5 items.",
    "  - `risks`: concrete risks anchored to the user's situation (not generic). 2-5 items.",
    "  - `open_questions`: questions the user still needs to answer before committing. 2-5 items.",
    "- Every array item is a single short sentence. No bullet markers, no leading dashes. Concrete, not abstract.",
    "- Each array has AT LEAST 1 item. Prefer 3.",
    "- `summary`: 1-2 sentences capturing the decision and its current shape. Neutral tone. No recommendation.",
    "- Anchor every item to what the user actually said. Do not invent facts.",
    "- Do NOT recommend an option. Do NOT moralize. Do NOT add commentary outside the schema.",
    "",
    "Return strictly the JSON shape required by the schema.",
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

export function artifactUser({ description, socratic, alternatives, technique, antiBiasMarkdown }: Payload): string {
  const blocks: string[] = [`The user's decision:\n\n${description}`, "", "Round 1 Q&A:", renderQA(socratic.round1)];
  if (socratic.round2 && socratic.round2.length > 0) {
    blocks.push("", "Round 2 Q&A:", renderQA(socratic.round2));
  }
  blocks.push("", "Alternatives on the table:", renderAlternatives(alternatives));
  blocks.push("", `Anti-bias output (${TECHNIQUE_LABEL[technique]}):`, antiBiasMarkdown);
  blocks.push(
    "",
    "Synthesise the structured artifact. Anchor every item to specifics from the inputs above. Do not recommend an option.",
  );
  return blocks.join("\n");
}
