import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json";
import { compareModels } from "./functions/compare";
import { cheapestModels, estimateCost } from "./functions/cost";
import { latestModels } from "./functions/latest";
import { fetchUnifiedModels } from "./functions/normalize";
import { getProvider, listProviders } from "./functions/provider";
import { listUseCases, recommendModels } from "./functions/recommend";
import { findModel, resolveModel } from "./functions/resolve";
import { findModels } from "./functions/search";
import { getStats } from "./functions/stats";
import { CapabilityEnum, ModelFilterSchema, ModelSortFieldSchema } from "./schemas/functions";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const USE_CASES = Object.keys(listUseCases()) as [string, ...string[]];

const capability = CapabilityEnum.optional().describe("Required capability");
const limit = z.number().int().min(0).optional().describe("Max results (0 = all)");
const minContext = z.number().int().min(0).optional().describe("Minimum context window, tokens");
const endpoint = z
  .string()
  .optional()
  .describe("Base URL being called, e.g. https://api.z.ai/api/anthropic");
const provider = z.string().optional().describe("Provider id, e.g. openai, anthropic");

/** An MCP server exposing the library's functions as tools (not yet connected). */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "llm-models", version: pkg.version });

  server.registerTool(
    "find_models",
    {
      description:
        "Discover LLM models across OpenRouter and models.dev with filters and sorting. Defaults to 20 results.",
      inputSchema: {
        provider,
        capability,
        modality: z.string().optional().describe("Input modality: text, image, audio, video, pdf"),
        max_cost_input: z.number().optional().describe("Max input cost, $/million tokens"),
        max_cost_output: z.number().optional().describe("Max output cost, $/million tokens"),
        min_context: minContext,
        search: z.string().optional().describe("Substring of the model id or name"),
        status: ModelFilterSchema.shape.status.describe("Lifecycle status"),
        family: z.string().optional().describe("Model family, e.g. gpt, claude, gemini"),
        sort: ModelSortFieldSchema.optional().describe("Sort field"),
        descending: z.boolean().optional(),
        limit,
      },
    },
    async (params) =>
      json(
        await findModels({
          filter: {
            provider: params.provider,
            capability: params.capability,
            modality: params.modality,
            maxCostInput: params.max_cost_input,
            maxCostOutput: params.max_cost_output,
            minContext: params.min_context,
            search: params.search,
            status: params.status,
            family: params.family,
          },
          sort: params.sort,
          descending: params.descending,
          limit: params.limit ?? 20,
        }),
      ),
  );

  server.registerTool(
    "get_model",
    {
      description:
        "Get one model's full details. Accepts an exact id (openai/gpt-4o), a bare id (gpt-4o), OpenRouter's spelling, or a unique substring.",
      inputSchema: { model_id: z.string().min(1) },
    },
    async ({ model_id }) => json(findModel(await fetchUnifiedModels(), model_id)),
  );

  server.registerTool(
    "resolve_model",
    {
      description:
        "Resolve a model id against the endpoint (or provider) that actually serves it, so limits come from that provider rather than a reseller.",
      inputSchema: { model_id: z.string().min(1), endpoint, provider },
    },
    async ({ model_id, endpoint, provider }) => {
      const result = await resolveModel(model_id, { endpoint, provider });
      if (!result) return failure(`Model "${model_id}" not found`);
      return json({
        model: result.model,
        matched_by: result.matchedBy,
        endpoint_providers: result.endpointProviders,
      });
    },
  );

  server.registerTool(
    "latest_models",
    {
      description:
        "Pick the newest flagship (opus tier) and fast model (sonnet/haiku tiers) served by an endpoint or provider. Give endpoint or provider.",
      inputSchema: {
        endpoint,
        provider,
        filter: z
          .string()
          .optional()
          .describe("Only ids containing this token, or families starting with it"),
      },
    },
    async ({ endpoint, provider, filter }) => {
      if (!endpoint && !provider) return failure("One of endpoint or provider is required");
      const result = await latestModels({ endpoint, provider, filter });
      if (!result) return failure(`No eligible model for ${endpoint ?? provider}`);
      return json({
        provider: result.provider,
        endpoint_providers: result.endpointProviders,
        picks: result.picks,
      });
    },
  );

  server.registerTool(
    "compare_models",
    {
      description: "Compare LLM models side by side on cost, context, capabilities",
      inputSchema: { model_ids: z.array(z.string()).min(2) },
    },
    async ({ model_ids }) => json(await compareModels(model_ids)),
  );

  server.registerTool(
    "estimate_cost",
    {
      description: "Estimate token costs for LLM models",
      inputSchema: {
        model_ids: z.array(z.string()).min(1),
        input_tokens: z.number().int().min(0),
        output_tokens: z.number().int().min(0),
      },
    },
    async ({ model_ids, input_tokens, output_tokens }) =>
      json(
        await estimateCost({
          modelIds: model_ids,
          inputTokens: input_tokens,
          outputTokens: output_tokens,
        }),
      ),
  );

  server.registerTool(
    "cheapest_models",
    {
      description: "Find the cheapest non-deprecated LLM models matching criteria",
      inputSchema: { capability, min_context: minContext, limit },
    },
    async (params) =>
      json(
        await cheapestModels({
          capability: params.capability,
          minContext: params.min_context,
          limit: params.limit,
        }),
      ),
  );

  server.registerTool(
    "get_provider",
    {
      description: "Get details about an LLM provider including SDK, env vars, and models",
      inputSchema: { provider_id: z.string().min(1) },
    },
    async ({ provider_id }) => json(await getProvider(provider_id)),
  );

  server.registerTool(
    "list_providers",
    {
      description:
        "List all LLM providers with model counts, docs, env vars and SDK package (use get_provider for a provider's models)",
    },
    // Every provider's full model list would run to megabytes; counts suffice here.
    async () => json((await listProviders()).map(({ models: _models, ...info }) => info)),
  );

  server.registerTool(
    "get_stats",
    { description: "Get aggregate statistics about the LLM model landscape" },
    async () => json(await getStats()),
  );

  server.registerTool(
    "recommend_models",
    {
      description: "Get non-deprecated model recommendations for a use case",
      inputSchema: {
        use_case: z.enum(USE_CASES),
        max_cost: z.number().optional().describe("Max input cost, $/million tokens"),
        min_context: minContext,
        limit,
      },
    },
    async ({ use_case, max_cost, min_context, limit }) =>
      json(await recommendModels(use_case, { maxCost: max_cost, minContext: min_context, limit })),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}
