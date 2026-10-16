import { describe, expect, it } from "bun:test";
import { ModelsDevResponseSchema } from "../schemas/models-dev";

describe("models.dev API Schema Validation", () => {
  it("should validate the live API response against Zod schema", async () => {
    const response = await fetch("https://models.dev/api.json");
    expect(response.ok).toBe(true);

    const json = await response.json();
    const result = ModelsDevResponseSchema.safeParse(json);

    if (!result.success) {
      console.error("Schema validation errors:", JSON.stringify(result.error.issues, null, 2));
    }

    expect(result.success).toBe(true);
  });

  it("should have at least one provider with models", async () => {
    const response = await fetch("https://models.dev/api.json");
    const json = await response.json();
    const data = ModelsDevResponseSchema.parse(json);
    const providers = Object.keys(data);

    expect(providers.length).toBeGreaterThan(0);

    const firstProvider = data[providers[0]];
    expect(firstProvider.id).toBeDefined();
    expect(firstProvider.name).toBeDefined();
    expect(firstProvider.doc).toBeDefined();
    expect(firstProvider.env).toBeInstanceOf(Array);
    expect(firstProvider.npm).toBeDefined();
    expect(Object.keys(firstProvider.models).length).toBeGreaterThan(0);
  });

  it("should have expected fields on models", async () => {
    const response = await fetch("https://models.dev/api.json");
    const json = await response.json();
    const data = ModelsDevResponseSchema.parse(json);
    const provider = Object.values(data)[0];
    const model = Object.values(provider.models)[0];

    expect(model.id).toBeDefined();
    expect(model.name).toBeDefined();
    expect(typeof model.attachment).toBe("boolean");
    expect(typeof model.reasoning).toBe("boolean");
    expect(typeof model.tool_call).toBe("boolean");
    expect(typeof model.open_weights).toBe("boolean");
    expect(model.release_date).toBeDefined();
    expect(model.last_updated).toBeDefined();
    expect(model.modalities.input).toBeInstanceOf(Array);
    expect(model.modalities.output).toBeInstanceOf(Array);
    expect(typeof model.limit.context).toBe("number");
    expect(typeof model.limit.output).toBe("number");
  });
});
