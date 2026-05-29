import { createOpenRouter, type OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { LanguageModel } from "ai";

export const MODEL_ID = "deepseek/deepseek-v4-flash" as const;

export class OpenRouterUnconfiguredError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not set");
    this.name = "OpenRouterUnconfiguredError";
  }
}

let cached: OpenRouterProvider | null = null;

export function getOpenRouter(): OpenRouterProvider {
  if (!OPENROUTER_API_KEY) throw new OpenRouterUnconfiguredError();
  cached ??= createOpenRouter({ apiKey: OPENROUTER_API_KEY });
  return cached;
}

interface ModelOpts {
  allowFallbacks?: boolean;
}

export function getModel(opts: ModelOpts = {}): LanguageModel {
  const or = getOpenRouter();
  const settings: Parameters<OpenRouterProvider>[1] = {};
  if (opts.allowFallbacks) settings.provider = { allow_fallbacks: true };
  return or(MODEL_ID, Object.keys(settings).length ? settings : undefined);
}
