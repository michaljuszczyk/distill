import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { UpdateDecisionInputSchema } from "@/types";

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Edit a decision's user-owned metadata. Only title/note are mutable — the AI
// artifact is an immutable record, so it (and summary/description/technique) is
// never written here. RLS scopes the row to the owner; a non-owner / missing id
// matches zero rows and surfaces as 404.
export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const id = context.params.id;
  if (!id) return json({ error: "missing_id" }, 400);

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = UpdateDecisionInputSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const patch: { title?: string; note?: string } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "supabase_unconfigured", code: "config" }, 500);

  const { data, error } = await supabase
    .from("decisions")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[decisions] update failed", error);
    return json({ error: "update_failed", code: "db" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);

  return json({ id: data.id }, 200);
};

// Discard a decision. Immutability means the record can't be altered, not that
// the user is stuck with it. RLS restricts deletion to the owner.
export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const id = context.params.id;
  if (!id) return json({ error: "missing_id" }, 400);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "supabase_unconfigured", code: "config" }, 500);

  const { data, error } = await supabase
    .from("decisions")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[decisions] delete failed", error);
    return json({ error: "delete_failed", code: "db" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);

  return json({ id: data.id }, 200);
};
