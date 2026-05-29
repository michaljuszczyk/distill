import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { NewDecisionInputSchema } from "@/types";

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = NewDecisionInputSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "supabase_unconfigured", code: "config" }, 500);

  const { data, error } = await supabase
    .from("decisions")
    .insert({
      user_id: user.id,
      description: parsed.data.description,
      summary: parsed.data.summary,
      artifact: parsed.data.artifact,
      anti_bias_technique: parsed.data.anti_bias_technique,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("[decisions] insert failed", error);
    return json({ error: "insert_failed", code: "db" }, 500);
  }

  return json({ id: data.id }, 201);
};
