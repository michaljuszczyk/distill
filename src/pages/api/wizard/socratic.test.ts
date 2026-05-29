import { describe, expect, it, vi } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: "test-key" }));

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
        doStream: () =>
          Promise.resolve({
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "t-1" },
                { type: "text-delta", id: "t-1", delta: '{ "questions": [' },
                { type: "text-delta", id: "t-1", delta: '"q1?", "q2?", "q3?"' },
                { type: "text-delta", id: "t-1", delta: '], "needsFollowUp": false }' },
                { type: "text-end", id: "t-1" },
                {
                  type: "finish",
                  finishReason: "stop",
                  logprobs: undefined,
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                },
              ],
            }),
          }),
      }),
  };
});

// must import after vi.mock
const { POST } = await import("./socratic");

function makeContext(body: unknown, user: { id: string } | null = { id: "u1" }): APIContext {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  return {
    locals: { user },
    request: new Request("https://example.com/api/wizard/socratic", init),
  } as unknown as APIContext;
}

describe("POST /api/wizard/socratic", () => {
  it("401 without session", async () => {
    const res = await POST(makeContext({ description: "x" }, null));
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    const res = await POST(makeContext("not json"));
    expect(res.status).toBe(400);
  });

  it("400 on invalid input (zod fail)", async () => {
    const res = await POST(makeContext({}));
    expect(res.status).toBe(400);
  });

  it("422 when priorAnswers.round2 is present", async () => {
    const res = await POST(
      makeContext({
        description: "x",
        priorAnswers: { round2: [{ question: "q", answer: "a" }] },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("round_cap_exceeded");
  });

  it("200 streaming for valid request", async () => {
    const res = await POST(makeContext({ description: "should I move?" }));
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    const text = await res.text();
    expect(text).toContain("q1?");
    expect(text).toContain("needsFollowUp");
  });
});
