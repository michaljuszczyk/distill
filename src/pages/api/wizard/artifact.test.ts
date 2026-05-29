import { describe, expect, it, vi } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: "test-key" }));

const validBody = {
  description: "should I move?",
  socratic: {
    round1: [
      { question: "What changes your mind?", answer: "cost data" },
      { question: "What is fixed?", answer: "kids' school" },
    ],
  },
  alternatives: [
    { title: "Move now", pros: ["closer"], cons: ["disrupt"] },
    { title: "Wait a year", pros: ["stable"], cons: ["commute"] },
    { title: "Stay put", pros: ["no churn"], cons: ["stagnation"] },
  ],
  technique: "devils_advocate" as const,
  antiBiasMarkdown: "## Devil's advocate\n\nYou are overweighting career growth.",
};

const goodChunks = [
  { type: "text-start" as const, id: "t-1" },
  { type: "text-delta" as const, id: "t-1", delta: '{ "needs": ["proximity to job"],' },
  { type: "text-delta" as const, id: "t-1", delta: ' "criteria": ["total commute under 45 min"],' },
  { type: "text-delta" as const, id: "t-1", delta: ' "options": ["move now", "wait a year"],' },
  { type: "text-delta" as const, id: "t-1", delta: ' "risks": ["kids change school mid-year"],' },
  { type: "text-delta" as const, id: "t-1", delta: ' "open_questions": ["what does spouse think?"],' },
  { type: "text-delta" as const, id: "t-1", delta: ' "summary": "Move now vs wait a year." }' },
  { type: "text-end" as const, id: "t-1" },
  {
    type: "finish" as const,
    finishReason: "stop" as const,
    logprobs: undefined,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  },
];

vi.mock("@/lib/openrouter", () => {
  class OpenRouterUnconfiguredError extends Error {}
  return {
    OpenRouterUnconfiguredError,
    MODEL_ID: "mock/model",
    getOpenRouter: () => {
      throw new Error("not used in tests");
    },
    getModel: () =>
      new MockLanguageModelV3({
        doStream: () => Promise.resolve({ stream: simulateReadableStream({ chunks: goodChunks }) }),
      }),
  };
});

const { POST } = await import("./artifact");

function makeContext(body: unknown, user: { id: string } | null = { id: "u1" }): APIContext {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  return {
    locals: { user },
    request: new Request("https://example.com/api/wizard/artifact", init),
  } as unknown as APIContext;
}

describe("POST /api/wizard/artifact", () => {
  it("401 without session", async () => {
    const res = await POST(makeContext(validBody, null));
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    const res = await POST(makeContext("not json"));
    expect(res.status).toBe(400);
  });

  it("400 on missing antiBiasMarkdown", async () => {
    const { antiBiasMarkdown: _md, ...rest } = validBody;
    void _md;
    const res = await POST(makeContext(rest));
    expect(res.status).toBe(400);
  });

  it("400 on out-of-enum technique", async () => {
    const res = await POST(makeContext({ ...validBody, technique: "telepathy" }));
    expect(res.status).toBe(400);
  });

  it("200 streaming for valid request", async () => {
    const res = await POST(makeContext(validBody));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("summary");
    expect(text).toContain("Move now");
  });
});

describe("POST /api/wizard/artifact — openrouter unconfigured", () => {
  it("500 when OPENROUTER_API_KEY missing", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({ OPENROUTER_API_KEY: "test-key" }));
    vi.doMock("@/lib/openrouter", () => {
      class OpenRouterUnconfiguredError extends Error {
        constructor() {
          super("missing");
          this.name = "OpenRouterUnconfiguredError";
        }
      }
      return {
        OpenRouterUnconfiguredError,
        MODEL_ID: "mock/model",
        getOpenRouter: () => {
          throw new OpenRouterUnconfiguredError();
        },
        getModel: () => {
          throw new OpenRouterUnconfiguredError();
        },
      };
    });
    const mod = await import("./artifact");
    const res = await mod.POST(makeContext(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("config");
    vi.resetModules();
  });
});
