import { Command } from "commander";
import { clearCache, setCacheEnabled } from "./cache";
import { fetchModelsDevModels } from "./clients/models-dev";
import { fetchOpenRouterModels } from "./clients/openrouter";
import { bold, cyan, dim, green, red, yellow } from "./colors";
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "./completions";
import { getConfigPath, getProfile, initConfig, listProfiles, loadConfig } from "./config";
import {
  formatCapabilities,
  formatContext,
  formatCost,
  formatCostRaw,
  type OutputFormat,
  outputFormatted,
  parseTokenCount,
} from "./format";
import { compareModels } from "./functions/compare";
import { cheapestModels, estimateCost } from "./functions/cost";
import { diffModels } from "./functions/diff";
import { fetchUnifiedModels } from "./functions/normalize";
import { getProvider, listProviders } from "./functions/provider";
import { listUseCases, recommendModels } from "./functions/recommend";
import { findModels } from "./functions/search";
import { getStats } from "./functions/stats";
import type { Capabilities, ModelFilter, ModelSortField } from "./types";

const pkg = require("../package.json");

function resolveFormat(options: { json?: boolean; format?: string }): OutputFormat {
  if (options.json) return "json";
  if (options.format) return options.format as OutputFormat;
  const config = loadConfig();
  return config.defaults?.format ?? "table";
}

export function runCommand(): void {
  const program = new Command();

  program
    .name("llm-models")
    .description("Fetch latest LLM models from OpenRouter and models.dev")
    .version(pkg.version)
    .option("--no-cache", "Disable cache for this request")
    .option("--quiet", "Suppress informational messages")
    .option("--verbose", "Show debug info (timing, cache status)")
    .hook("preAction", (_thisCommand, _actionCommand) => {
      const opts = program.opts();
      if (opts.cache === false) {
        setCacheEnabled(false);
      }
    });

  // --- Raw proxy commands ---

  program
    .command("openrouter")
    .description("Fetch raw models from OpenRouter API")
    .option("-p, --provider <prefix>", "Filter by provider prefix (e.g. google, openai)")
    .option("-s, --search <term>", "Search models by name or ID")
    .option("-c, --count", "Show model count only")
    .action(async (options: { provider?: string; search?: string; count?: boolean }) => {
      const start = Date.now();
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
      if (program.opts().verbose) {
        console.error(`Fetched in ${Date.now() - start}ms`);
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
      const start = Date.now();
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
        if (program.opts().verbose) {
          console.error(`Fetched in ${Date.now() - start}ms`);
        }
        if (options.count) {
          console.log(models.length);
          return;
        }
        console.log(JSON.stringify({ ...provider, models }, null, 2));
        return;
      }

      if (program.opts().verbose) {
        console.error(`Fetched in ${Date.now() - start}ms`);
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
    .option("--max-cost-output <n>", "Max output cost ($/million tokens)", Number.parseFloat)
    .option("--min-context <n>", "Min context window size", Number.parseInt)
    .option("-s, --search <term>", "Search by name or ID")
    .option("--status <status>", "Filter by status: active, beta, deprecated")
    .option("-f, --family <name>", "Filter by model family (e.g. gpt, claude, gemini)")
    .option(
      "--sort <field>",
      "Sort by: cost_input, cost_output, context_length, release_date, name, knowledge_cutoff, value",
    )
    .option("--desc", "Sort descending")
    .option("-n, --limit <n>", "Max results (default: 20)", Number.parseInt, 20)
    .option("-c, --count", "Show model count only")
    .option("--ids-only", "Output model IDs only, one per line")
    .option("--json", "Output raw JSON")
    .option("--format <fmt>", "Output format: table, json, csv, markdown")
    .action(
      async (options: {
        provider?: string;
        capability?: string;
        modality?: string;
        maxCost?: number;
        maxCostOutput?: number;
        minContext?: number;
        search?: string;
        status?: string;
        family?: string;
        sort?: string;
        desc?: boolean;
        limit?: number;
        count?: boolean;
        idsOnly?: boolean;
        json?: boolean;
        format?: string;
      }) => {
        const start = Date.now();
        const filter: ModelFilter = {
          provider: options.provider,
          capability: options.capability as ModelFilter["capability"],
          modality: options.modality,
          maxCostInput: options.maxCost,
          maxCostOutput: options.maxCostOutput,
          minContext: options.minContext,
          search: options.search,
          status: options.status as ModelFilter["status"],
          family: options.family,
        };

        const models = await findModels({
          filter,
          sort: options.sort as ModelSortField | undefined,
          descending: options.desc,
          limit: options.limit,
        });

        if (program.opts().verbose) {
          console.error(`Found ${models.length} models in ${Date.now() - start}ms`);
        }

        if (options.count) {
          console.log(models.length);
          return;
        }

        if (options.idsOnly) {
          for (const m of models) console.log(m.id);
          return;
        }

        const fmt = resolveFormat(options);

        if (fmt === "json") {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0) {
          console.log("No models found matching your criteria.");
          return;
        }

        const headers = ["ID", "Context", "Output", "$/M In", "$/M Out", "Capabilities"];
        const rows = models.map((m) => [
          m.id,
          formatContext(m.context_length),
          m.output_limit ? formatContext(m.output_limit) : "-",
          formatCost(m.cost?.input),
          formatCost(m.cost?.output),
          formatCapabilities(m.capabilities),
        ]);
        outputFormatted(fmt, headers, rows, models);

        if (!program.opts().quiet) {
          const total = await fetchUnifiedModels();
          if (models.length < total.length) {
            console.log(`\n(${models.length} of ${total.length} models shown)`);
          }
        }
      },
    );

  program
    .command("compare")
    .description("Compare models side by side")
    .argument("<models...>", "Model IDs to compare (at least 2)")
    .option("--json", "Output raw JSON")
    .option("--format <fmt>", "Output format: table, json, csv, markdown")
    .action(async (modelIds: string[], options: { json?: boolean; format?: string }) => {
      const comparison = await compareModels(modelIds);
      const fmt = resolveFormat(options);

      if (fmt === "json") {
        console.log(JSON.stringify(comparison, null, 2));
        return;
      }

      const ids = comparison.models.map((m) => m.id);
      const labelWidth = 20;

      // Header
      const header =
        "".padEnd(labelWidth) +
        ids.map((id) => bold(id).padEnd(28 + (bold(id).length - id.length))).join("");
      console.log(header);
      console.log("-".repeat(labelWidth + ids.length * 28));

      // Helper for dimension rows
      const dimRow = (
        label: string,
        dim: { values: Record<string, number | null>; best: string | null },
        formatter: (v: number | null) => string,
      ) => {
        const row =
          label.padEnd(labelWidth) +
          ids
            .map((id) => {
              const val = dim.values[id];
              const isBest = dim.best === id;
              const formatted = formatter(val);
              return `${formatted}${isBest ? green(" *") : ""}`.padEnd(
                28 + (isBest ? green(" *").length - 2 : 0),
              );
            })
            .join("");
        console.log(row);
      };

      dimRow("Context", comparison.dimensions.context_length, (v) =>
        v != null ? formatContext(v) : "-",
      );
      dimRow("Output limit", comparison.dimensions.output_limit, (v) =>
        v != null ? formatContext(v) : "-",
      );
      dimRow("$/M input", comparison.dimensions.cost_input, (v) => formatCost(v));
      dimRow("$/M output", comparison.dimensions.cost_output, (v) => formatCost(v));

      // Knowledge cutoff
      const kcRow =
        "Knowledge cutoff".padEnd(labelWidth) +
        ids
          .map((id) => {
            const model = comparison.models.find((m) => m.id === id);
            return (model?.knowledge_cutoff ?? "-").padEnd(28);
          })
          .join("");
      console.log(kcRow);

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
              const text = val === true ? green("Yes") : val === false ? red("No") : dim("-");
              const rawLen = val === true ? 3 : val === false ? 2 : 1;
              return (text + " ".repeat(Math.max(0, 28 - rawLen))).slice(
                0,
                28 + (text.length - rawLen),
              );
            })
            .join("");
        console.log(row);
      }

      console.log(`\n${green("*")} = best in category`);
    });

  program
    .command("provider")
    .description("Get provider details and models")
    .argument("[id]", "Provider ID (e.g. openai, anthropic)")
    .option("--list", "List all providers with model counts")
    .option("--json", "Output raw JSON")
    .option("--format <fmt>", "Output format: table, json, csv, markdown")
    .action(
      async (
        id: string | undefined,
        options: { list?: boolean; json?: boolean; format?: string },
      ) => {
        const fmt = resolveFormat(options);

        if (options.list || !id) {
          const providers = await listProviders();

          if (fmt === "json") {
            console.log(JSON.stringify(providers, null, 2));
            return;
          }

          const headers = ["Provider", "Models", "NPM Package"];
          const rows = providers.map((p) => [p.id, String(p.model_count), p.npm ?? "-"]);
          outputFormatted(fmt, headers, rows, providers);
          return;
        }

        const provider = await getProvider(id);

        if (fmt === "json") {
          console.log(JSON.stringify(provider, null, 2));
          return;
        }

        console.log(`${bold("Provider:")} ${provider.name}`);
        if (provider.doc) console.log(`${bold("Documentation:")} ${provider.doc}`);
        if (provider.npm) console.log(`${bold("NPM package:")} ${provider.npm}`);
        if (provider.env?.length)
          console.log(`${bold("Env variables:")} ${provider.env.join(", ")}`);
        if (provider.api) console.log(`${bold("API endpoint:")} ${provider.api}`);
        console.log(`\n${bold("Models")} (${provider.model_count}):`);

        const headers = ["ID", "Context", "Output", "$/M In", "$/M Out", "Capabilities"];
        const rows = provider.models.map((m) => [
          m.id,
          formatContext(m.context_length),
          m.output_limit ? formatContext(m.output_limit) : "-",
          formatCost(m.cost?.input),
          formatCost(m.cost?.output),
          formatCapabilities(m.capabilities),
        ]);
        outputFormatted(fmt, headers, rows, provider.models);
      },
    );

  program
    .command("cost")
    .description("Estimate costs for models")
    .argument("<models...>", "Model IDs")
    .requiredOption("-i, --input <tokens>", "Input tokens (supports K/M suffix: 100K, 1M)")
    .requiredOption("-o, --output <tokens>", "Output tokens (supports K/M suffix: 10K)")
    .option("--daily <n>", "Number of daily requests for projection", Number.parseInt)
    .option("--monthly <n>", "Number of monthly requests for projection", Number.parseInt)
    .option("-P, --profile <name>", "Use workload profile (chatbot, code-gen, rag, summarization)")
    .option("--json", "Output raw JSON")
    .option("--format <fmt>", "Output format: table, json, csv, markdown")
    .action(
      async (
        modelIds: string[],
        options: {
          input: string;
          output: string;
          daily?: number;
          monthly?: number;
          profile?: string;
          json?: boolean;
          format?: string;
        },
      ) => {
        let inputStr = options.input;
        let outputStr = options.output;

        if (options.profile) {
          const profile = getProfile(options.profile);
          if (!profile) {
            const available = Object.keys(listProfiles()).join(", ");
            console.error(`Unknown profile "${options.profile}". Available: ${available}`);
            process.exit(1);
          }
          inputStr = profile.input;
          outputStr = profile.output;
        }

        const inputTokens = parseTokenCount(inputStr);
        const outputTokens = parseTokenCount(outputStr);

        const estimates = await estimateCost({ modelIds, inputTokens, outputTokens });
        const fmt = resolveFormat(options);

        if (fmt === "json") {
          const jsonData = estimates.map((e) => ({
            ...e,
            ...(options.daily
              ? {
                  daily_cost_usd: e.total_cost_usd * options.daily,
                  monthly_cost_usd: e.total_cost_usd * options.daily * 30,
                }
              : {}),
            ...(options.monthly
              ? {
                  monthly_cost_usd: e.total_cost_usd * options.monthly,
                }
              : {}),
          }));
          console.log(JSON.stringify(jsonData, null, 2));
          return;
        }

        console.log(
          `Cost estimate for ${formatContext(inputTokens)} input + ${formatContext(outputTokens)} output tokens:\n`,
        );

        const hasProjection = options.daily || options.monthly;
        const headers = hasProjection
          ? ["Model", "Input Cost", "Output Cost", "Total", "Daily", "Monthly"]
          : ["Model", "Input Cost", "Output Cost", "Total"];

        const rows = estimates.map((e) => {
          const base = [
            e.model,
            formatCost(e.input_cost_usd),
            formatCost(e.output_cost_usd),
            formatCost(e.total_cost_usd),
          ];
          if (hasProjection) {
            const multiplier = options.daily ?? (options.monthly ? options.monthly / 30 : 0);
            const dailyCost = e.total_cost_usd * multiplier;
            const monthlyCost = dailyCost * 30;
            base.push(formatCost(dailyCost), formatCost(monthlyCost));
          }
          return base;
        });
        outputFormatted(fmt, headers, rows, estimates);
      },
    );

  program
    .command("cheapest")
    .description("Find the cheapest models matching your criteria")
    .option(
      "-C, --capability <cap>",
      "Filter by capability: reasoning, tool_call, structured_output, open_weights, attachment",
    )
    .option("--min-context <n>", "Min context window size", Number.parseInt)
    .option("-n, --limit <n>", "Max results (default: 10)", Number.parseInt, 10)
    .option("--json", "Output raw JSON")
    .option("--format <fmt>", "Output format: table, json, csv, markdown")
    .action(
      async (options: {
        capability?: string;
        minContext?: number;
        limit?: number;
        json?: boolean;
        format?: string;
      }) => {
        const models = await cheapestModels({
          capability: options.capability as keyof Capabilities | undefined,
          minContext: options.minContext,
          limit: options.limit,
        });

        const fmt = resolveFormat(options);

        if (fmt === "json") {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0) {
          console.log("No models found matching your criteria.");
          return;
        }

        const headers = ["ID", "Context", "Output", "$/M In", "$/M Out", "Capabilities"];
        const rows = models.map((m) => [
          m.id,
          formatContext(m.context_length),
          m.output_limit ? formatContext(m.output_limit) : "-",
          formatCost(m.cost?.input),
          formatCost(m.cost?.output),
          formatCapabilities(m.capabilities),
        ]);
        outputFormatted(fmt, headers, rows, models);
      },
    );

  // --- Info command ---

  program
    .command("info")
    .description("Show detailed information about a model")
    .argument("<model>", "Model ID (supports partial match)")
    .option("--json", "Output raw JSON")
    .action(async (modelId: string, options: { json?: boolean }) => {
      const models = await fetchUnifiedModels();
      const lower = modelId.toLowerCase();

      let model = models.find((m) => m.id === modelId);
      if (!model) {
        const matches = models.filter(
          (m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower),
        );
        if (matches.length === 1) model = matches[0];
        else if (matches.length > 1) {
          const ids = matches.slice(0, 10).map((m) => m.id);
          console.error(
            `Ambiguous: "${modelId}". Did you mean:\n${ids.map((id) => `  - ${id}`).join("\n")}`,
          );
          process.exit(1);
        } else {
          console.error(`Model "${modelId}" not found`);
          process.exit(1);
        }
      }

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      console.log(bold(model.name));
      console.log(dim(model.id));
      console.log();

      if (model.description) {
        console.log(model.description);
        console.log();
      }

      console.log(`${bold("Provider:")}          ${model.provider}`);
      console.log(`${bold("Context:")}           ${formatContext(model.context_length)}`);
      if (model.output_limit)
        console.log(`${bold("Output limit:")}      ${formatContext(model.output_limit)}`);
      if (model.family) console.log(`${bold("Family:")}            ${model.family}`);
      if (model.status)
        console.log(
          `${bold("Status:")}            ${model.status === "deprecated" ? red(model.status) : green(model.status)}`,
        );
      if (model.release_date) console.log(`${bold("Release date:")}      ${model.release_date}`);
      if (model.knowledge_cutoff)
        console.log(`${bold("Knowledge cutoff:")}  ${model.knowledge_cutoff}`);
      if (model.tokenizer) console.log(`${bold("Tokenizer:")}         ${model.tokenizer}`);
      if (model.hugging_face_id)
        console.log(`${bold("Hugging Face:")}      ${model.hugging_face_id}`);

      console.log();
      console.log(bold("Cost ($/M tokens):"));
      if (model.cost) {
        console.log(`  Input:          ${formatCost(model.cost.input)}`);
        console.log(`  Output:         ${formatCost(model.cost.output)}`);
        if (model.cost.cache_read != null)
          console.log(`  Cache read:     ${formatCost(model.cost.cache_read)}`);
        if (model.cost.cache_write != null)
          console.log(`  Cache write:    ${formatCost(model.cost.cache_write)}`);
        if (model.cost.reasoning != null)
          console.log(`  Reasoning:      ${formatCost(model.cost.reasoning)}`);
        if (model.cost.input_audio != null)
          console.log(`  Audio input:    ${formatCost(model.cost.input_audio)}`);
        if (model.cost.output_audio != null)
          console.log(`  Audio output:   ${formatCost(model.cost.output_audio)}`);
      } else {
        console.log("  No pricing data");
      }

      console.log();
      console.log(bold("Capabilities:"));
      const caps = Object.entries(model.capabilities).filter(([, v]) => v != null);
      if (caps.length > 0) {
        for (const [k, v] of caps) {
          console.log(`  ${k}: ${v ? green("Yes") : red("No")}`);
        }
      } else {
        console.log("  No capability data");
      }

      console.log();
      console.log(bold("Modalities:"));
      console.log(`  Input:  ${model.modalities.input.join(", ")}`);
      console.log(`  Output: ${model.modalities.output.join(", ")}`);

      if (model.supported_parameters?.length) {
        console.log();
        console.log(bold("Supported parameters:"));
        console.log(`  ${model.supported_parameters.join(", ")}`);
      }

      console.log();
      console.log(
        dim(
          `Sources: ${[model.sources.openrouter ? "OpenRouter" : "", model.sources.models_dev ? "models.dev" : ""].filter(Boolean).join(", ")}`,
        ),
      );
    });

  // --- Recommend command ---

  program
    .command("recommend")
    .description("Get model recommendations for a use case")
    .argument(
      "[use-case]",
      "Use case: code-gen, vision, cheap-chatbot, reasoning, long-context, open-source, audio, tool-use",
    )
    .option("--max-cost <n>", "Max input cost budget ($/M tokens)", Number.parseFloat)
    .option("--min-context <n>", "Min context window", Number.parseInt)
    .option("-n, --limit <n>", "Max results (default: 10)", Number.parseInt, 10)
    .option("--list", "List available use cases")
    .option("--json", "Output raw JSON")
    .option("--format <fmt>", "Output format: table, json, csv, markdown")
    .action(
      async (
        useCase: string | undefined,
        options: {
          maxCost?: number;
          minContext?: number;
          limit?: number;
          list?: boolean;
          json?: boolean;
          format?: string;
        },
      ) => {
        if (options.list || !useCase) {
          const useCases = listUseCases();
          console.log(bold("Available use cases:\n"));
          for (const [name, preset] of Object.entries(useCases)) {
            console.log(`  ${cyan(name.padEnd(16))} ${preset.description}`);
          }
          return;
        }

        const result = await recommendModels(useCase, {
          maxCost: options.maxCost,
          minContext: options.minContext,
          limit: options.limit,
        });

        const fmt = resolveFormat(options);

        if (fmt === "json") {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`${bold("Use case:")} ${useCase} — ${result.preset.description}\n`);

        if (result.models.length === 0) {
          console.log("No models found matching this use case.");
          return;
        }

        const headers = ["ID", "Context", "Output", "$/M In", "$/M Out", "Capabilities"];
        const rows = result.models.map((m) => [
          m.id,
          formatContext(m.context_length),
          m.output_limit ? formatContext(m.output_limit) : "-",
          formatCost(m.cost?.input),
          formatCost(m.cost?.output),
          formatCapabilities(m.capabilities),
        ]);
        outputFormatted(fmt, headers, rows, result.models);
      },
    );

  // --- Stats command ---

  program
    .command("stats")
    .description("Show aggregate statistics about the LLM model landscape")
    .option("--json", "Output raw JSON")
    .action(async (options: { json?: boolean }) => {
      const stats = await getStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(bold("LLM Model Landscape\n"));
      console.log(`Total models:    ${bold(String(stats.total_models))}`);
      console.log(`Total providers: ${bold(String(stats.total_providers))}`);

      console.log(`\n${bold("Top providers:")}`);
      for (const p of stats.by_provider.slice(0, 10)) {
        console.log(`  ${p.provider.padEnd(20)} ${String(p.count).padStart(4)} models`);
      }

      console.log(`\n${bold("Capabilities:")}`);
      for (const [cap, count] of Object.entries(stats.by_capability).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${cap.padEnd(20)} ${String(count).padStart(4)} models`);
      }

      console.log(`\n${bold("Input modalities:")}`);
      for (const [mod, count] of Object.entries(stats.by_modality).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${mod.padEnd(20)} ${String(count).padStart(4)} models`);
      }

      if (stats.cost) {
        console.log(`\n${bold("Cost distribution ($/M input tokens):")}`);
        console.log(`  Min:    ${formatCostRaw(stats.cost.input.min)}`);
        console.log(`  P25:    ${formatCostRaw(stats.cost.input.p25)}`);
        console.log(`  Median: ${formatCostRaw(stats.cost.input.median)}`);
        console.log(`  P75:    ${formatCostRaw(stats.cost.input.p75)}`);
        console.log(`  P90:    ${formatCostRaw(stats.cost.input.p90)}`);
        console.log(`  Max:    ${formatCostRaw(stats.cost.input.max)}`);
      }

      console.log(`\n${bold("Context length:")}`);
      console.log(`  Min:    ${formatContext(stats.context_length.min)}`);
      console.log(`  Median: ${formatContext(stats.context_length.median)}`);
      console.log(`  Max:    ${formatContext(stats.context_length.max)}`);

      if (stats.newest_models.length > 0) {
        console.log(`\n${bold("Newest models:")}`);
        for (const m of stats.newest_models.slice(0, 5)) {
          console.log(`  ${m.release_date}  ${m.id}`);
        }
      }
    });

  // --- Diff command ---

  program
    .command("diff")
    .description("Show changes since last cached fetch")
    .option("--json", "Output raw JSON")
    .action(async (options: { json?: boolean }) => {
      const diff = await diffModels();

      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
        return;
      }

      if (!diff.timestamp_previous) {
        console.log("No previous snapshot found. Run any command first to create a baseline.");
        console.log(`Current: ${diff.total_after} models`);
        return;
      }

      const prev = new Date(diff.timestamp_previous).toLocaleString();
      console.log(`${bold("Changes since")} ${prev}\n`);
      console.log(`Models: ${diff.total_before} → ${diff.total_after}`);

      if (diff.added.length > 0) {
        console.log(`\n${green(`+ ${diff.added.length} new models:`)}`);
        for (const m of diff.added.slice(0, 20)) {
          console.log(`  ${green("+")} ${m.id}`);
        }
        if (diff.added.length > 20) console.log(`  ... and ${diff.added.length - 20} more`);
      }

      if (diff.removed.length > 0) {
        console.log(`\n${red(`- ${diff.removed.length} removed models:`)}`);
        for (const id of diff.removed.slice(0, 20)) {
          console.log(`  ${red("-")} ${id}`);
        }
      }

      if (diff.price_changes.length > 0) {
        console.log(`\n${yellow(`~ ${diff.price_changes.length} price changes:`)}`);
        for (const c of diff.price_changes.slice(0, 20)) {
          const oldVal = c.old_value != null ? `$${Number(c.old_value).toFixed(2)}` : "-";
          const newVal = c.new_value != null ? `$${Number(c.new_value).toFixed(2)}` : "-";
          console.log(`  ${c.model_id} ${c.field}: ${oldVal} → ${newVal}`);
        }
      }

      if (diff.status_changes.length > 0) {
        console.log(`\n${yellow(`~ ${diff.status_changes.length} status changes:`)}`);
        for (const c of diff.status_changes) {
          console.log(`  ${c.model_id}: ${c.old_value ?? "active"} → ${c.new_value ?? "active"}`);
        }
      }

      if (
        diff.added.length === 0 &&
        diff.removed.length === 0 &&
        diff.price_changes.length === 0 &&
        diff.status_changes.length === 0
      ) {
        console.log("\nNo changes detected.");
      }
    });

  // --- Cache command ---

  program
    .command("cache")
    .description("Manage the local API cache")
    .argument("[action]", "Action: clear, info")
    .action((action?: string) => {
      if (action === "clear") {
        clearCache();
      } else {
        const info = require("./cache").getCacheInfo();
        console.log("Cache directory: ~/.cache/llm-models/");
        console.log(`Files: ${info.files}`);
        console.log(`Size: ${(info.sizeBytes / 1024).toFixed(1)} KB`);
        console.log(`\nUse ${cyan("llm-models cache clear")} to clear.`);
      }
    });

  // --- Config command ---

  program
    .command("config")
    .description("Manage configuration")
    .argument("[action]", "Action: init, show, path, profiles")
    .action((action?: string) => {
      switch (action) {
        case "init":
          initConfig();
          break;
        case "path":
          console.log(getConfigPath());
          break;
        case "profiles": {
          const profiles = listProfiles();
          console.log(bold("Available workload profiles:\n"));
          for (const [name, profile] of Object.entries(profiles)) {
            console.log(
              `  ${cyan(name.padEnd(16))} input: ${profile.input.padEnd(6)} output: ${profile.output}`,
            );
          }
          break;
        }
        default: {
          const config = loadConfig();
          console.log(JSON.stringify(config, null, 2));
          break;
        }
      }
    });

  // --- Completion command ---

  program
    .command("completion")
    .description("Generate shell completion scripts")
    .argument("<shell>", "Shell: bash, zsh, fish")
    .action((shell: string) => {
      switch (shell) {
        case "bash":
          console.log(generateBashCompletion());
          break;
        case "zsh":
          console.log(generateZshCompletion());
          break;
        case "fish":
          console.log(generateFishCompletion());
          break;
        default:
          console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
          process.exit(1);
      }
    });

  // --- MCP command ---

  program
    .command("mcp")
    .description("Start MCP (Model Context Protocol) server for AI agent integration")
    .action(async () => {
      const { startMcpServer } = await import("./mcp");
      await startMcpServer();
    });

  program.parse();
}
