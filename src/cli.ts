import { Command } from "commander";
import { fetchModelsDevModels } from "./clients/models-dev";
import { fetchOpenRouterModels } from "./clients/openrouter";
import {
  formatCapabilities,
  formatContext,
  formatCost,
  parseTokenCount,
  printTable,
} from "./format";
import { compareModels } from "./functions/compare";
import { estimateCost } from "./functions/cost";
import { fetchUnifiedModels } from "./functions/normalize";
import { getProvider, listProviders } from "./functions/provider";
import { findModels } from "./functions/search";
import type { ModelFilter, ModelSortField } from "./types";

const pkg = require("../package.json");

export function runCommand(): void {
  const program = new Command();

  program
    .name("llm-models")
    .description("Fetch latest LLM models from OpenRouter and models.dev")
    .version(pkg.version);

  // --- Raw proxy commands (existing) ---

  program
    .command("openrouter")
    .description("Fetch raw models from OpenRouter API")
    .option("-p, --provider <prefix>", "Filter by provider prefix (e.g. google, openai)")
    .option("-s, --search <term>", "Search models by name or ID")
    .option("-c, --count", "Show model count only")
    .action(async (options: { provider?: string; search?: string; count?: boolean }) => {
      const data = await fetchOpenRouterModels();
      let models = data.data;

      if (options.provider) {
        const prefix = options.provider.toLowerCase();
        models = models.filter((m) => m.id.toLowerCase().startsWith(`${prefix}/`));
      }
      if (options.search) {
        const term = options.search.toLowerCase();
        models = models.filter(
          (m) => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term),
        );
      }
      if (options.count) {
        console.log(models.length);
        return;
      }
      console.log(JSON.stringify(models, null, 2));
    });

  program
    .command("models-dev")
    .description("Fetch raw models from models.dev API")
    .option("-p, --provider <id>", "Filter by provider ID (e.g. openai, anthropic)")
    .option("-s, --search <term>", "Search models by name or ID")
    .option("-c, --count", "Show model/provider count only")
    .action(async (options: { provider?: string; search?: string; count?: boolean }) => {
      const data = await fetchModelsDevModels();

      if (options.provider) {
        const provider = data[options.provider];
        if (!provider) {
          console.error(`Provider "${options.provider}" not found`);
          process.exit(1);
        }
        let models = Object.values(provider.models);
        if (options.search) {
          const term = options.search.toLowerCase();
          models = models.filter(
            (m) => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term),
          );
        }
        if (options.count) {
          console.log(models.length);
          return;
        }
        console.log(JSON.stringify({ ...provider, models }, null, 2));
        return;
      }

      if (options.count) {
        const providerCount = Object.keys(data).length;
        const modelCount = Object.values(data).reduce(
          (sum, p) => sum + Object.keys(p.models).length,
          0,
        );
        console.log(`${providerCount} providers, ${modelCount} models`);
        return;
      }
      console.log(JSON.stringify(data, null, 2));
    });

  // --- Smart commands ---

  program
    .command("find")
    .description("Discover models across both APIs with smart filtering")
    .option("-p, --provider <id>", "Filter by provider")
    .option(
      "-C, --capability <cap>",
      "Filter by capability: reasoning, tool_call, structured_output, open_weights, attachment",
    )
    .option("-m, --modality <mod>", "Filter by input modality (e.g. image, audio, video, pdf)")
    .option("--max-cost <n>", "Max input cost ($/million tokens)", Number.parseFloat)
    .option("--min-context <n>", "Min context window size", Number.parseInt)
    .option("-s, --search <term>", "Search by name or ID")
    .option(
      "--sort <field>",
      "Sort by: cost_input, cost_output, context_length, release_date, name",
    )
    .option("--desc", "Sort descending")
    .option("-n, --limit <n>", "Max results (default: 20)", Number.parseInt, 20)
    .option("--json", "Output raw JSON")
    .action(
      async (options: {
        provider?: string;
        capability?: string;
        modality?: string;
        maxCost?: number;
        minContext?: number;
        search?: string;
        sort?: string;
        desc?: boolean;
        limit?: number;
        json?: boolean;
      }) => {
        const filter: ModelFilter = {
          provider: options.provider,
          capability: options.capability as ModelFilter["capability"],
          modality: options.modality,
          maxCostInput: options.maxCost,
          minContext: options.minContext,
          search: options.search,
        };

        const models = await findModels({
          filter,
          sort: options.sort as ModelSortField | undefined,
          descending: options.desc,
          limit: options.limit,
        });

        if (options.json) {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0) {
          console.log("No models found matching your criteria.");
          return;
        }

        const headers = ["ID", "Context", "$/M In", "$/M Out", "Capabilities"];
        const rows = models.map((m) => [
          m.id,
          formatContext(m.context_length),
          formatCost(m.cost?.input),
          formatCost(m.cost?.output),
          formatCapabilities(m.capabilities),
        ]);
        printTable(headers, rows);

        const total = await fetchUnifiedModels();
        if (models.length < total.length) {
          console.log(`\n(${models.length} of ${total.length} models shown)`);
        }
      },
    );

  program
    .command("compare")
    .description("Compare models side by side")
    .argument("<models...>", "Model IDs to compare (at least 2)")
    .option("--json", "Output raw JSON")
    .action(async (modelIds: string[], options: { json?: boolean }) => {
      const comparison = await compareModels(modelIds);

      if (options.json) {
        console.log(JSON.stringify(comparison, null, 2));
        return;
      }

      const ids = comparison.models.map((m) => m.id);
      const labelWidth = 20;

      // Header
      const header = "".padEnd(labelWidth) + ids.map((id) => id.padEnd(28)).join("");
      console.log(header);
      console.log("-".repeat(header.length));

      // Context
      const ctxRow =
        "Context".padEnd(labelWidth) +
        ids
          .map((id) => {
            const val = comparison.dimensions.context_length.values[id];
            const best = comparison.dimensions.context_length.best === id ? " *" : "";
            return `${val != null ? formatContext(val) : "-"}${best}`.padEnd(28);
          })
          .join("");
      console.log(ctxRow);

      // Cost input
      const costInRow =
        "$/M input".padEnd(labelWidth) +
        ids
          .map((id) => {
            const val = comparison.dimensions.cost_input.values[id];
            const best = comparison.dimensions.cost_input.best === id ? " *" : "";
            return `${formatCost(val)}${best}`.padEnd(28);
          })
          .join("");
      console.log(costInRow);

      // Cost output
      const costOutRow =
        "$/M output".padEnd(labelWidth) +
        ids
          .map((id) => {
            const val = comparison.dimensions.cost_output.values[id];
            const best = comparison.dimensions.cost_output.best === id ? " *" : "";
            return `${formatCost(val)}${best}`.padEnd(28);
          })
          .join("");
      console.log(costOutRow);

      // Capabilities
      const allCaps = new Set<string>();
      for (const caps of Object.values(comparison.dimensions.capabilities)) {
        for (const key of Object.keys(caps)) allCaps.add(key);
      }
      for (const cap of allCaps) {
        const row =
          cap.padEnd(labelWidth) +
          ids
            .map((id) => {
              const val = comparison.dimensions.capabilities[id]?.[cap];
              return (val === true ? "Yes" : val === false ? "No" : "-").padEnd(28);
            })
            .join("");
        console.log(row);
      }

      console.log("\n* = best in category");
    });

  program
    .command("provider")
    .description("Get provider details and models")
    .argument("[id]", "Provider ID (e.g. openai, anthropic)")
    .option("--list", "List all providers with model counts")
    .option("--json", "Output raw JSON")
    .action(async (id: string | undefined, options: { list?: boolean; json?: boolean }) => {
      if (options.list || !id) {
        const providers = await listProviders();

        if (options.json) {
          console.log(JSON.stringify(providers, null, 2));
          return;
        }

        const headers = ["Provider", "Models", "NPM Package"];
        const rows = providers.map((p) => [p.id, String(p.model_count), p.npm ?? "-"]);
        printTable(headers, rows);
        return;
      }

      const provider = await getProvider(id);

      if (options.json) {
        console.log(JSON.stringify(provider, null, 2));
        return;
      }

      console.log(`Provider: ${provider.name}`);
      if (provider.doc) console.log(`Documentation: ${provider.doc}`);
      if (provider.npm) console.log(`NPM package: ${provider.npm}`);
      if (provider.env?.length) console.log(`Env variables: ${provider.env.join(", ")}`);
      if (provider.api) console.log(`API endpoint: ${provider.api}`);
      console.log(`\nModels (${provider.model_count}):`);

      const headers = ["ID", "Context", "$/M In", "$/M Out", "Capabilities"];
      const rows = provider.models.map((m) => [
        m.id,
        formatContext(m.context_length),
        formatCost(m.cost?.input),
        formatCost(m.cost?.output),
        formatCapabilities(m.capabilities),
      ]);
      printTable(headers, rows);
    });

  program
    .command("cost")
    .description("Estimate costs for models")
    .argument("<models...>", "Model IDs")
    .requiredOption("-i, --input <tokens>", "Input tokens (supports K/M suffix: 100K, 1M)")
    .requiredOption("-o, --output <tokens>", "Output tokens (supports K/M suffix: 10K)")
    .option("--json", "Output raw JSON")
    .action(
      async (modelIds: string[], options: { input: string; output: string; json?: boolean }) => {
        const inputTokens = parseTokenCount(options.input);
        const outputTokens = parseTokenCount(options.output);

        const estimates = await estimateCost({
          modelIds,
          inputTokens,
          outputTokens,
        });

        if (options.json) {
          console.log(JSON.stringify(estimates, null, 2));
          return;
        }

        console.log(
          `Cost estimate for ${formatContext(inputTokens)} input + ${formatContext(outputTokens)} output tokens:\n`,
        );

        const headers = ["Model", "Input Cost", "Output Cost", "Total"];
        const rows = estimates.map((e) => [
          e.model,
          formatCost(e.input_cost_usd),
          formatCost(e.output_cost_usd),
          formatCost(e.total_cost_usd),
        ]);
        printTable(headers, rows);
      },
    );

  program.parse();
}
