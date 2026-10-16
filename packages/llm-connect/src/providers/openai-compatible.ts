import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type ProviderFactory, registerProvider } from "../registry.js";

/** Providers the catalog routes through the generic SDK, each with its own base URL. */
export const factory: ProviderFactory = (config) => {
  if (!config.baseURL)
    throw new Error(
      "This provider has no API URL. Select it again in the settings or configure a custom endpoint.",
    );
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: config.headers,
    // Keep the SDK's schema, then translate it for JSON-object APIs such as GLM.
    // generateObject still validates; the server need not implement json_schema.
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => {
      const format = body.response_format as
        | { type: string; json_schema?: { schema: unknown } }
        | undefined;
      if (format?.type !== "json_schema" || !format.json_schema) return body;
      return {
        ...body,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Return only a JSON object matching this JSON schema: ${JSON.stringify(format.json_schema.schema)}`,
          },
          ...(body.messages as unknown[]),
        ],
      };
    },
  }).chatModel(config.model);
};

export function register(): void {
  registerProvider("openai-compatible", factory);
}
