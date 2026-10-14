import { Argument, Command, InvalidArgumentError, Option } from "commander";
import pkg from "../package.json";
import {
  clearCache,
  getCacheDir,
  getCacheInfo,
  getCacheTtl,
  isCacheEnabled,
  setCacheEnabled,
  setCacheTtl,
} from "./cache";
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
import { DEFAULT_PROBE_ORIGIN } from "./functions/browser";
import { compareModels } from "./functions/compare";
import { cheapestModels, estimateCost, projectCost } from "./functions/cost";
import { diffModels } from "./functions/diff";
import { formatFields, parseFieldList } from "./functions/fields";
import { latestModels, TIERS, type Tier } from "./functions/latest";
import { fetchUnifiedModels } from "./functions/normalize";
import { getProvider, listProviders } from "./functions/provider";
import { listUseCases, recommendModels } from "./functions/recommend";
import { findModel, resolveModel } from "./functions/resolve";
import { filterModels, sortModels } from "./functions/search";
import { getStats } from "./functions/stats";
import { setVerbose } from "./log";
import {
  CapabilityEnum,
  ModelFilterSchema,
  ModelSortFieldSchema,
  OutputFormatSchema,
} from "./schemas/functions";
import type {
  BrowserSupport,
  Capabilities,
  ModelFilter,
  ModelSortField,
  UnifiedModel,
} from "./types";

const CAPABILITIES = CapabilityEnum.options;
const STATUSES = ModelFilterSchema.shape.status.unwrap().options;
const SORT_FIELDS = ModelSortFieldSchema.options;
const FORMATS = OutputFormatSchema.options;

// An enum option: a bad value aborts with "error: option '--x' argument 'y' is
// invalid. Allowed choices are ..." and exit code 1 instead of silently
// filtering everything out. Shell completions read the same choices.
function choice(flags: string, description: string, allowed: readonly string[]): Option {
  return new Option(flags, description).choices(allowed);
}

function integer(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError("Expected an integer");
  }
  return parsed;
}

/** The whole value as a number: "1,5" is an error, not 1. */
function decimal(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(parsed)) {
    throw new InvalidArgumentError("Expected a number");
  }
  return parsed;
}

/** A page origin as typed: "https://app.example.com" (a trailing path is dropped). */
function origin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidArgumentError("Expected an origin such as https://app.example.com");
  }
  if (parsed.origin === "null") {
    throw new InvalidArgumentError("Expected an http(s) origin such as https://app.example.com");
  }
  return parsed.origin;
}

/** The provider list's Browser column. */
function browserCell(support: BrowserSupport | undefined): string {
  if (!support) return "-";
  if (!support.callable) return red("no");
  return support.required_headers ? green("yes, with header") : green("yes");
}

/** The provider view's Browser line. */
function browserDetail(support: BrowserSupport): string {
  if (!support.callable) {
    return `${red("no")} ${dim(`(from ${support.origin}: ${support.reason ?? "refused"})`)}`;
  }
  const headers = Object.entries(support.required_headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");
  const needs = headers ? `, send ${headers}` : "";
  return `${green("yes")} ${dim(`(from ${support.origin}${needs})`)}`;
}

function resolveFormat(options: { json?: boolean; format?: OutputFormat }): OutputFormat {
  if (options.json) return "json";
  if (options.format) return options.format;
  const config = loadConfig();
  return config.defaults?.format ?? "table";
}

function fieldsNotFound(id: string, fields: string[]): void {
  console.error(`None of the requested fields (${fields.join(", ")}) exist on ${id}`);
}

const DEFAULT_FIND_LIMIT = 20;

const MODEL_HEADERS = ["ID", "Context", "Output", "$/M In", "$/M Out", "Capabilities"];

function modelRow(m: UnifiedModel): string[] {
  return [
    m.id,
    formatContext(m.context_length),
    m.output_limit ? formatContext(m.output_limit) : "-",
    formatCost(m.cost?.input),
    formatCost(m.cost?.output),
    formatCapabilities(m.capabilities),
  ];
}

/** The full CLI definition, unparsed: what runCommand runs and completions describe. */
export function createProgram(): Command {
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
      setVerbose(opts.verbose === true);
      const { cache } = loadConfig();
      if (cache?.ttl != null) setCacheTtl(cache.ttl);
      // --no-cache wins over the config; the config can only turn caching off.
      if (opts.cache === false || cache?.enabled === false) {
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
    .addOption(choice("-C, --capability <cap>", "Filter by capability", CAPABILITIES))
    .option("-m, --modality <mod>", "Filter by input modality (e.g. image, audio, video, pdf)")
    .option("--max-cost <n>", "Max input cost ($/million tokens)", decimal)
    .option("--max-cost-output <n>", "Max output cost ($/million tokens)", decimal)
    .option("--min-context <n>", "Min context window size", integer)
    .option("-s, --search <term>", "Search by name or ID")
    .addOption(choice("--status <status>", "Filter by status", STATUSES))
    .option("-f, --family <name>", "Filter by model family (e.g. gpt, claude, gemini)")
    .addOption(choice("--sort <field>", "Sort by", SORT_FIELDS))
    .option("--desc", "Sort descending (needs --sort, or defaults.sort in the config)")
    .option(
      "-n, --limit <n>",
      "Max results; 0 = all (default: 20 in table/markdown output, all otherwise)",
      integer,
    )
    .option("-c, --count", "Show model count only")
    .option("--ids-only", "Output model IDs only, one per line")
    .option(
      "--field <names>",
      "Output only these fields, tab-separated, one line per model (e.g. context_length,output_limit)",
    )
    .option("--json", "Output raw JSON")
    .addOption(choice("--format <fmt>", "Output format", FORMATS))
    .action(
      async (
        options: {
          provider?: string;
          capability?: ModelFilter["capability"];
          modality?: string;
          maxCost?: number;
          maxCostOutput?: number;
          minContext?: number;
          search?: string;
          status?: ModelFilter["status"];
          family?: string;
          sort?: ModelSortField;
          desc?: boolean;
          limit?: number;
          count?: boolean;
          idsOnly?: boolean;
          field?: string;
          json?: boolean;
          format?: OutputFormat;
        },
        command: Command,
      ) => {
        const start = Date.now();
        const defaults = loadConfig().defaults ?? {};
        const sort = options.sort ?? defaults.sort;
        if (options.desc && !sort) {
          command.error("error: --desc needs --sort <field> (or defaults.sort in the config)");
        }
        const descending = options.desc ?? defaults.desc ?? false;

        const filter: ModelFilter = {
          provider: options.provider,
          capability: options.capability,
          modality: options.modality,
          maxCostInput: options.maxCost,
          maxCostOutput: options.maxCostOutput,
          minContext: options.minContext,
          search: options.search,
          status: options.status,
          family: options.family,
        };

        let models = filterModels(await fetchUnifiedModels(), filter);
        if (sort) models = sortModels(models, sort, descending);
        const matching = models.length;

        // A human reading a table wants a screenful; a script wants everything.
        const fmt = resolveFormat(options);
        const forHumans =
          !options.count &&
          !options.idsOnly &&
          !options.field &&
          (fmt === "table" || fmt === "markdown");
        const limit = options.limit ?? (forHumans ? (defaults.limit ?? DEFAULT_FIND_LIMIT) : 0);
        if (limit > 0) models = models.slice(0, limit);

        if (program.opts().verbose) {
          console.error(`Found ${matching} models in ${Date.now() - start}ms`);
        }

        if (options.count) {
          console.log(models.length);
          return;
        }

        if (options.idsOnly) {
          for (const m of models) console.log(m.id);
          return;
        }

        if (options.field) {
          const paths = parseFieldList(options.field);
          const lines = models
            .map((m) => formatFields(m, paths))
            .filter((line): line is string => line !== null);
          if (lines.length === 0) {
            if (models.length === 0) console.error("No models found matching your criteria.");
            else fieldsNotFound("any matching model", paths);
            process.exit(1);
          }
          for (const line of lines) console.log(line);
          return;
        }

        if (fmt === "json") {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0 && fmt === "table") {
          console.log("No models found matching your criteria.");
          return;
        }

        outputFormatted(fmt, MODEL_HEADERS, models.map(modelRow), models);

        if (fmt === "table" && !program.opts().quiet && models.length < matching) {
          console.log(`\n(${models.length} of ${matching} models shown, -n 0 to show all)`);
        }
      },
    );

  program
    .command("compare")
    .description("Compare models side by side")
    .argument("<models...>", "Model IDs to compare (at least 2)")
    .option("--json", "Output raw JSON")
    .addOption(choice("--format <fmt>", "Output format", FORMATS))
    .action(async (modelIds: string[], options: { json?: boolean; format?: OutputFormat }) => {
      const comparison = await compareModels(modelIds);
      const fmt = resolveFormat(options);

      if (fmt === "json") {
        console.log(JSON.stringify(comparison, null, 2));
        return;
      }

      const ids = comparison.models.map((m) => m.id);

      // One set of rows for every format: CSV and Markdown strip the colours,
      // and printTable sizes columns to the widest id instead of a fixed width.
      const cell = (
        dimension: { values: Record<string, number | null>; best: string | null },
        id: string,
        plain: (v: number | null) => string,
        colored: (v: number | null) => string = plain,
      ) => {
        const value = dimension.values[id];
        return dimension.best === id ? green(`${plain(value)} *`) : colored(value);
      };
      const ctx = (v: number | null) => (v != null ? formatContext(v) : "-");
      const { dimensions } = comparison;
      const rows: string[][] = [
        ["Context", ...ids.map((id) => cell(dimensions.context_length, id, ctx))],
        ["Output limit", ...ids.map((id) => cell(dimensions.output_limit, id, ctx))],
        [
          "$/M input",
          ...ids.map((id) => cell(dimensions.cost_input, id, formatCostRaw, formatCost)),
        ],
        [
          "$/M output",
          ...ids.map((id) => cell(dimensions.cost_output, id, formatCostRaw, formatCost)),
        ],
        ["Knowledge cutoff", ...comparison.models.map((m) => m.knowledge_cutoff ?? "-")],
      ];
      const capNames = new Set<string>();
      for (const caps of Object.values(dimensions.capabilities)) {
        for (const key of Object.keys(caps)) capNames.add(key);
      }
      for (const cap of capNames) {
        rows.push([
          cap,
          ...ids.map((id) => {
            const val = dimensions.capabilities[id]?.[cap];
            return val === true ? green("Yes") : val === false ? red("No") : dim("-");
          }),
        ]);
      }
      outputFormatted(fmt, ["", ...ids], rows, comparison);

      if (fmt === "table") console.log(`\n${green("*")} = best in category`);
    });

  program
    .command("provider")
    .description("Get provider details and models")
    .argument("[id]", "Provider ID (e.g. openai, anthropic)")
    .option("--list", "List all providers with model counts")
    .option("--browser", "Probe whether a web page can call the provider directly (CORS)")
    .option(
      "--browser-only",
      "List only providers a web page can call directly (implies --browser)",
    )
    .option(
      "--origin <url>",
      `Page origin the browser probe announces (default: ${DEFAULT_PROBE_ORIGIN})`,
      origin,
    )
    .option("--json", "Output raw JSON")
    .addOption(choice("--format <fmt>", "Output format", FORMATS))
    .action(
      async (
        id: string | undefined,
        options: {
          list?: boolean;
          browser?: boolean;
          browserOnly?: boolean;
          origin?: string;
          json?: boolean;
          format?: OutputFormat;
        },
      ) => {
        const fmt = resolveFormat(options);
        const probe = options.browser || options.browserOnly || options.origin !== undefined;
        const browser = probe ? { origin: options.origin } : undefined;

        if (options.list || !id) {
          let providers = await listProviders({ browser });
          if (options.browserOnly) providers = providers.filter((p) => p.browser?.callable);

          if (fmt === "json") {
            console.log(JSON.stringify(providers, null, 2));
            return;
          }

          const headers = ["Provider", "Models", "NPM Package", ...(probe ? ["Browser"] : [])];
          const rows = providers.map((p) => [
            p.id,
            String(p.model_count),
            p.npm ?? "-",
            ...(probe ? [browserCell(p.browser)] : []),
          ]);
          outputFormatted(fmt, headers, rows, providers);
          return;
        }

        const provider = await getProvider(id, { browser });

        if (fmt === "json") {
          console.log(JSON.stringify(provider, null, 2));
          return;
        }

        // CSV/Markdown get the model table alone, so they stay parseable.
        if (fmt === "table") {
          console.log(`${bold("Provider:")} ${provider.name}`);
          if (provider.doc) console.log(`${bold("Documentation:")} ${provider.doc}`);
          if (provider.npm) console.log(`${bold("NPM package:")} ${provider.npm}`);
          if (provider.env?.length)
            console.log(`${bold("Env variables:")} ${provider.env.join(", ")}`);
          if (provider.api) console.log(`${bold("API endpoint:")} ${provider.api}`);
          if (provider.browser)
            console.log(`${bold("Browser:")} ${browserDetail(provider.browser)}`);
          console.log(`\n${bold("Models")} (${provider.model_count}):`);
        }

        outputFormatted(fmt, MODEL_HEADERS, provider.models.map(modelRow), provider.models);
      },
    );

  program
    .command("cost")
    .description("Estimate costs for models")
    .argument("<models...>", "Model IDs")
    .option("-i, --input <tokens>", "Input tokens (supports K/M suffix: 100K, 1M)")
    .option("-o, --output <tokens>", "Output tokens (supports K/M suffix: 10K)")
    .option("--daily <n>", "Number of daily requests for projection", integer)
    .option("--monthly <n>", "Number of monthly requests for projection", integer)
    .option(
      "-P, --profile <name>",
      "Use workload profile instead of -i/-o (chatbot, code-gen, rag, summarization, translation)",
    )
    .option("--json", "Output raw JSON")
    .addOption(choice("--format <fmt>", "Output format", FORMATS))
    .action(
      async (
        modelIds: string[],
        options: {
          input?: string;
          output?: string;
          daily?: number;
          monthly?: number;
          profile?: string;
          json?: boolean;
          format?: OutputFormat;
        },
      ) => {
        // A profile supplies the token counts; explicit -i/-o override its values.
        let inputStr = options.input;
        let outputStr = options.output;

        if (options.profile) {
          const profile = getProfile(options.profile);
          if (!profile) {
            const available = Object.keys(listProfiles()).join(", ");
            console.error(`Unknown profile "${options.profile}". Available: ${available}`);
            process.exit(1);
          }
          inputStr ??= profile.input;
          outputStr ??= profile.output;
        }

        if (inputStr == null || outputStr == null) {
          console.error("Provide both -i/--input and -o/--output, or a -P/--profile");
          process.exit(1);
        }

        const inputTokens = parseTokenCount(inputStr);
        const outputTokens = parseTokenCount(outputStr);

        const estimates = await estimateCost({ modelIds, inputTokens, outputTokens });
        const fmt = resolveFormat(options);

        // One projection feeds every format, so JSON and the table always agree.
        const volume = { daily: options.daily, monthly: options.monthly };
        const projected = estimates.map((e) => ({
          ...e,
          ...projectCost(e.total_cost_usd, volume),
        }));

        if (fmt === "json") {
          console.log(JSON.stringify(projected, null, 2));
          return;
        }

        if (fmt === "table") {
          console.log(
            `Cost estimate for ${formatContext(inputTokens)} input + ${formatContext(outputTokens)} output tokens:\n`,
          );
        }

        const hasProjection = projectCost(0, volume) !== null;
        const headers = hasProjection
          ? ["Model", "Input Cost", "Output Cost", "Total", "Daily", "Monthly"]
          : ["Model", "Input Cost", "Output Cost", "Total"];

        const rows = projected.map((e) => {
          const base = [
            e.model,
            formatCost(e.input_cost_usd),
            formatCost(e.output_cost_usd),
            formatCost(e.total_cost_usd),
          ];
          if (hasProjection)
            base.push(formatCost(e.daily_cost_usd), formatCost(e.monthly_cost_usd));
          return base;
        });
        outputFormatted(fmt, headers, rows, projected);
      },
    );

  program
    .command("cheapest")
    .description("Find the cheapest models matching your criteria")
    .addOption(choice("-C, --capability <cap>", "Filter by capability", CAPABILITIES))
    .option("--min-context <n>", "Min context window size", integer)
    .option("-n, --limit <n>", "Max results; 0 = all", integer, 10)
    .option("--json", "Output raw JSON")
    .addOption(choice("--format <fmt>", "Output format", FORMATS))
    .action(
      async (options: {
        capability?: keyof Capabilities;
        minContext?: number;
        limit?: number;
        json?: boolean;
        format?: OutputFormat;
      }) => {
        const models = await cheapestModels({
          capability: options.capability,
          minContext: options.minContext,
          limit: options.limit,
        });

        const fmt = resolveFormat(options);

        if (fmt === "json") {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0 && fmt === "table") {
          console.log("No models found matching your criteria.");
          return;
        }

        outputFormatted(fmt, MODEL_HEADERS, models.map(modelRow), models);
      },
    );

  // --- Info command ---

  program
    .command("info")
    .description("Show detailed information about a model")
    .argument("<model>", "Model ID (supports partial match)")
    .option(
      "--field <names>",
      "Output only these fields, tab-separated (e.g. context_length,output_limit)",
    )
    .option("--json", "Output raw JSON")
    .action(async (modelId: string, options: { field?: string; json?: boolean }) => {
      const model = findModel(await fetchUnifiedModels(), modelId);

      if (options.field) {
        const paths = parseFieldList(options.field);
        const line = formatFields(model, paths);
        if (line === null) {
          fieldsNotFound(model.id, paths);
          process.exit(1);
        }
        console.log(line);
        return;
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

  // --- Resolve command ---

  program
    .command("resolve")
    .description("Resolve a model against the endpoint that actually serves it")
    .argument("<model>", "Model ID as the provider names it (e.g. glm-5.3)")
    .option(
      "-e, --endpoint <url>",
      "Base URL being called (e.g. https://api.z.ai/api/anthropic) — disambiguates resellers",
    )
    .option("-p, --provider <id>", "Provider ID to scope the lookup to (e.g. deepseek)")
    .option(
      "--field <names>",
      "Output only these fields, tab-separated (e.g. context_length,output_limit)",
    )
    .option("--json", "Output raw JSON")
    .action(
      async (
        modelId: string,
        options: { endpoint?: string; provider?: string; field?: string; json?: boolean },
      ) => {
        const result = await resolveModel(modelId, {
          endpoint: options.endpoint,
          provider: options.provider,
        });

        if (!result) {
          console.error(`Model "${modelId}" not found`);
          process.exit(1);
        }

        if (program.opts().verbose) {
          const via = result.endpointProviders.length
            ? `${result.matchedBy} (${result.endpointProviders.join(", ")})`
            : result.matchedBy;
          console.error(`Resolved ${modelId} -> ${result.model.id} via ${via}`);
        }

        if (options.field) {
          const paths = parseFieldList(options.field);
          const line = formatFields(result.model, paths);
          if (line === null) {
            fieldsNotFound(result.model.id, paths);
            process.exit(1);
          }
          console.log(line);
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result.model, null, 2));
          return;
        }

        console.log(bold(result.model.name));
        console.log(dim(result.model.id));
        console.log();
        console.log(`${bold("Provider:")}      ${result.model.provider}`);
        console.log(`${bold("Context:")}       ${formatContext(result.model.context_length)}`);
        if (result.model.output_limit) {
          console.log(`${bold("Output limit:")}  ${formatContext(result.model.output_limit)}`);
        }
        console.log(`${bold("Matched by:")}    ${result.matchedBy}`);
      },
    );

  // --- Latest command ---

  program
    .command("latest")
    .description("Pick the newest flagship and fast model per tier for an endpoint")
    .option(
      "-e, --endpoint <url>",
      "Base URL being called (e.g. https://api.z.ai/api/anthropic) — picks from that provider's catalogue",
    )
    .option("-p, --provider <id>", "Provider ID to pick from (e.g. deepseek)")
    .option(
      "--filter <token>",
      "Only consider ids containing this token or families starting with it (e.g. anthropic/)",
    )
    .addOption(choice("--tier <name>", "Print one tier only", TIERS))
    .option(
      "--field <names>",
      "Output one tab-separated line per tier with these fields (e.g. tier,id,context_length)",
    )
    .option("--json", "Output raw JSON")
    .action(
      async (
        options: {
          endpoint?: string;
          provider?: string;
          filter?: string;
          tier?: Tier;
          field?: string;
          json?: boolean;
        },
        command: Command,
      ) => {
        if (!options.endpoint && !options.provider) {
          command.error("error: one of --endpoint or --provider is required");
        }

        const result = await latestModels({
          endpoint: options.endpoint,
          provider: options.provider,
          filter: options.filter,
        });

        if (!result) {
          const scope = options.endpoint ?? options.provider ?? "";
          const withFilter = options.filter ? ` (filter: ${options.filter})` : "";
          console.error(`No eligible model for ${scope}${withFilter}`);
          process.exit(1);
        }

        if (program.opts().verbose) {
          const summary = result.picks.map((pick) => `${pick.tier}=${pick.model.id}`).join(" ");
          const via = result.endpointProviders.length
            ? `${result.provider} (${result.endpointProviders.join(", ")})`
            : result.provider;
          console.error(`Picked ${summary} via ${via}`);
        }

        const picks = options.tier
          ? result.picks.filter((pick) => pick.tier === options.tier)
          : result.picks;

        if (options.field) {
          const paths = parseFieldList(options.field);
          const lines = picks.map((pick) =>
            formatFields({ ...pick.model, tier: pick.tier } as UnifiedModel, paths),
          );
          if (lines.every((line) => line === null)) {
            fieldsNotFound(picks[0]?.model.id ?? result.provider, paths);
            process.exit(1);
          }
          for (const line of lines) if (line !== null) console.log(line);
          return;
        }

        if (options.json) {
          console.log(JSON.stringify({ provider: result.provider, picks }, null, 2));
          return;
        }

        console.log(`${bold("Provider:")}  ${result.provider}`);
        for (const pick of picks) {
          const output = pick.model.output_limit
            ? `, ${formatContext(pick.model.output_limit)} out`
            : "";
          console.log(
            `${bold(`${pick.tier}:`.padEnd(8))} ${pick.model.id} ${dim(`(${formatContext(pick.model.context_length)} context${output})`)}`,
          );
        }
      },
    );

  // --- Recommend command ---

  program
    .command("recommend")
    .description("Get model recommendations for a use case")
    .addArgument(new Argument("[use-case]", "Use case").choices(Object.keys(listUseCases())))
    .option("--max-cost <n>", "Max input cost budget ($/M tokens)", decimal)
    .option("--min-context <n>", "Min context window", integer)
    .option("-n, --limit <n>", "Max results; 0 = all", integer, 10)
    .option("--list", "List available use cases")
    .option("--json", "Output raw JSON")
    .addOption(choice("--format <fmt>", "Output format", FORMATS))
    .action(
      async (
        useCase: string | undefined,
        options: {
          maxCost?: number;
          minContext?: number;
          limit?: number;
          list?: boolean;
          json?: boolean;
          format?: OutputFormat;
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

        if (fmt === "table") {
          console.log(`${bold("Use case:")} ${useCase} — ${result.preset.description}\n`);
          if (result.models.length === 0) {
            console.log("No models found matching this use case.");
            return;
          }
        }

        outputFormatted(fmt, MODEL_HEADERS, result.models.map(modelRow), result.models);
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
    .description("Show model changes since the previous diff run")
    .option("--json", "Output raw JSON")
    .action(async (options: { json?: boolean }) => {
      const diff = await diffModels();

      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
        return;
      }

      if (!diff.timestamp_previous) {
        console.log(`Baseline saved: ${diff.total_after} models.`);
        console.log("Run `llm-models diff` again later to see what changed since now.");
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
        if (diff.removed.length > 20) console.log(`  ... and ${diff.removed.length - 20} more`);
      }

      if (diff.price_changes.length > 0) {
        console.log(`\n${yellow(`~ ${diff.price_changes.length} price changes:`)}`);
        for (const c of diff.price_changes.slice(0, 20)) {
          const oldVal = formatCostRaw(c.old_value == null ? null : Number(c.old_value));
          const newVal = formatCostRaw(c.new_value == null ? null : Number(c.new_value));
          console.log(`  ${c.model_id} ${c.field}: ${oldVal} → ${newVal}`);
        }
        if (diff.price_changes.length > 20) {
          console.log(`  ... and ${diff.price_changes.length - 20} more`);
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
    .addArgument(new Argument("[action]", "Action").choices(["info", "clear"]).default("info"))
    .action((action: "info" | "clear") => {
      if (action === "clear") {
        clearCache();
      } else {
        const info = getCacheInfo();
        console.log(`Cache directory: ${getCacheDir()}`);
        console.log(`Enabled: ${isCacheEnabled() ? "yes" : "no"}`);
        console.log(`TTL: ${Math.round(getCacheTtl() / 1000)}s`);
        console.log(`Files: ${info.files}`);
        console.log(`Size: ${(info.sizeBytes / 1024).toFixed(1)} KB`);
        console.log(`\nUse ${cyan("llm-models cache clear")} to clear.`);
      }
    });

  // --- Config command ---

  program
    .command("config")
    .description("Manage configuration")
    .addArgument(
      new Argument("[action]", "Action")
        .choices(["show", "init", "path", "profiles"])
        .default("show"),
    )
    .action((action: "show" | "init" | "path" | "profiles") => {
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
    .addArgument(new Argument("<shell>", "Shell").choices(["bash", "zsh", "fish"]))
    .action((shell: "bash" | "zsh" | "fish") => {
      switch (shell) {
        case "bash":
          console.log(generateBashCompletion(program));
          break;
        case "zsh":
          console.log(generateZshCompletion(program));
          break;
        case "fish":
          console.log(generateFishCompletion(program));
          break;
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

  return program;
}

export function runCommand(): void {
  // Async actions reject outside parse()'s call stack, so failures (unknown
  // use case, network errors) would surface as raw unhandled rejections.
  createProgram()
    .parseAsync()
    .catch((err: unknown) => {
      console.error(red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    });
}
