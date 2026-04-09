import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { compareModels } from "./functions/compare";
import { cheapestModels, estimateCost } from "./functions/cost";
import { getProvider, listProviders } from "./functions/provider";
import { listUseCases, recommendModels } from "./functions/recommend";
import { findModels } from "./functions/search";
import { getStats } from "./functions/stats";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "llm-models",
    version: "1.0.0",
  });

  server.tool(
    "find_models",
    "Discover LLM models with smart filtering across OpenRouter and models.dev APIs",
    {
      provider: z.string().optional().describe("Filter by provider (e.g. openai, anthropic)"),
      capability: z
        .enum(["reasoning", "tool_call", "structured_output", "open_weights", "attachment"])
        .optional()
        .describe("Filter by capability"),
      modality: z.string().optional().describe("Filter by input modality (e.g. image, audio)"),
      max_cost_input: z.number().optional().describe("Max input cost ($/million tokens)"),
      min_context: z.number().optional().describe("Min context window size"),
      search: z.string().optional().describe("Search by name or ID"),
      sort: z
        .enum(["cost_input", "cost_output", "context_length", "release_date", "name"])
        .optional()
        .describe("Sort field"),
      descending: z.boolean().optional().describe("Sort descending"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async (params) => {
      const models = await findModels({
        filter: {
          provider: params.provider,
          capability: params.capability,
          modality: params.modality,
          maxCostInput: params.max_cost_input,
          minContext: params.min_context,
          search: params.search,
        },
        sort: params.sort,
        descending: params.descending,
        limit: params.limit ?? 20,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(models, null, 2) }] };
    },
  );

  server.tool(
    "compare_models",
    "Compare LLM models side by side on cost, context, capabilities",
    {
      model_ids: z.array(z.string()).min(2).describe("Model IDs to compare"),
    },
    async (params) => {
      const comparison = await compareModels(params.model_ids);
      return { content: [{ type: "text" as const, text: JSON.stringify(comparison, null, 2) }] };
    },
  );

  server.tool(
    "estimate_cost",
    "Estimate token costs for LLM models",
    {
      model_ids: z.array(z.string()).describe("Model IDs"),
      input_tokens: z.number().describe("Number of input tokens"),
      output_tokens: z.number().describe("Number of output tokens"),
    },
    async (params) => {
      const estimates = await estimateCost({
        modelIds: params.model_ids,
        inputTokens: params.input_tokens,
        outputTokens: params.output_tokens,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(estimates, null, 2) }] };
    },
  );

  server.tool(
    "cheapest_models",
    "Find the cheapest LLM models matching criteria",
    {
      capability: z
        .enum(["reasoning", "tool_call", "structured_output", "open_weights", "attachment"])
        .optional()
        .describe("Filter by capability"),
      min_context: z.number().optional().describe("Min context window"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async (params) => {
      const models = await cheapestModels({
        capability: params.capability,
        minContext: params.min_context,
        limit: params.limit,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(models, null, 2) }] };
    },
  );

  server.tool(
    "get_provider",
    "Get details about an LLM provider including SDK, env vars, and models",
    {
      provider_id: z.string().describe("Provider ID (e.g. openai, anthropic)"),
    },
    async (params) => {
      const provider = await getProvider(params.provider_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(provider, null, 2) }] };
    },
  );

  server.tool("list_providers", "List all LLM providers with model counts", {}, async () => {
    const providers = await listProviders();
    return { content: [{ type: "text" as const, text: JSON.stringify(providers, null, 2) }] };
  });

  server.tool(
    "get_stats",
    "Get aggregate statistics about the LLM model landscape",
    {},
    async () => {
      const stats = await getStats();
      return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
    },
  );

  server.tool(
    "recommend_models",
    "Get model recommendations for a specific use case",
    {
      use_case: z
        .enum([
          "code-gen",
          "vision",
          "cheap-chatbot",
          "reasoning",
          "long-context",
          "open-source",
          "audio",
          "tool-use",
        ])
        .describe("Use case to recommend models for"),
      max_cost: z.number().optional().describe("Max input cost budget ($/M tokens)"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async (params) => {
      const result = await recommendModels(params.use_case, {
        maxCost: params.max_cost,
        limit: params.limit,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
