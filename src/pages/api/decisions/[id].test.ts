import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }));

interface MockBuilder {
  update: (row: unknown) => MockBuilder;
  delete: () => MockBuilder;
  eq: (col: string, val: string) => MockBuilder;
  select: (cols: string) => MockBuilder;
  maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }>;
}

function builder(result: { data: { id: string } | null; error: unknown }): MockBuilder {
  const b: MockBuilder = {
    update: () => b,
    delete: () => b,
    eq: () => b,
    select: () => b,
    maybeSingle: () => Promise.resolve(result),
  };
  return b;
}

// Records the row handed to .update() so a test can assert what was persisted.
function capturingBuilder(captured: { value?: unknown }): MockBuilder {
  const b: MockBuilder = {
    update: (row) => {
      captured.value = row;
      return b;
    },
    delete: () => b,
    eq: () => b,
    select: () => b,
    maybeSingle: () => Promise.resolve({ data: { id: "dec-1" }, error: null }),
  };
  return b;
}

// Default: the row exists and is owned (RLS lets it through).
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ from: () => builder({ data: { id: "dec-1" }, error: null }) }),
}));

const { PATCH, DELETE } = await import("./[id]");

function ctx(
  method: string,
  body?: unknown,
  user: { id: string } | null = { id: "u1" },
  id: string | undefined = "dec-1",
): APIContext {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return {
    locals: { user },
    params: { id },
    request: new Request("https://example.com/api/decisions/dec-1", init),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("PATCH /api/decisions/[id]", () => {
  it("401 without session", async () => {
    expect((await PATCH(ctx("PATCH", { note: "x" }, null))).status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    expect((await PATCH(ctx("PATCH", "not json"))).status).toBe(400);
  });

  it("400 when no editable field is provided", async () => {
    expect((await PATCH(ctx("PATCH", {}))).status).toBe(400);
  });

  it("400 when title exceeds the max length", async () => {
    expect((await PATCH(ctx("PATCH", { title: "x".repeat(201) }))).status).toBe(400);
  });

  it("400 when note exceeds the max length", async () => {
    expect((await PATCH(ctx("PATCH", { note: "x".repeat(2001) }))).status).toBe(400);
  });

  it("400 when the id param is missing", async () => {
    const c = ctx("PATCH", { note: "x" });
    (c as unknown as { params: Record<string, string> }).params = {};
    expect((await PATCH(c)).status).toBe(400);
  });

  it("200 clearing a field with an empty string", async () => {
    expect((await PATCH(ctx("PATCH", { title: "" }))).status).toBe(200);
  });

  it("200 updating the note (owner)", async () => {
    const res = await PATCH(ctx("PATCH", { note: "went with option B" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe("dec-1");
  });

  it("200 updating the title (owner)", async () => {
    expect((await PATCH(ctx("PATCH", { title: "House move" }))).status).toBe(200);
  });
});

describe("DELETE /api/decisions/[id]", () => {
  it("401 without session", async () => {
    expect((await DELETE(ctx("DELETE", undefined, null))).status).toBe(401);
  });

  it("200 deleting own decision", async () => {
    expect((await DELETE(ctx("DELETE"))).status).toBe(200);
  });

  it("400 when the id param is missing", async () => {
    const c = ctx("DELETE");
    (c as unknown as { params: Record<string, string> }).params = {};
    expect((await DELETE(c)).status).toBe(400);
  });
});

describe("PATCH /api/decisions/[id] — persistence", () => {
  it("trims title/note before writing them", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }));
    const captured: { value?: unknown } = {};
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ from: () => capturingBuilder(captured) }),
    }));
    const mod = await import("./[id]");
    await mod.PATCH(ctx("PATCH", { title: "  House move  ", note: "  went with B  " }));
    expect(captured.value).toEqual({ title: "House move", note: "went with B" });
    vi.resetModules();
  });
});

describe("/api/decisions/[id] — supabase unconfigured", () => {
  it("PATCH 500 with config code when createClient returns null", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "", SUPABASE_KEY: "" }));
    vi.doMock("@/lib/supabase", () => ({ createClient: () => null }));
    const mod = await import("./[id]");
    const res = await mod.PATCH(ctx("PATCH", { note: "x" }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe("config");
    vi.resetModules();
  });

  it("DELETE 500 with config code when createClient returns null", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "", SUPABASE_KEY: "" }));
    vi.doMock("@/lib/supabase", () => ({ createClient: () => null }));
    const mod = await import("./[id]");
    const res = await mod.DELETE(ctx("DELETE"));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe("config");
    vi.resetModules();
  });
});

describe("/api/decisions/[id] — cross-user / missing row yields 404 (RLS = 0 rows)", () => {
  it("PATCH 404 when no owned row matches", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }));
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ from: () => builder({ data: null, error: null }) }),
    }));
    const mod = await import("./[id]");
    expect((await mod.PATCH(ctx("PATCH", { note: "x" }))).status).toBe(404);
    vi.resetModules();
  });

  it("DELETE 404 when no owned row matches", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }));
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ from: () => builder({ data: null, error: null }) }),
    }));
    const mod = await import("./[id]");
    expect((await mod.DELETE(ctx("DELETE"))).status).toBe(404);
    vi.resetModules();
  });
});
