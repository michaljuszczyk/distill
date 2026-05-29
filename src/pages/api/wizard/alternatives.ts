import type { APIRoute } from "astro";
import { streamObject } from "ai";
import { AlternativesRequestSchema, AlternativesResponseSchema } from "@/types";
import { OpenRouterUnconfiguredError, getModel } from "@/lib/openrouter";
import { NonRetryableError, streamWithRetry } from "@/lib/llm-retry";
import { alternativesSystem, alternativesUser } from "@/lib/prompts/alternatives";

export const prerender = false;

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

  const parsed = AlternativesRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  try {
    const baseModel = getModel();
    return await streamWithRetry((attempt) => {
      const model = attempt.fallback ? getModel({ allowFallbacks: true }) : baseModel;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- streamObject is the supported zod-schema streaming path; the deprecation favors streamText for chat-shaped output which doesn't apply here.
      return streamObject({
        model,
        schema: AlternativesResponseSchema,
        system: alternativesSystem(),
        prompt: alternativesUser({
          description: parsed.data.description,
          socratic: parsed.data.socratic,
        }),
        maxOutputTokens: 1500,
        onError({ error }) {
          console.error("[alternatives] stream error", error);
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
