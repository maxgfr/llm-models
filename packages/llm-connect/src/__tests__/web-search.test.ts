// The provider's own web search, declared after the function tools, and Anthropic's encrypted
// results replayed unchanged on the next turn.
import { beforeEach, describe, expect, it } from "bun:test";
import { type ModelMessage, streamText } from "ai";
import { callOptions } from "../call.js";
import { resolveCapabilities } from "../capabilities.js";
import { loadModel } from "../model.js";
import { clearProviders } from "../registry.js";
import type { LlmSettings } from "../settings.js";
import { webSearchTools } from "../web-search.js";
import { serveFixture } from "./sse.js";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

type Block = { type: string; [key: string]: unknown };

const settingsOf = (npm: string, model: string): LlmSettings => ({
  apiKey: "sk-test",
  model,
  providerNpm: npm,
});

async function send(settings: LlmSettings, file: string, messages: ModelMessage[]) {
  const served = await serveFixture(file);
  const model = await loadModel(settings, { fetch: served.fetch });
  const kind = settings.providerNpm?.replace("@ai-sdk/", "") ?? "openai";
  const caps = resolveCapabilities({ kind, modelId: settings.model, catalog: { toolCall: true } });
  const result = streamText({
    model,
    messages,
    maxRetries: 0,
    tools: await webSearchTools(caps.webSearch),
    ...callOptions(settings, { capabilities: caps }),
    onError: () => {},
  });
  const sources: { url: string; title?: string }[] = [];
  for await (const part of result.fullStream)
    if (part.type === "source" && part.sourceType === "url")
      sources.push({ url: part.url, title: part.title });
  return { served, result, sources, body: served.calls[0].body };
}

beforeEach(() => clearProviders());

describe("webSearchTools", () => {
  it("Claude Opus 5.5 gets the dynamic-filtering search, capped at 5 uses", async () => {
    const { body } = await send(
      settingsOf("@ai-sdk/anthropic", "claude-opus-5-5"),
      "anthropic-text.sse",
      [{ role: "user", content: "Hi" }],
    );
    expect(body.tools).toEqual([
      expect.objectContaining({ type: "web_search_20260209", name: "web_search", max_uses: 5 }),
    ]);
  });

  it("Claude Haiku 5.5 gets the basic search", async () => {
    const { body } = await send(
      settingsOf("@ai-sdk/anthropic", "claude-haiku-5-5"),
      "anthropic-text.sse",
      [{ role: "user", content: "Hi" }],
    );
    expect(body.tools).toEqual([
      expect.objectContaining({ type: "web_search_20250305", name: "web_search" }),
    ]);
  });

  it("OpenAI and Gemini get their own search", async () => {
    const openai = await send(
      { ...settingsOf("@ai-sdk/openai", "gpt-5.1"), providerApi: "https://api.openai.com/v1" },
      "openai-tool-call.sse",
      [{ role: "user", content: "Hi" }],
    );
    expect(openai.body.tools).toEqual([expect.objectContaining({ type: "web_search" })]);
    const gemini = await send(settingsOf("@ai-sdk/google", "gemini-3-flash"), "gemini-text.sse", [
      { role: "user", content: "Hi" },
    ]);
    expect(gemini.body.tools).toEqual([{ googleSearch: {} }]);
  });

  it("a model without one gets nothing", async () => {
    expect(await webSearchTools(null)).toEqual({});
  });

  it("an Anthropic search is replayed with its encrypted results on the next turn", async () => {
    const settings = settingsOf("@ai-sdk/anthropic", "claude-opus-5-5");
    const question: ModelMessage = { role: "user", content: "How many people live in Paris?" };
    const first = await send(settings, "anthropic-web-search.sse", [question]);
    expect(first.sources).toEqual([
      { url: "https://stats.example.org/paris", title: "Paris - Population statistics" },
      { url: "https://region.example.net/figures", title: "Île-de-France in figures" },
    ]);
    const { messages } = await first.result.response;
    const second = await send(settings, "anthropic-text.sse", [
      question,
      ...messages,
      { role: "user", content: "And in the region?" },
    ]);
    const turns = second.body.messages as { role: string; content: Block[] }[];
    const blocks = turns[1].content;
    expect(blocks[0]).toMatchObject({
      type: "server_tool_use",
      id: "srvtoolu_01Ab3Cd5Ef7Gh9Jk2Lm4Np6Q",
      name: "web_search",
      input: { query: "Paris population 2026" },
    });
    expect(blocks[1].type).toBe("web_search_tool_result");
    const results = blocks[1].content as Block[];
    expect(results.map((r) => r.encrypted_content)).toEqual([
      "EqgfCioIARgBIiQ3YTg5ZjUxNy1lODBkLTRiNzMtYjM2Yi0xZWE2NjE1ZDE0ZTMSDBKpbQ1fYy8kVw6xbhoMN0b8QVwz",
      "Eo0HCioIARgBIiQ3YTg5ZjUxNy1lODBkLTRiNzMtYjM2Yi0xZWE2NjE1ZDE0ZTMSDCYb5N7R3cWdOq2w2RoMh9KzVwq1",
    ]);
    expect(blocks.at(-1)).toMatchObject({ type: "text" });
  });
});
