# llm-models

Fetch latest LLM models from [OpenRouter](https://openrouter.ai) and [models.dev](https://models.dev) APIs.

Validates API responses with [Zod](https://zod.dev) schemas to detect breaking changes. Provides smart wrapper functions for model discovery, comparison, cost estimation, and provider info.

## Installation

### Homebrew

```bash
brew install maxgfr/tap/llm-models
```

### npm

```bash
npm install -g llm-models
```

### Binary

Download the latest binary from [GitHub Releases](https://github.com/maxgfr/llm-models/releases).

| Platform | Binary |
|----------|--------|
| macOS ARM64 | `llm-models-macos-arm64` |
| macOS Intel | `llm-models-macos-x64` |
| Linux x86_64 | `llm-models-linux-x64` |
| Linux ARM64 | `llm-models-linux-arm64` |
| Windows x64 | `llm-models-win-x64.exe` |

## CLI Usage

### Smart Commands

#### Find models

Discover models across both APIs with smart filtering:

```bash
# Find cheapest reasoning models
llm-models find -C reasoning --sort cost_input -n 10

# Find models accepting images, sorted by cost
llm-models find -m image --sort cost_input

# Find OpenAI models with large context
llm-models find -p openai --min-context 200000

# Search by name
llm-models find -s "claude" --sort cost_input

# Output as JSON
llm-models find -p google --json
```

#### Compare models

Side-by-side model comparison:

```bash
llm-models compare openai/gpt-4o anthropic/claude-sonnet-4 google/gemini-2.0-flash
```

#### Provider info

Get provider details (SDK package, env vars, API endpoint, models):

```bash
# List all providers
llm-models provider --list

# Get details for a specific provider
llm-models provider openai
```

#### Cost estimation

Estimate costs for specific token volumes:

```bash
llm-models cost openai/gpt-4o anthropic/claude-sonnet-4 -i 1M -o 100K
```

### Raw API Commands

#### OpenRouter

```bash
llm-models openrouter                     # All models (JSON)
llm-models openrouter --provider google   # Filter by provider
llm-models openrouter --search "claude"   # Search
llm-models openrouter --count             # Count only
```

#### models.dev

```bash
llm-models models-dev                     # All providers (JSON)
llm-models models-dev --provider openai   # Filter by provider
llm-models models-dev --count             # Count only
```

### Options

| Command | Option | Description |
|---------|--------|-------------|
| `find` | `-p, --provider <id>` | Filter by provider |
| `find` | `-C, --capability <cap>` | Filter: reasoning, tool_call, structured_output, open_weights, attachment |
| `find` | `-m, --modality <mod>` | Filter by input modality (image, audio, video, pdf) |
| `find` | `--max-cost <n>` | Max input cost ($/million tokens) |
| `find` | `--min-context <n>` | Min context window |
| `find` | `--sort <field>` | Sort: cost_input, cost_output, context_length, release_date, name |
| `find` | `--desc` | Sort descending |
| `find` | `-n, --limit <n>` | Max results (default: 20) |
| `compare` | `<models...>` | Model IDs to compare (at least 2) |
| `provider` | `[id]` | Provider ID |
| `provider` | `--list` | List all providers |
| `cost` | `<models...>` | Model IDs |
| `cost` | `-i, --input <n>` | Input tokens (supports K/M suffix) |
| `cost` | `-o, --output <n>` | Output tokens (supports K/M suffix) |
| All | `--json` | Raw JSON output |
| All | `-V, --version` | Show version |
| All | `-h, --help` | Show help |

## Library Usage

```typescript
import {
  fetchUnifiedModels,
  findModels,
  compareModels,
  getProvider,
  listProviders,
  estimateCost,
  cheapestModels,
} from "llm-models";

// Get all models (unified from both APIs)
const models = await fetchUnifiedModels();

// Find cheapest reasoning models
const cheap = await findModels({
  filter: { capability: "reasoning" },
  sort: "cost_input",
  limit: 5,
});

// Compare models side by side
const comparison = await compareModels(["openai/gpt-4o", "anthropic/claude-sonnet-4"]);

// Get provider info (SDK, env vars, docs, models)
const openai = await getProvider("openai");
console.log(openai.npm); // "@ai-sdk/openai"

// Estimate costs
const costs = await estimateCost({
  modelIds: ["openai/gpt-4o"],
  inputTokens: 1_000_000,
  outputTokens: 100_000,
});
```

### Raw API Access

```typescript
import { fetchOpenRouterModels, fetchModelsDevModels } from "llm-models";

const openrouter = await fetchOpenRouterModels();
const modelsDev = await fetchModelsDevModels();
```

### Zod Schemas

All schemas are exported for custom validation:

```typescript
import { UnifiedModelSchema, OpenRouterResponseSchema, ModelsDevResponseSchema } from "llm-models";
```

### Types

All types are inferred from Zod schemas:

```typescript
import type { UnifiedModel, ProviderInfo, ModelFilter, CostEstimate } from "llm-models";
```

## Data Sources

- **OpenRouter**: https://openrouter.ai/api/v1/models
- **models.dev**: https://models.dev/api.json

## License

MIT
