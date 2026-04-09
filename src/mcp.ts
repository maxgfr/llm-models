import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type ZodTypeAny, z } from "zod/v3";
import { compareModels } from "./functions/compare";
import { cheapestModels, estimateCost } from "./functions/cost";
import { getProvider, listProviders } from "./functions/provider";
import { recommendModels } from "./functions/recommend";
import { findModels } from "./functions/search";
import { getStats } from "./functions/stats";
import type { Capabilities, ModelFilter, ModelSortField } from "./types";

// Explicit Record<string, ZodTypeAny> prevents TS2589 "excessively deep"
// type instantiation caused by MCP SDK generics + Zod 4 compat layer.
type Params = Record<string, unknown>;
type ToolResult = { content: { type: "text"; text: string }[] };

// find_models has 9 params — use z.string() instead of z.enum() to keep
// the schema type shallow enough for TypeScript's overload resolution.
const findModelsParams: Record<string, ZodTypeAny> = {
  provider: z.string().optional(),
  capability: z.string().optional(),
  modality: z.string().optional(),
  max_cost_input: z.number().optional(),
  min_context: z.number().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  descending: z.boolean().optional(),
  limit: z.number().optional(),
};

const compareModelsParams: Record<string, ZodTypeAny> = {
  model_ids: z.array(z.string()).min(2),
};

const estimateCostParams: Record<string, ZodTypeAny> = {
  model_ids: z.array(z.string()),
  input_tokens: z.number(),
  output_tokens: z.number(),
};

const cheapestModelsParams: Record<string, ZodTypeAny> = {
  capability: z.string().optional(),
  min_context: z.number().optional(),
  limit: z.number().optional(),
};

const getProviderParams: Record<string, ZodTypeAny> = {
  provider_id: z.string(),
};

const recommendModelsParams: Record<string, ZodTypeAny> = {
  use_case: z.string(),
  max_cost: z.number().optional(),
  limit: z.number().optional(),
};

type RegisterTool = (
  name: string,
  description: string,
  params: Record<string, ZodTypeAny>,
  handler: (params: Params) => Promise<ToolResult>,
) => void;

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "llm-models",
    version: "1.0.0",
  });

  // Single cast to a concrete signature avoids TS2589 on overload resolution
  const tool: RegisterTool = server.tool.bind(server);

  tool(
    "find_models",
    "Discover LLM models with smart filtering across OpenRouter and models.dev APIs. Capabilities: reasoning, tool_call, structured_output, open_weights, attachment. Sort: cost_input, cost_output, context_length, release_date, name.",
    findModelsParams,
    async (params: Params): Promise<ToolResult> => {
      const models = await findModels({
        filter: {
          provider: params.provider as string | undefined,
          capability: params.capability as ModelFilter["capability"],
          modality: params.modality as string | undefined,
          maxCostInput: params.max_cost_input as number | undefined,
          minContext: params.min_context as number | undefined,
          search: params.search as string | undefined,
        },
        sort: params.sort as ModelSortField | undefined,
        descending: params.descending as boolean | undefined,
        limit: (params.limit as number | undefined) ?? 20,
      });
      return { content: [{ type: "text", text: JSON.stringify(models, null, 2) }] };
    },
  );

  tool(
    "compare_models",
    "Compare LLM models side by side on cost, context, capabilities",
    compareModelsParams,
    async (params: Params): Promise<ToolResult> => {
      const comparison = await compareModels(params.model_ids as string[]);
      return { content: [{ type: "text", text: JSON.stringify(comparison, null, 2) }] };
    },
  );

  tool(
    "estimate_cost",
    "Estimate token costs for LLM models",
    estimateCostParams,
    async (params: Params): Promise<ToolResult> => {
      const estimates = await estimateCost({
        modelIds: params.model_ids as string[],
        inputTokens: params.input_tokens as number,
        outputTokens: params.output_tokens as number,
      });
      return { content: [{ type: "text", text: JSON.stringify(estimates, null, 2) }] };
    },
  );

  tool(
    "cheapest_models",
    "Find the cheapest LLM models matching criteria. Capabilities: reasoning, tool_call, structured_output, open_weights, attachment.",
    cheapestModelsParams,
    async (params: Params): Promise<ToolResult> => {
      const models = await cheapestModels({
        capability: params.capability as keyof Capabilities | undefined,
        minContext: params.min_context as number | undefined,
        limit: params.limit as number | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(models, null, 2) }] };
    },
  );

  tool(
    "get_provider",
    "Get details about an LLM provider including SDK, env vars, and models",
    getProviderParams,
    async (params: Params): Promise<ToolResult> => {
      const provider = await getProvider(params.provider_id as string);
      return { content: [{ type: "text", text: JSON.stringify(provider, null, 2) }] };
    },
  );

  tool(
    "list_providers",
    "List all LLM providers with model counts",
    {},
    async (): Promise<ToolResult> => {
      const providers = await listProviders();
      return { content: [{ type: "text", text: JSON.stringify(providers, null, 2) }] };
    },
  );

  tool(
    "get_stats",
    "Get aggregate statistics about the LLM model landscape",
    {},
    async (): Promise<ToolResult> => {
      const stats = await getStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    },
  );

  tool(
    "recommend_models",
    "Get model recommendations for a use case: code-gen, vision, cheap-chatbot, reasoning, long-context, open-source, audio, tool-use.",
    recommendModelsParams,
    async (params: Params): Promise<ToolResult> => {
      const result = await recommendModels(params.use_case as string, {
        maxCost: params.max_cost as number | undefined,
        limit: params.limit as number | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
