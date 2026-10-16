# llm-models

Monorepo of two npm packages built on the [models.dev](https://models.dev) and [OpenRouter](https://openrouter.ai) catalogs.

| Package | What it does |
|---------|--------------|
| [`llm-models`](packages/llm-models) | CLI, library, MCP server and GitHub Action to find, compare and price LLM models, and to build the slim catalog a web app ships. |
| [`llm-connect`](packages/llm-connect) | Bring-your-own-key LLM settings for web apps: provider registry, model creation and connection test for the AI SDK, a framework-free settings store, and a React adapter. |

## GitHub Action

`uses: maxgfr/llm-models@v1` — see [the Action section](packages/llm-models/README.md#github-action).

## Development

```bash
bun install
bun run build:all
bun run test
bun run lint
bun run typecheck
```

Each package is released on its own by semantic-release from its folder, using the conventional commits that touch it.
