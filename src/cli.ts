import { Command } from "commander";
import { fetchModelsDevModels } from "./clients/models-dev";
import { fetchOpenRouterModels } from "./clients/openrouter";

const pkg = require("../package.json");

export function runCommand(): void {
  const program = new Command();

  program
    .name("llm-models")
    .description("Fetch latest LLM models from OpenRouter and models.dev")
    .version(pkg.version);

  program
    .command("openrouter")
    .description("Fetch models from OpenRouter API")
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
    .description("Fetch models from models.dev API")
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

  program.parse();
}
