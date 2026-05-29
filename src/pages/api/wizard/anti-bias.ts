import type { APIRoute } from "astro";
import { streamObject } from "ai";
import { AntiBiasRequestSchema, AntiBiasResponseSchema, type AntiBiasTechnique } from "@/types";
import { OpenRouterUnconfiguredError, getModel } from "@/lib/openrouter";
import { NonRetryableError, streamWithRetry } from "@/lib/llm-retry";
import * as devilsAdvocate from "@/lib/prompts/anti-bias/devils-advocate";
import * as preMortem from "@/lib/prompts/anti-bias/pre-mortem";
import * as unknownUnknowns from "@/lib/prompts/anti-bias/unknown-unknowns";

export const prerender = false;

interface PromptModule {
  system: () => string;
  user: (payload: Parameters<typeof devilsAdvocate.user>[0]) => string;
}

const PROMPTS: Record<AntiBiasTechnique, PromptModule> = {
  devils_advocate: devilsAdvocate,
  pre_mortem: preMortem,
  unknown_unknowns: unknownUnknowns,
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = AntiBiasRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const promptMod = PROMPTS[parsed.data.technique];

  try {
    const baseModel = getModel();
    return await streamWithRetry((attempt) => {
      const model = attempt.fallback ? getModel({ allowFallbacks: true }) : baseModel;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- streamObject is the supported zod-schema streaming path; the deprecation favors streamText for chat-shaped output which doesn't apply here.
      return streamObject({
        model,
        schema: AntiBiasResponseSchema,
        system: promptMod.system(),
        prompt: promptMod.user({
          description: parsed.data.description,
          socratic: parsed.data.socratic,
          alternatives: parsed.data.alternatives,
        }),
        maxOutputTokens: 1800,
        onError({ error }) {
          console.error("[anti-bias] stream error", error);
        },
      });
    });
  } catch (err) {
    if (err instanceof OpenRouterUnconfiguredError) {
      return json({ error: "openrouter_unconfigured", code: "config" }, 500);
    }
    if (err instanceof NonRetryableError) {
      return json({ error: "llm_unavailable", code: "llm", status: err.status }, 500);
    }
    return json({ error: "llm_unavailable", code: "llm" }, 500);
  }
};
