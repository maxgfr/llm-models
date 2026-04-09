import { describe, expect, it } from "bun:test";
import { OpenRouterResponseSchema } from "../schemas/openrouter";

describe("OpenRouter API Schema Validation", () => {
  it("should validate the live API response against Zod schema", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    expect(response.ok).toBe(true);

    const json = await response.json();
    const result = OpenRouterResponseSchema.safeParse(json);

    if (!result.success) {
      console.error("Schema validation errors:", JSON.stringify(result.error.issues, null, 2));
    }

    expect(result.success).toBe(true);
    expect(result.data?.data.length).toBeGreaterThan(0);
  });

  it("should have expected fields on models", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const json = await response.json();
    const result = OpenRouterResponseSchema.parse(json);
    const model = result.data[0];

    expect(model.id).toBeDefined();
    expect(model.name).toBeDefined();
    expect(model.pricing.prompt).toBeDefined();
    expect(model.pricing.completion).toBeDefined();
    expect(model.architecture.input_modalities).toBeInstanceOf(Array);
    expect(model.architecture.output_modalities).toBeInstanceOf(Array);
    expect(model.supported_parameters).toBeInstanceOf(Array);
    expect(typeof model.context_length).toBe("number");
  });
});
