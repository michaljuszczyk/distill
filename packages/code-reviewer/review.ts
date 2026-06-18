import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Output, ToolLoopAgent, stepCountIs } from "ai";
import { reviewSchema } from "./schema.ts";

const MODEL_ID = "deepseek/deepseek-v4-flash";

const SYSTEM = `You are a senior code reviewer. You receive a unified git diff and
return a structured review. Score each criterion 1-10 per its description, set a
binding pass/fail verdict, and write a short markdown summary. Be specific and
reference files/lines from the diff. Do not invent code that is not in the diff.`;

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

  const openrouter = createOpenRouter({ apiKey });

  const agent = new ToolLoopAgent({
    model: openrouter(MODEL_ID),
    instructions: SYSTEM,
    tools: {},
    stopWhen: stepCountIs(2),
    output: Output.object({ schema: reviewSchema }),
  });

  const result = await agent.generate({
    prompt: `Review this git diff:\n\n${diff}`,
  });

  process.stdout.write(JSON.stringify(result.output, null, 2) + "\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
