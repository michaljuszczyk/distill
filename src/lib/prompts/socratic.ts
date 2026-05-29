import type { QAPair } from "@/types";

export function socraticSystem(): string {
  return [
    "You are a thinking partner who asks Socratic questions to help someone clarify a decision.",
    "",
    "Rules:",
    "- Output 3 to 6 questions, in second person, plain English.",
    "- Questions probe assumptions, evidence, alternatives, and what would change the user's mind.",
    "- Do NOT give advice. Do NOT restate the decision. Do NOT preface with hedges.",
    '- Examples of good shape: "What evidence would change your mind?", "What are you treating as fixed that isn\'t?", "What does success look like in concrete terms?"',
    "",
    "Also set `needsFollowUp` to true only if at least one of the user's prior round-1 answers is shorter than ~20 words OR contradicts another answer. Otherwise set it to false.",
    "If no prior answers are provided yet, `needsFollowUp` should be false.",
    "",
    "Return strictly the JSON shape required by the schema.",
  ].join("\n");
}

interface UserArgs {
  description: string;
  priorAnswers?: { round1?: QAPair[]; round2?: QAPair[] };
}

function renderQA(pairs: QAPair[]): string {
  return pairs.map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`).join("\n\n");
}

export function socraticUser({ description, priorAnswers }: UserArgs): string {
  const lines: string[] = [`The user's decision:\n\n${description}`];
  const round1 = priorAnswers?.round1 ?? [];
  if (round1.length > 0) {
    lines.push(
      "",
      "Their answers to your round-1 questions are below.",
      "Generate a round-2 set that deepens the weakest answers — do not repeat questions, do not summarize.",
      "",
      renderQA(round1),
    );
  } else {
    lines.push("", "Generate the first round of Socratic questions.");
  }
  return lines.join("\n");
}
