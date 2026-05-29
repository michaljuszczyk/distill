import type { APIRoute } from "astro";
import { streamObject } from "ai";
import { SocraticRequestSchema, SocraticResponseSchema } from "@/types";
import { OpenRouterUnconfiguredError, getModel } from "@/lib/openrouter";
import { socraticSystem, socraticUser } from "@/lib/prompts/socratic";

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

  const parsed = SocraticRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  if (parsed.data.priorAnswers?.round2) {
    return json({ error: "round_cap_exceeded" }, 422);
  }

  try {
    const model = getModel();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- streamObject is the supported zod-schema streaming path; the deprecation favors streamText for chat-shaped output which doesn't apply here.
    const result = streamObject({
      model,
      schema: SocraticResponseSchema,
      system: socraticSystem(),
      prompt: socraticUser({
        description: parsed.data.description,
        priorAnswers: parsed.data.priorAnswers,
      }),
      onError({ error }) {
        console.error("[socratic] stream error", error);
      },
    });
    return result.toTextStreamResponse();
  } catch (err) {
    if (err instanceof OpenRouterUnconfiguredError) {
      return json({ error: "openrouter_unconfigured", code: "config" }, 500);
    }
    return json({ error: "llm_unavailable", code: "llm" }, 500);
  }
};
