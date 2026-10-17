# llm-models

Fetch latest LLM models from [OpenRouter](https://openrouter.ai) and [models.dev](https://models.dev) APIs.

Validates API responses with [Zod](https://zod.dev) schemas to detect breaking changes. Provides smart wrapper functions for model discovery, comparison, cost estimation, recommendations, statistics, and provider info. Features local caching, MCP server integration, multiple output formats, and a fluent query builder API. The library also runs in the browser, can tell which providers a web page may call directly (CORS), and can pick the best model a device can run itself on WebGPU (WebLLM).

## Installation

### Homebrew

```bash
brew install maxgfr/tap/llm-models
```

### npm

Requires Node.js >= 22.12.

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

Table and Markdown output stop at 20 rows (or `defaults.limit` from the config) and the table ends
with `(20 of N models shown, -n 0 to show all)`. JSON, CSV, `--count`, `--ids-only` and `--field`
return every match unless you pass `-n`. `-m/--modality` matches what a model *accepts*: `-m image`
finds models that read images, not image generators.

#### Compare models

Side-by-side model comparison with context, output limit, costs, knowledge cutoff, and capabilities:

```bash
llm-models compare openai/gpt-4o anthropic/claude-sonnet-4 google/gemini-2.0-flash
llm-models compare gpt-4o claude-sonnet-4-5    # bare ids work too
```

#### Model info

Detailed information about a single model (description, costs, capabilities, parameters, tokenizer):

```bash
llm-models info openai/gpt-4o
llm-models info gpt-4o
```

`info`, `compare` and `cost` look models up the same way. An exact id, an exact trailing segment
(`gpt-4o`) or either one case-insensitively wins outright, even when dozens of other ids contain the
text; ties go to the vendor's own entry. OpenRouter's spelling of a merged model
(`anthropic/claude-sonnet-4.5`) works too. A plain substring of an id or name is accepted only when a
single model matches; otherwise the command lists up to 10 candidates and exits 1.

#### Resolve a model against its endpoint

The same model id is published under dozens of providers with different limits — OpenRouter routes
`deepseek-chat` at 163,840 context while DeepSeek's own API serves 1,000,000. `resolve` takes the
base URL you actually call and answers for *that* endpoint:

```bash
# Z.AI coding plan, not the OpenRouter reseller entry
llm-models resolve glm-5.3 --endpoint https://api.z.ai/api/anthropic

# Scope by provider id instead
llm-models resolve deepseek-chat --provider deepseek
```

The endpoint is matched against each provider's documented API host first. Vendors that document no
API URL on models.dev (Anthropic, OpenAI, Google, xAI, Mistral, ...) are matched by name in the host
instead, so `--endpoint https://api.anthropic.com` answers with `anthropic/claude-sonnet-5` rather
than a reseller's copy. Without `--endpoint` or `--provider`, ties between identical ids go to the
vendor's own entry.

Exits 1 when nothing matches, so it composes in scripts.

#### Pick the latest model per tier

`latest` answers "which model should I be on?" for an endpoint: the newest flagship of the current
generation (`opus`) and its fast sibling (`sonnet` and `haiku`), out of the provider's own catalogue.
Batch and free routes, moving `~vendor/…` aliases, deprecated entries, models that cannot call tools
and vision / speech / preview / experimental variants are left out:

```bash
llm-models latest --endpoint https://api.z.ai/api/anthropic
# Provider:  zai
# opus:    zai/glm-5.3 (1M context, 131.1K out)
# sonnet:  zai/glm-5.3-flash (1M context, 131.1K out)
# haiku:   zai/glm-5.3-flash (1M context, 131.1K out)

# One tab-separated line per tier, for scripts
llm-models latest --endpoint https://api.z.ai/api/anthropic \
  --field tier,id,context_length,output_limit
# opus	zai/glm-5.3	1000000	131072
# sonnet	zai/glm-5.3-flash	1000000	131072
# haiku	zai/glm-5.3-flash	1000000	131072

# Narrow a multi-vendor catalogue; Claude tiers map literally
llm-models latest --endpoint https://openrouter.ai/api --filter anthropic/ --tier sonnet --field id
# openrouter/anthropic/claude-sonnet-5
```

A fast variant only pairs with a flagship of the same major version, so a generation that ships
no fast model answers with the flagship on every tier. `--filter` keeps ids containing the token
(or families starting with it); `--tier` prints one tier; `--json` prints `{ provider, picks }`.
One of `--endpoint` or `--provider` is required, and the command exits 1 when nothing is eligible.

#### Script-friendly output (`--field`)

`info`, `find`, `resolve` and `latest` accept `--field` to print bare, tab-separated values instead of a
formatted block — no JSON parsing needed. Dotted paths work. A field missing on one model renders
as an empty column; when every requested field is missing the command explains on stderr and exits 1:

```bash
llm-models info z-ai/glm-5.3 --field context_length
# 1048576

llm-models resolve glm-5.3 --endpoint https://api.z.ai/api/anthropic \
  --field context_length,output_limit
# 1000000	131072

llm-models find -p anthropic --field id,cost.input
```

#### Cost estimation

Estimate costs for specific token volumes:

```bash
# Basic cost estimation
llm-models cost openai/gpt-4o anthropic/claude-sonnet-4 -i 1M -o 100K

# With daily/monthly projections
llm-models cost openai/gpt-4o -i 1M -o 100K --daily 1000

# Using a workload profile (supplies -i/-o; pass either flag to override it)
llm-models cost openai/gpt-4o -P chatbot --daily 5000
```

Costs from $0.01 up show cents; smaller amounts keep two significant digits (`$0.0015`), so only
a genuinely free request reads `$0.00`. `--daily` implies a monthly figure (×30) and `--monthly` a
daily one (÷30); given both, each is used as stated. JSON and table output always agree.

#### Cheapest models

Find the cheapest models matching your criteria:

```bash
llm-models cheapest -C reasoning --min-context 100000
```

`cheapest` and `recommend` never suggest a deprecated model.

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

#### Models that run in the browser

List the models WebLLM runs on WebGPU inside a page, and pick the best one a device can hold
(see [Browser models](#browser-models-webgpu) for where the data comes from and how the pick is
ranked):

```bash
# Every prebuilt WebLLM model: family, size, quantization, VRAM, download, context, score
llm-models browser-models
llm-models local --family qwen          # `local` is an alias

# The best chat model for 3 GB of GPU memory, with the reason and runner-ups
llm-models local --recommend --vram 3000

# Constraints: download budget, abilities, no shader-f16, phone-class models only
llm-models local --recommend --vram 4000 --download 2000 --need multilingual,json
llm-models local --recommend --vram 4000 --no-shader-f16 --low-resource --json
```

| Option | Description |
|--------|-------------|
| `--recommend` | Pick the best model for `--vram`; exits 1 when nothing fits |
| `--vram <mb>` | GPU memory budget in MB (with `--recommend`), or a VRAM filter for the list |
| `--download <mb>` | Largest acceptable weight download in MB |
| `--need <needs>` | `json`, `multilingual`, `reasoning`, `long_context` (comma-separated or repeated) |
| `--no-shader-f16` | The WebGPU adapter lacks `shader-f16`: only f32-compute (`q4f32`) models |
| `--low-resource` | Only models WebLLM marks `low_resource_required` |
| `--family <name>` | List only this family (qwen, llama, gemma, phi, smollm, mistral…) |
| `--json` / `--format <fmt>` | Output format |

#### Statistics

Get aggregate statistics about the LLM model landscape:

```bash
llm-models stats
llm-models stats --json
```

Shows: total models/providers, top providers, capabilities distribution, modality distribution, cost percentiles, context length stats, newest models.

#### Diff

Show what changed since the previous `diff` run:

```bash
llm-models diff   # first run: saves a baseline
llm-models diff   # later: changes since the run above
```

Shows: new models added, models removed, price changes, status changes. `diff` keeps its own
snapshot (`snapshot.json` in the cache directory), so other commands refreshing the API cache never
reset the baseline. With `--no-cache` it compares but does not save a new snapshot.

#### Provider info

Get provider details (SDK package, env vars, API endpoint, models):

```bash
# List all providers
llm-models provider --list

# Get details for a specific provider
llm-models provider openai

# Can a web page call the provider directly? (CORS probe, see below)
llm-models provider --list --browser
llm-models provider --browser-only --origin https://app.example.com
llm-models provider anthropic --browser
# Browser: yes (from https://example.com, send anthropic-dangerous-direct-browser-access: true)
```

`--browser` probes each provider's API the way a browser would before a page calls it (see
[Browser-callable providers](#browser-callable-providers)) and adds a `Browser` column (`yes`,
`yes, with header`, `no`), or a `browser` object in JSON. `--browser-only` keeps the callable ones,
and `--origin` sets the page origin the probe announces (default `https://example.com`). Verdicts
are cached like API responses; probing every provider takes about 20 seconds.

#### Slim catalog for a web app

Build the provider/model list a settings form ships (e.g. `public/models.json`), once, at build
time or from a scheduled job:

```bash
llm-models catalog --npm callable --require openai,anthropic,google,mistral --out public/models.json
llm-models catalog --npm @ai-sdk/openai,@ai-sdk/openai-compatible   # JSON on stdout
```

Each provider carries `id`, `name`, `npm` (the AI SDK package), `api` (base URL; documented
defaults are filled for openai, anthropic, google, mistral…) and `defaultModel` (the balanced pick
of `latest`), and each model only `id`, `name`, `tool_call` and `reasoning`. Deprecated models are
left out, as are providers using the generic `@ai-sdk/openai-compatible` SDK without a URL, and
providers whose base URL a page cannot call as listed: templated (`{`, `${`, `<`), plain `http`, or
a loopback or private host (localhost, 127.0.0.0/8, ::1, 10/8, 172.16/12, 192.168/16, `*.local`).
Local servers such as LM Studio belong to a client's custom-endpoint presets.

When `--npm` lists `@ai-sdk/openai-compatible` (as `callable` does) but not a provider's own SDK,
providers whose API is OpenAI-compatible are kept through the generic SDK, with that endpoint as
`api`: Cerebras, Cohere (its [compatibility API](https://docs.cohere.com/docs/compatibility-api)),
DeepInfra, Groq, OpenRouter, Perplexity, Together AI and xAI (`OPENAI_COMPATIBLE_SDKS` in
`src/functions/catalog.ts`, each base URL cited and probed for CORS).

| Option | Effect |
|--------|--------|
| `--npm <packages>` | Keep providers called through these SDKs; `callable` stands for the five [llm-connect](https://github.com/maxgfr/llm-models/tree/main/packages/llm-connect) calls, OpenAI-compatible providers included |
| `--require <ids>` | Exit 1 unless these providers end up in the catalog |
| `--keep-deprecated` | Keep deprecated models |
| `--no-default-model` | Leave `defaultModel` out |
| `--no-default-api` | Do not fill a missing `api` |
| `-o, --out <file>` | Write the file, only when its content changes, instead of printing |

The client side reads it with [`llm-models/catalog`](#slim-catalog-entry).

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

API responses are cached for 1 hour (configurable, see below) in `~/.cache/llm-models/`. Use
`--no-cache` to bypass, and `--verbose` to see each source's hit/miss and age on stderr. Requests
time out after 15 seconds. When an API is down, an expired cached copy is used if there is one;
otherwise the command carries on with the other source and says so on stderr. A read-only cache
directory never fails a command.

#### Configuration

```bash
llm-models config             # Show current config
llm-models config init        # Create default config file
llm-models config path        # Show config file path
llm-models config profiles    # List workload profiles
```

Config file locations: `.llm-modelsrc` (project) or `~/.config/llm-models/config.json` (global).
The file is validated; an invalid one is reported on stderr and ignored.

```json
{
  "cache": { "enabled": true, "ttl": 3600000 },
  "defaults": { "format": "table", "limit": 20, "sort": "cost_input", "desc": false },
  "profiles": { "batch": { "input": "200K", "output": "20K" } }
}
```

| Key | Effect |
|-----|--------|
| `cache.enabled` | `false` disables the cache like `--no-cache` |
| `cache.ttl` | Freshness of cached API responses, in milliseconds |
| `defaults.format` | Output format when neither `--json` nor `--format` is given |
| `defaults.limit` | `find` rows in table/Markdown output (`0` = all) |
| `defaults.sort` / `defaults.desc` | `find` sort when `--sort` / `--desc` are absent |
| `profiles` | Extra workload profiles for `cost -P` |

#### Shell completions

```bash
# Bash
llm-models completion bash >> ~/.bashrc

# Zsh
llm-models completion zsh >> ~/.zshrc

# Fish
llm-models completion fish > ~/.config/fish/completions/llm-models.fish
```

The scripts are generated from the CLI definition: every command and option, plus the allowed
values of enum options (capabilities, sort fields, statuses, formats, tiers, use cases, profiles).

#### MCP Server

Start an MCP (Model Context Protocol) server for AI agent integration:

```bash
llm-models mcp
```

Exposes 11 tools:

| Tool | Purpose |
|------|---------|
| `find_models` | Filter (provider, capability, modality, cost, context, search, status, family) and sort; 20 results by default |
| `get_model` | One model's details, looked up like `info` |
| `resolve_model` | A model as served by an endpoint or provider, like `resolve` |
| `latest_models` | Newest flagship and fast model per tier, like `latest` |
| `compare_models` | Side-by-side comparison |
| `estimate_cost` | Token cost estimates |
| `cheapest_models` | Cheapest non-deprecated models |
| `recommend_models` | Non-deprecated recommendations for a use case |
| `get_provider` | Provider details and models |
| `list_providers` | Providers with model counts (without their model lists) |
| `get_stats` | Market statistics |

Enum parameters (capability, status, sort, use case) are validated, so a typo is an error rather
than an empty result.

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
| `-m, --modality <mod>` | Filter by input modality (image, audio, video, pdf); output modalities are ignored |
| `--max-cost <n>` | Max input cost ($/million tokens) |
| `--max-cost-output <n>` | Max output cost ($/million tokens) |
| `--min-context <n>` | Min context window |
| `-s, --search <term>` | Search by name or ID |
| `--status <status>` | Filter: active, deprecated, beta, alpha |
| `-f, --family <name>` | Filter by model family (e.g. gpt, claude, gemini) |
| `--sort <field>` | Sort: cost_input, cost_output, context_length, release_date, name, knowledge_cutoff, value |
| `--desc` | Sort descending (models without a value for the field always sort last); needs `--sort` or `defaults.sort` |
| `-n, --limit <n>` | Max results; `0` = all (default: 20 in table/Markdown output, all otherwise) |
| `-c, --count` | Show model count only |
| `--ids-only` | Output model IDs only, one per line |
| `--field <names>` | Output only these fields, tab-separated, one line per model |
| `--json` | Raw JSON output |
| `--format <fmt>` | Output format: table, json, csv, markdown |

### Resolve Options

| Option | Description |
|--------|-------------|
| `-e, --endpoint <url>` | Base URL being called — disambiguates resellers by host |
| `-p, --provider <id>` | Provider ID to scope the lookup to |
| `--field <names>` | Output only these fields, tab-separated |
| `--json` | Raw JSON output |

### Provider Options

| Option | Description |
|--------|-------------|
| `--list` | List all providers with model counts |
| `--browser` | Probe whether a web page can call the provider directly (CORS) |
| `--browser-only` | List only providers a web page can call directly (implies `--browser`) |
| `--origin <url>` | Page origin the browser probe announces (default `https://example.com`) |
| `--json` / `--format <fmt>` | Output format |

### Cost Options

| Option | Description |
|--------|-------------|
| `-i, --input <n>` | Input tokens (supports K/M suffix); required unless `-P` is given |
| `-o, --output <n>` | Output tokens (supports K/M suffix); required unless `-P` is given |
| `--daily <n>` | Daily requests for the projection (monthly = ×30 unless `--monthly` is given) |
| `--monthly <n>` | Monthly requests for the projection (daily = ÷30 unless `--daily` is given) |
| `-P, --profile <name>` | Use workload profile (chatbot, code-gen, rag, summarization, translation) instead of `-i`/`-o` |

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
  findModel,
  resolveModel,
  latestModels,
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

// Look one model up the way `info` does (throws "not found" / "Ambiguous")
const gpt4o = findModel(models, "gpt-4o"); // openai/gpt-4o

// Resolve a model against the endpoint that actually serves it
const resolved = await resolveModel("glm-5.3", {
  endpoint: "https://api.z.ai/api/anthropic",
});
// resolved.model.context_length === 1_000_000, resolved.matchedBy === "endpoint"

// Newest flagship and fast model per tier for that endpoint
const latest = await latestModels({ endpoint: "https://api.z.ai/api/anthropic" });
// latest.picks -> [{ tier: "opus", model: glm-5.3 }, { tier: "sonnet", model: glm-5.3-flash }, ...]

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

// ...and whether a web page can call it directly (see "Browser-callable providers")
const { browser } = await getProvider("openai", { browser: true });

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

// Detect changes since the previous diffModels() call (saves a new snapshot)
const diff = await diffModels();

// Cache control
setCacheEnabled(false); // Disable caching
clearCache();           // Clear the cache (directory on Node, memory in a browser)
```

### Browser-callable providers

```typescript
import { listProviders, probeBrowserSupport, providerBaseUrl } from "llm-models";

// Every provider, each with a `browser` verdict (probes run 8 at a time)
const providers = await listProviders({ browser: { origin: "https://app.example.com" } });
const callable = providers.filter((p) => p.browser?.callable);

// One provider: a models.dev / ProviderInfo entry, or a bare id
const anthropic = await probeBrowserSupport("anthropic", { origin: "https://app.example.com" });
// {
//   callable: true,
//   required_headers: { "anthropic-dangerous-direct-browser-access": "true" },
//   origin: "https://app.example.com",
//   url: "https://api.anthropic.com/v1/messages",
//   evidence: "preflight",
//   checked_at: "2026-10-14T12:00:00.000Z"
// }

// Where to call a provider: its models.dev `api`, else a known default
providerBaseUrl({ id: "openai" }); // "https://api.openai.com/v1"
```

`probeBrowserSupport(provider, { origin, fetch, timeoutMs, now })` sends the CORS preflight a browser
sends before an authenticated JSON `POST` to the provider's chat endpoint
(`/chat/completions`, Anthropic's `/messages`, Gemini's `:generateContent`, Cohere's `/chat`, picked
from the provider's AI SDK package). It needs no API key. The provider is `callable` when the
preflight answers 2xx, `Access-Control-Allow-Origin` is `*` or the origin, and
`Access-Control-Allow-Headers` covers every header the call sends (`Authorization` or the
provider's key header, and `Content-Type`). When the preflight is refused, a simple `GET <base>/models`
records in `reason` whether the API sends CORS headers at all; the verdict stays `false`.
`evidence` says what the verdict rests on: `preflight`, `get`, or `none` (no known base URL, a
per-account URL, or a network failure). Inject `fetch` to test or proxy it.

`required_headers` lists headers the page must add. Anthropic answers a page only when it sends
`anthropic-dangerous-direct-browser-access: true` (what its SDK sends with `dangerouslyAllowBrowser`);
its preflight allows the header either way, so this one comes from a table, checked against the live
API. `DEFAULT_BASE_URLS` gives the base URL of the providers models.dev lists without an `api`
(OpenAI, Anthropic, Google, Mistral, Groq, xAI, DeepInfra, Cerebras, Together AI, Cohere,
Perplexity), so they can be probed and called too.

What a `callable: true` does and does not mean:

- **The key is exposed.** A page that calls a provider directly holds the user's API key in the
  browser, where any script on that page, browser extensions and the user can read it. Only do it
  when the key is the user's own (bring your own key) and they chose to paste it, never with a key
  of yours.
- **It is a snapshot.** Providers change their CORS rules; `checked_at` dates the verdict. Re-probe
  rather than ship a stale list.
- **It covers the preflight.** Some APIs omit CORS headers on error responses (Cerebras' `401`, for
  one), so the call works but a page cannot read why it failed.
- **The origin matters** for APIs that echo an allow-list rather than `*`; probe with your page's
  real origin.
- **Run it outside the page.** A browser never lets a page send a preflight or set `Origin`
  itself: probe from a build step, server or the CLI, and ship the result.

### Browser usage

The package imports cleanly in a browser bundle. Bundlers that honour the `browser` condition
(Vite, webpack, esbuild, Bun) pick `build/browser.js` for
`import ... from "llm-models"`; `llm-models/browser` names it explicitly. It has the same exports
as the Node entry and no Node.js builtin; models.dev and OpenRouter both allow cross-origin
requests, so the data loads from the page:

```typescript
import { fetchUnifiedModels, findModel } from "llm-models";

const models = await fetchUnifiedModels(); // fetched from the page, cached in memory
const gpt = findModel(models, "gpt-4o");
```

In the browser the cache lives in memory for the life of the page, there is no config file
(`loadConfig()` returns `{}`, the built-in workload profiles remain), and `diffModels()` compares
against the previous call in the same page. The CLI and MCP server are Node only.

### Slim catalog entry

`llm-models/catalog` holds the types of the slim catalog and the helpers its client needs, with no
Zod and nothing else from the library, so it weighs under 1 KB in an app bundle:

```typescript
import { defaultModelOf, filterCatalogModels, type SlimCatalog } from "llm-models/catalog";

const catalog: SlimCatalog = await (await fetch("/models.json")).json();
const anthropic = catalog.anthropic;
defaultModelOf(anthropic); // its defaultModel when listed, else its first model
filterCatalogModels(anthropic, "sonnet"); // models whose name or id matches
```

`CALLABLE_NPM` lists the SDK packages [llm-connect](https://github.com/maxgfr/llm-models/tree/main/packages/llm-connect) can call. On the Node side,
`buildSlimCatalog(options)` fetches both sources and returns what `llm-models catalog` writes;
`slimCatalog({ models, modelsDevData }, options)` builds it from data you already fetched.

### Browser models (WebGPU)

Models a page can run itself, on the device's GPU, with no API key and nothing sent anywhere:
the prebuilt models of [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm`). The catalog
ships inside the package, so both calls are synchronous and work offline, in Node and the browser:

```typescript
import { listBrowserModels, recommendBrowserModel } from "llm-models";

const all = listBrowserModels(); // every WebLLM prebuilt model, described

const pick = recommendBrowserModel({
  vram_budget_mb: 3000,          // GPU memory the page may use
  download_budget_mb: 2000,      // optional: largest weight download
  needs: ["multilingual", "json"], // optional: json, multilingual, reasoning, long_context
  shader_f16: true,              // optional: false when the adapter lacks shader-f16
});
// {
//   model: { id: "Qwen3.5-2B-q4f16_1-MLC", family: "qwen", series: "Qwen3.5", params_b: 2,
//            quantization: "q4f16_1", vram_required_mb: 2245.44, download_mb: 1059.3,
//            context_window: 4096, multilingual: true, structured_output: true, reasoning: true,
//            quality: { metric: "MMLU-Redux", value: 69.2, source: "…" }, … },
//   reason: "Qwen3.5 2B (q4f16_1) needs 2245 MB of GPU memory, within the 3000 MB budget; …",
//   alternatives: [ /* up to 3 runner-ups, one build per model */ ]
// }
```

Pass `model.id` to WebLLM's `CreateMLCEngine`. `recommendBrowserModel` returns `null` when nothing
fits. A second argument ranks another list of models (e.g. a filtered `listBrowserModels()`).

**Where the data comes from.** `src/data/browser-models.json` is generated, never typed:
`bun run catalog:browser` downloads the `@mlc-ai/web-llm` npm tarball (checked against the
registry's sha512), reads its `prebuiltAppConfig` (model id, Hugging Face repo, WebGPU library,
`vram_required_MB`, `low_resource_required`, `required_features`, context override) and
`functionCallingModelIds`, then each repo's `tensor-cache.json` (weight shards, so the download
size, and the parameter bytes) and `mlc-chat-config.json` (compiled context). A value it cannot
fetch is `null`. The library never imports `@mlc-ai/web-llm`; the source package version is in
`browserModelCatalog().source`. Family, size (from the id, else from the weights) and quantization
are read from the id.

Each model also tells:

- `structured_output`: WebLLM's JSON mode (`response_format` `json_object`, with or without a JSON
  schema, or a grammar) is grammar-constrained decoding built into every model library, so every
  text model has it; `function_calling` is true only for the models WebLLM lists for `tools`.
- `multilingual`: the model card claims languages beyond English (Qwen, Llama 3.1/3.2, Gemma 3/4,
  Phi-3.5/4-mini, Ministral 3, Gemma 2 JPN). SmolLM2, OLMo 2, Gemma 2, Phi-3 and the community
  fine-tunes say English.
- `reasoning`: reasoning-only models (DeepSeek-R1 distills, Ministral 3 Reasoning) and hybrid
  ones that think on request (Qwen3, Qwen3.5: WebLLM's `extra_body.enable_thinking`).
- `released`: the month the vendor announced the series.

**How the pick is ranked.** Only chat models qualify (no base, coder, math, vision or embedding
model; reasoning-only models only when `reasoning` is needed), and only when WebLLM's
`vram_required_MB` fits the budget. Then, each rule breaking the ties of the previous one:

1. WebLLM's full 4,096-token context before a variant squeezed to 1k or 2k.
2. Published quality: the instruct model's **MMLU-Redux** score (non-thinking mode), mostly from
   the [Qwen3](https://arxiv.org/abs/2505.09388) and [Qwen2.5](https://arxiv.org/abs/2412.15115)
   technical reports, which ran Llama, Gemma and Phi under the same protocol, and the Qwen3.5 model
   cards. A model without a comparable score is placed level with the best older, no larger model
   of its own family (Qwen3.5-4B with Qwen3-4B), so a vendor's new generation never ranks below
   the one it replaces. Models with no score at all come after every scored one, and the `reason`
   says so.
3. Newer generation, then more parameters.
4. `q4f16` first (WebLLM's smallest build; fp16 compute needs the `shader-f16` WebGPU feature,
   so pass `shader_f16: false` when the adapter lacks it to get `q4f32` builds).

Scores are vendor-run and read as an ordering, not a truth; every row cites its table in
`src/functions/browser-models.ts`. On the shipped catalog, 1,500 MB picks Qwen3-0.6B,
3,000 MB Qwen3.5-2B, 4,096 MB Qwen3.5-4B and 6,000 MB Qwen3-8B.

### Raw API Access

```typescript
import { fetchOpenRouterModels, fetchModelsDevModels } from "llm-models";

const openrouter = await fetchOpenRouterModels();
const modelsDev = await fetchModelsDevModels();
```

### Zod Schemas

All schemas are exported for custom validation:

```typescript
import {
  UnifiedModelSchema,
  OpenRouterResponseSchema,
  ModelsDevResponseSchema,
  LlmModelsConfigSchema, // the config file format
  BrowserSupportSchema, // a probeBrowserSupport verdict
  BrowserModelSchema, // a listBrowserModels entry
  BrowserModelRecommendationSchema, // a recommendBrowserModel result
} from "llm-models";
```

`fetchOpenRouterModels` and `fetchModelsDevModels` validate entry by entry: an entry that no longer
matches its schema is skipped (counted under `--verbose`) rather than failing the whole fetch.

### Types

All types are inferred from Zod schemas:

```typescript
import type {
  UnifiedModel,
  NormalizedCost,
  Capabilities,
  ProviderInfo,
  BrowserSupport,
  BrowserModel,
  BrowserModelRecommendation,
  BrowserModelRecommendationOptions,
  ModelFilter,
  ModelSortField,
  CostEstimate,
  ModelComparison,
  LlmModelsConfig,
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
- **WebLLM prebuilt models** (browser models): the `@mlc-ai/web-llm` npm package's
  `prebuiltAppConfig` and the models' Hugging Face repos, captured at build time (see
  [Browser models](#browser-models-webgpu))

The two describe *different endpoints* for the same model id, so a merged entry takes its
`context_length` and `output_limit` as a pair from one source (models.dev first, since it is
provider-documented) rather than mixing them. Use `resolve --endpoint` when you need the limits of
the endpoint you actually call.

The two APIs sometimes spell the same model differently (OpenRouter's `anthropic/claude-opus-4.5`
is models.dev's `anthropic/claude-opus-4-5`). Ids that differ only by case or `.` versus `-` are
merged when the pairing is one-to-one. The merged model keeps the **models.dev id**, and OpenRouter's
id is kept in `openrouter_id`, which every model OpenRouter lists carries.

Unified ids carry the provider as a prefix (`anthropic/claude-opus-4-5`). To call the provider's own
API, send **`api_id`** instead: the id without the prefix (`claude-opus-4-5`; on models.dev's
`openrouter` provider, `anthropic/claude-opus-4.5`). A model listed under a vendor only because
OpenRouter serves it (`anthropic/claude-opus-4.5:batch`) has no `api_id`: the vendor's API does not
know it. OpenRouter's own models (`openrouter/auto`) use their OpenRouter id. Models only OpenRouter lists are dated from its `created` timestamp
(`release_date`, UTC), and those with an `expiration_date` are marked `deprecated`. On a merged
model, models.dev's date and status win.

## License

MIT
