import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setCacheEnabled } from "../cache";
import { createMcpServer } from "../mcp";

const originalFetch = globalThis.fetch;
let client: Client;

const openRouter = {
  data: [
    {
      id: "openai/gpt-4o",
      canonical_slug: "openai/gpt-4o",
      name: "GPT-4o",
      description: "Test",
      created: 1715558400,
      context_length: 128000,
      supported_parameters: ["tools"],
      architecture: {
        modality: "text->text",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        tokenizer: "GPT",
      },
      pricing: { prompt: "0.0000025", completion: "0.00001" },
      top_provider: { context_length: 128000, max_completion_tokens: 16384, is_moderated: false },
      links: { details: "/test" },
    },
  ],
};

const modelsDev = {
  openai: {
    id: "openai",
    name: "OpenAI",
    doc: "https://platform.openai.com/docs",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        attachment: true,
        reasoning: false,
        tool_call: true,
        open_weights: false,
        release_date: "2024-05-13",
        last_updated: "2024-05-13",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 2.5, output: 10 },
      },
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        attachment: true,
        reasoning: false,
        tool_call: true,
        open_weights: false,
        release_date: "2024-07-18",
        last_updated: "2024-07-18",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 0.15, output: 0.6 },
      },
    },
  },
};

beforeAll(async () => {
  setCacheEnabled(false);
  globalThis.fetch = mock((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(url.includes("openrouter") ? openRouter : modelsDev), {
        status: 200,
      }),
    ),
  ) as unknown as typeof fetch;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  globalThis.fetch = originalFetch;
});

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

describe("MCP server", () => {
  it("lists all 11 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "cheapest_models",
      "compare_models",
      "estimate_cost",
      "find_models",
      "get_model",
      "get_provider",
      "get_stats",
      "latest_models",
      "list_providers",
      "recommend_models",
      "resolve_model",
    ]);
  });

  it("publishes enums for capability, status and sort", async () => {
    const { tools } = await client.listTools();
    const find = tools.find((t) => t.name === "find_models");
    const props = find?.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.capability.enum).toContain("tool_call");
    expect(props.status.enum).toContain("alpha");
    expect(props.sort.enum).toContain("cost_input");
  });

  it("finds a model by its bare id", async () => {
    const result = await client.callTool({ name: "get_model", arguments: { model_id: "gpt-4o" } });
    expect(JSON.parse(text(result)).id).toBe("openai/gpt-4o");
  });

  it("resolves a model against an endpoint", async () => {
    const result = await client.callTool({
      name: "resolve_model",
      arguments: { model_id: "gpt-4o-mini", endpoint: "https://api.openai.com/v1" },
    });
    const body = JSON.parse(text(result));
    expect(body.model.id).toBe("openai/gpt-4o-mini");
    expect(body.matched_by).toBe("endpoint");
  });

  it("filters find_models by max_cost_output", async () => {
    const result = await client.callTool({
      name: "find_models",
      arguments: { max_cost_output: 1 },
    });
    expect(JSON.parse(text(result)).map((m: { id: string }) => m.id)).toEqual([
      "openai/gpt-4o-mini",
    ]);
  });

  it("rejects an unknown capability", async () => {
    const result = await client.callTool({
      name: "find_models",
      arguments: { capability: "telepathy" },
    });
    expect(result.isError).toBe(true);
  });

  it("reports a missing scope for latest_models as a tool error", async () => {
    const result = await client.callTool({ name: "latest_models", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("endpoint or provider");
  });

  it("lists providers without their full model lists", async () => {
    const result = await client.callTool({ name: "list_providers", arguments: {} });
    const providers = JSON.parse(text(result));
    expect(providers[0].model_count).toBe(2);
    expect(providers[0].models).toBeUndefined();
  });
});
