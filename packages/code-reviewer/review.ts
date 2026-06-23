import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, ToolLoopAgent, stepCountIs } from "ai";
import { fileURLToPath } from "node:url";
import { reviewSchema, type Review } from "./schema.ts";

// Chosen via the promptfoo eval in ./eval — glm-5.1 was the only model to catch
// all planted flaws (incl. the subtle React-19 defaultProps case) without
// false-alarming on clean code; the deepseek/gpt Pro variants missed it.
export const DEFAULT_MODEL_ID = "z-ai/glm-5.1";

export const SYSTEM = `You are a senior code reviewer. You receive a unified git diff and
return a structured review. Score each criterion 1-10 per its description, set a
binding pass/fail verdict, and write a short markdown summary. Be specific and
reference files/lines from the diff. Do not invent code that is not in the diff.`;

// Core review. Pure of stdin/env so the eval harness can call it per-model.
export async function reviewDiff(diff: string, opts: { apiKey: string; modelId?: string }): Promise<Review> {
  const openrouter = createOpenRouter({ apiKey: opts.apiKey });

  const agent = new ToolLoopAgent({
    model: openrouter(opts.modelId ?? DEFAULT_MODEL_ID),
    instructions: SYSTEM,
    tools: {},
    stopWhen: stepCountIs(2),
    output: Output.object({ schema: reviewSchema }),
  });

  const result = await agent.generate({
    prompt: `Review this git diff:\n\n${diff}`,
  });

  return result.output;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set — model will stay silent. Export it and retry.");
    process.exit(1);
  }

  const diff = (await readStdin()).trim();
  if (!diff) {
    console.error("No diff on stdin. Usage: git diff | npx tsx packages/code-reviewer/review.ts");
    process.exit(1);
  }

  const review = await reviewDiff(diff, { apiKey });
  process.stdout.write(JSON.stringify(review, null, 2) + "\n");
}

// Only run the CLI when executed directly — importing this module (e.g. from the
// eval provider) must not consume stdin or exit the process.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
