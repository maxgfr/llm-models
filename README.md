# llm-models

Fetch latest LLM models from [OpenRouter](https://openrouter.ai) and [models.dev](https://models.dev) APIs.

Validates API responses with [Zod](https://zod.dev) schemas to detect breaking changes. Provides smart wrapper functions for model discovery, comparison, cost estimation, recommendations, statistics, and provider info. Features local caching, MCP server integration, multiple output formats, and a fluent query builder API.

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

# Filter by family
llm-models find -f gpt --sort cost_input

# Filter by status
llm-models find --status active -C reasoning

# Search by name
llm-models find -s "claude" --sort cost_input

# Sort by cost-effectiveness (context per dollar)
llm-models find --sort value --desc -n 10

# Count matching models
llm-models find -C reasoning --count

# Output IDs only (for piping)
llm-models find -p openai --ids-only

# Output as CSV or Markdown
llm-models find -p anthropic --format csv
llm-models find -p anthropic --format markdown

# Output as JSON
llm-models find -p google --json
```

#### Compare models

Side-by-side model comparison with context, output limit, costs, knowledge cutoff, and capabilities:

```bash
llm-models compare openai/gpt-4o anthropic/claude-sonnet-4 google/gemini-2.0-flash
```

#### Model info

Detailed information about a single model (description, costs, capabilities, parameters, tokenizer):

```bash
llm-models info openai/gpt-4o
```

#### Cost estimation

Estimate costs for specific token volumes:

```bash
# Basic cost estimation
llm-models cost openai/gpt-4o anthropic/claude-sonnet-4 -i 1M -o 100K

# With daily/monthly projections
llm-models cost openai/gpt-4o -i 1M -o 100K --daily 1000

# Using a workload profile
llm-models cost openai/gpt-4o -i 1K -o 1K -P chatbot --daily 5000
```

#### Cheapest models

Find the cheapest models matching your criteria:

```bash
llm-models cheapest -C reasoning --min-context 100000
```

#### Recommendations

Get model recommendations for a specific use case:

```bash
# List available use cases
llm-models recommend --list

# Get recommendations
llm-models recommend reasoning
llm-models recommend code-gen --max-cost 5
llm-models recommend vision -n 5
```

Available use cases: `code-gen`, `vision`, `cheap-chatbot`, `reasoning`, `long-context`, `open-source`, `audio`, `tool-use`.

#### Statistics

Get aggregate statistics about the LLM model landscape:

```bash
llm-models stats
llm-models stats --json
```

Shows: total models/providers, top providers, capabilities distribution, modality distribution, cost percentiles, context length stats, newest models.

#### Diff

Show changes since last cached fetch:

```bash
llm-models diff
```

Shows: new models added, models removed, price changes, status changes.

#### Provider info

Get provider details (SDK package, env vars, API endpoint, models):

```bash
# List all providers
llm-models provider --list

# Get details for a specific provider
llm-models provider openai
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

### Utility Commands

#### Cache management

```bash
llm-models cache              # Show cache info
llm-models cache clear        # Clear cache
```

API responses are cached for 1 hour in `~/.cache/llm-models/`. Use `--no-cache` to bypass.

#### Configuration

```bash
llm-models config             # Show current config
llm-models config init        # Create default config file
llm-models config path        # Show config file path
llm-models config profiles    # List workload profiles
```

Config file locations: `.llm-modelsrc` (project) or `~/.config/llm-models/config.json` (global).

#### Shell completions

```bash
# Bash
llm-models completion bash >> ~/.bashrc

# Zsh
llm-models completion zsh >> ~/.zshrc

# Fish
llm-models completion fish > ~/.config/fish/completions/llm-models.fish
```

#### MCP Server

Start an MCP (Model Context Protocol) server for AI agent integration:

```bash
llm-models mcp
```

Exposes 8 tools: `find_models`, `compare_models`, `estimate_cost`, `cheapest_models`, `get_provider`, `list_providers`, `get_stats`, `recommend_models`.

### Global Options

| Option | Description |
|--------|-------------|
| `--no-cache` | Disable cache for this request |
| `--quiet` | Suppress informational messages |
| `--verbose` | Show debug info (timing, cache status) |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

### Find Options

| Option | Description |
|--------|-------------|
| `-p, --provider <id>` | Filter by provider |
| `-C, --capability <cap>` | Filter: reasoning, tool_call, structured_output, open_weights, attachment |
| `-m, --modality <mod>` | Filter by input modality (image, audio, video, pdf) |
| `--max-cost <n>` | Max input cost ($/million tokens) |
| `--max-cost-output <n>` | Max output cost ($/million tokens) |
| `--min-context <n>` | Min context window |
| `-s, --search <term>` | Search by name or ID |
| `--status <status>` | Filter: active, beta, deprecated |
| `-f, --family <name>` | Filter by model family (e.g. gpt, claude, gemini) |
| `--sort <field>` | Sort: cost_input, cost_output, context_length, release_date, name, knowledge_cutoff, value |
| `--desc` | Sort descending |
| `-n, --limit <n>` | Max results (default: 20) |
| `-c, --count` | Show model count only |
| `--ids-only` | Output model IDs only, one per line |
| `--json` | Raw JSON output |
| `--format <fmt>` | Output format: table, json, csv, markdown |

### Cost Options

| Option | Description |
|--------|-------------|
| `-i, --input <n>` | Input tokens (supports K/M suffix) |
| `-o, --output <n>` | Output tokens (supports K/M suffix) |
| `--daily <n>` | Number of daily requests for cost projection |
| `--monthly <n>` | Number of monthly requests for cost projection |
| `-P, --profile <name>` | Use workload profile (chatbot, code-gen, rag, summarization, translation) |

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
  getStats,
  recommendModels,
  listUseCases,
  diffModels,
  query,
  setCacheEnabled,
  clearCache,
} from "llm-models";

// Get all models (unified from both APIs)
const models = await fetchUnifiedModels();

// Find cheapest reasoning models
const cheap = await findModels({
  filter: { capability: "reasoning" },
  sort: "cost_input",
  limit: 5,
});

// Fluent query builder
const results = await query()
  .provider("openai")
  .capability("reasoning")
  .maxCost(5)
  .sortBy("cost_input")
  .limit(10)
  .execute();

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

// Get recommendations for a use case
const recs = await recommendModels("code-gen", { maxCost: 5, limit: 5 });

// Get market statistics
const stats = await getStats();

// Detect changes since last fetch
const diff = await diffModels();

// Cache control
setCacheEnabled(false); // Disable caching
clearCache();           // Clear cache directory
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
import type {
  UnifiedModel,
  NormalizedCost,
  Capabilities,
  ProviderInfo,
  ModelFilter,
  ModelSortField,
  CostEstimate,
  ModelComparison,
} from "llm-models";
```

## GitHub Action

Use llm-models in CI/CD to check model costs and status:

```yaml
- uses: maxgfr/llm-models@v1
  with:
    command: cost
    args: "openai/gpt-4o anthropic/claude-sonnet-4 -i 1M -o 100K"
    max-budget: "10"
    fail-on-deprecated: "true"
```

## Data Sources

- **OpenRouter**: https://openrouter.ai/api/v1/models
- **models.dev**: https://models.dev/api.json

## License

MIT
