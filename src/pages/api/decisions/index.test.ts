import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }));

const validBody = {
  description: "should I move?",
  summary: "Move now vs wait a year.",
  artifact: {
    needs: ["proximity to job"],
    criteria: ["total commute under 45 min"],
    options: ["move now", "wait a year"],
    risks: ["kids change school mid-year"],
    open_questions: ["what does spouse think?"],
  },
  anti_bias_technique: "devils_advocate" as const,
};

interface MockBuilder {
  single: () => Promise<{ data: { id: string } | null; error: unknown }>;
  select: (cols: string) => MockBuilder;
  insert: (row: unknown) => MockBuilder;
}

function builderOk(): MockBuilder {
  const b: MockBuilder = {
    insert: () => b,
    select: () => b,
    single: () => Promise.resolve({ data: { id: "dec-1" }, error: null }),
  };
  return b;
}

function builderFail(): MockBuilder {
  const b: MockBuilder = {
    insert: () => b,
    select: () => b,
    single: () => Promise.resolve({ data: null, error: { message: "rls denied" } }),
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ from: () => builderOk() }),
}));

const { POST } = await import("./index");

function makeContext(body: unknown, user: { id: string } | null = { id: "u1" }): APIContext {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  return {
    locals: { user },
    request: new Request("https://example.com/api/decisions", init),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("POST /api/decisions", () => {
  it("401 without session", async () => {
    const res = await POST(makeContext(validBody, null));
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    const res = await POST(makeContext("not json"));
    expect(res.status).toBe(400);
  });

  it("400 on missing artifact section", async () => {
    const broken = { ...validBody, artifact: { ...validBody.artifact, needs: [] } };
    const res = await POST(makeContext(broken));
    expect(res.status).toBe(400);
  });

  it("400 on out-of-enum technique", async () => {
    const res = await POST(makeContext({ ...validBody, anti_bias_technique: "magic" }));
    expect(res.status).toBe(400);
  });

  it("201 with id for valid payload", async () => {
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("dec-1");
  });
});

describe("POST /api/decisions — insert failure", () => {
  it("500 when supabase insert errors", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "k" }));
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => ({ from: () => builderFail() }),
    }));
    const mod = await import("./index");
    const res = await mod.POST(makeContext(validBody));
    expect(res.status).toBe(500);
    vi.resetModules();
  });
});

describe("POST /api/decisions — supabase unconfigured", () => {
  it("500 when createClient returns null", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: "", SUPABASE_KEY: "" }));
    vi.doMock("@/lib/supabase", () => ({
      createClient: () => null,
    }));
    const mod = await import("./index");
    const res = await mod.POST(makeContext(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("config");
    vi.resetModules();
  });
});
