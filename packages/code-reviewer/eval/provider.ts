// promptfoo custom provider — wraps the real review agent so evals exercise the
// exact same system prompt + schema as production. The model is injected per
// provider entry in promptfooconfig.yaml, which is how we compare models.
//
// The provider reads the diff file itself (resolved relative to this file) rather
// than receiving the diff through the prompt. Diffs contain JSX `{{ ... }}` which
// would otherwise collide with promptfoo's Nunjucks templating. Only the diff
// FILENAME flows through the template — no braces, no collision.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { reviewDiff } from "../review.ts";

interface CallContext {
  vars?: Record<string, unknown>;
}

export default class CodeReviewProvider {
  private readonly modelId: string;

  constructor(options: { config?: { model?: string } } = {}) {
    this.modelId = options.config?.model ?? "z-ai/glm-5.1";
  }

  id(): string {
    return `code-reviewer:${this.modelId}`;
  }

  async callApi(prompt: string, context?: CallContext): Promise<{ output?: string; error?: string }> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { error: "OPENROUTER_API_KEY is not set" };

    const diffFile = ((context?.vars?.diffFile as string | undefined) ?? prompt).trim();
    try {
      const diffPath = fileURLToPath(new URL(`./${diffFile}`, import.meta.url));
      const diff = await readFile(diffPath, "utf8");
      const review = await reviewDiff(diff, { apiKey, modelId: this.modelId });
      return { output: JSON.stringify(review) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
