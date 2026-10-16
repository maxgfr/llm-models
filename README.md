# llm-models

[![npm llm-models](https://img.shields.io/npm/v/llm-models?label=llm-models)](https://www.npmjs.com/package/llm-models)
[![npm llm-connect](https://img.shields.io/npm/v/llm-connect?label=llm-connect)](https://www.npmjs.com/package/llm-connect)
[![license](https://img.shields.io/github/license/maxgfr/llm-models)](LICENSE)

Everything about LLM **models** — which exist, what they cost, which one to pick — and the code a web
app needs to let its users **connect** to them with their own API key.

Two npm packages live here, built on the [models.dev](https://models.dev) and
[OpenRouter](https://openrouter.ai) catalogs:

| Package | Use it to… | Runs in |
|---------|------------|---------|
| [**`llm-models`**](packages/llm-models) | find, compare and price models from the terminal, a script, an AI agent (MCP) or CI; pick the latest model of a provider; build the catalog a web app ships | CLI, Node, browser, GitHub Action |
| [**`llm-connect`**](packages/llm-connect) | add a "bring your own key" LLM settings dialog to a web app: provider and model picker, Ollama / LM Studio, connection test, saved settings, model ready for the [AI SDK](https://ai-sdk.dev) | Browser (any framework, React adapter) |

## How they fit together

A web app that lets users plug in their own LLM needs a list of providers and models that stays
current, and the code to turn a user's choice into a working model. The list is built in the
browser when the settings open, with a JSON file written at build time as fallback: no daily commit.

```text
 in the browser, when settings open            fallback, written at build time
 ──────────────────────────────────            ───────────────────────────────
 models.dev + OpenRouter                       llm-models catalog ──► public/models.json
          │                                                                │
          ▼                                                                │
 liveCatalog() (llm-models, lazy) ──── fails? ◄────────────────────────────┘
   · only providers the app can call
   · recommended model per provider
          │
          ▼
 llm-connect store ──► settings dialog
   · provider + recommended model, API key or local endpoint
   · test, save (key encrypted, secureStorage)
          │
          ▼
 loadModel(settings) ──► AI SDK (generateText, streamText…)
```

Used in production by [db-schema-viewer](https://github.com/maxgfr/db-schema-viewer) and
[csv-ai-analyzer](https://github.com/maxgfr/csv-ai-analyzer).

## llm-models in 30 seconds

```bash
npm install -g llm-models          # or: brew install maxgfr/tap/llm-models

llm-models find -C reasoning --sort cost_input -n 10   # cheapest reasoning models
llm-models compare gpt-4o claude-sonnet-4-5            # side by side
llm-models latest --provider anthropic                 # newest model per tier
llm-models catalog --npm callable --out public/models.json
```

As a library (Node or browser):

```ts
import { fetchUnifiedModels, findModel } from "llm-models";

const models = await fetchUnifiedModels();
console.log(findModel(models, "gpt-4o")?.cost);
```

It also runs as an MCP server for AI agents (`llm-models mcp`) and as a GitHub Action
(`uses: maxgfr/llm-models@v1`) to fail CI on a budget or a deprecated model.
→ [Full documentation](packages/llm-models/README.md)

## llm-connect in 30 seconds

```bash
npm install llm-connect ai @ai-sdk/openai @ai-sdk/anthropic
```

```ts
import { createLlmSettingsStore, liveCatalog, loadModel, secureStorage } from "llm-connect";
import { generateText } from "ai";

// The settings dialog's state: catalog, provider, model, key, language, test, save
const store = createLlmSettingsStore({
  catalog: liveCatalog({ fallbackUrl: "/models.json" }),
  storage: secureStorage({ prefsKey: "my-app-ai", dbName: "my-app-secrets" }), // key encrypted
});

// Later, anywhere in the app
const settings = await store.load();
if (settings) {
  const { text } = await generateText({ model: await loadModel(settings), prompt: "Hello" });
}
```

React gets `useLlmStore` from `llm-connect/react`; Svelte reads the store directly (`$store`).
OpenAI, Anthropic (and compatible APIs), Google, Mistral and every OpenAI-compatible provider
(DeepSeek, Z.ai, Groq…) are built in, each SDK loaded only when used.
→ [Full documentation](packages/llm-connect/README.md)

## Repository

```text
packages/
  llm-models/    CLI, library, MCP server — tags v*
  llm-connect/   browser client for the catalog — tags llm-connect-v*
action.yml       the GitHub Action (uses: maxgfr/llm-models@v1)
```

A [bun](https://bun.sh) workspace. From the root:

```bash
bun install
bun run build:all   # llm-models first: llm-connect imports its built entry
bun run test
bun run lint
bun run typecheck
```

Releases are automatic: on every push to `main`, semantic-release runs once per package and only
counts the [conventional commits](https://www.conventionalcommits.org) that touch that package's
folder. Both packages are published from CI with npm trusted publishing (OIDC) and provenance.

## License

[MIT](LICENSE)
