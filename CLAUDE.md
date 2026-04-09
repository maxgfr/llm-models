# CLAUDE.md

## Project overview
CLI tool and library to fetch latest LLM model data from OpenRouter and models.dev APIs.
Validates API responses with Zod schemas. Provides smart wrapper functions: unified model
discovery, comparison, cost estimation, provider info, recommendations, stats, and diffs.
Features local caching (1h TTL), MCP server integration, multiple output formats, and
a fluent query builder API. Distributed via npm, Homebrew, and standalone binaries.

## Tech stack
- TypeScript 5.7+, Bun runtime, ESM modules
- Bun as package manager and test runner
- Zod for API response validation
- Commander.js for CLI
- @modelcontextprotocol/sdk for MCP server
- Biome for linting and formatting
- semantic-release for versioning
- bun build --compile for binary builds

## Commands
- `bun install` - install dependencies
- `bun run build:all` - build library + type declarations
- `bun test` - run tests (includes live API schema validation)
- `bun run lint` - run Biome linter
- `bun run lint:fix` - auto-fix lint issues
- `bun run dev` - watch mode
- `bun run build:binary:macos-arm64` - build macOS ARM binary
- `bun run release` - semantic-release

## Project structure
- `src/` - source code
  - `index.ts` - entry point (CLI + library export)
  - `cli.ts` - CLI commands (Commander.js, 15 commands)
  - `format.ts` - CLI formatting utilities (table, cost, context, CSV, markdown)
  - `types.ts` - Zod-inferred type exports
  - `cache.ts` - Local API response cache with TTL (~/.cache/llm-models/)
  - `colors.ts` - ANSI color helpers with NO_COLOR/TTY detection
  - `config.ts` - Config file loading (~/.config/llm-models/, .llm-modelsrc)
  - `completions.ts` - Shell completion generators (bash, zsh, fish)
  - `mcp.ts` - MCP server (8 tools for AI agent integration)
  - `schemas/openrouter.ts` - Zod schemas for OpenRouter API
  - `schemas/models-dev.ts` - Zod schemas for models.dev API
  - `schemas/functions.ts` - Zod schemas for unified types (UnifiedModel, ProviderInfo, etc.)
  - `clients/openrouter.ts` - OpenRouter fetch + parse + cache
  - `clients/models-dev.ts` - models.dev fetch + parse + cache
  - `functions/normalize.ts` - Cross-source normalization + merge into UnifiedModel
  - `functions/search.ts` - filterModels, sortModels, findModels
  - `functions/compare.ts` - compareModels (side-by-side)
  - `functions/provider.ts` - getProvider, listProviders
  - `functions/cost.ts` - estimateCost, cheapestModels
  - `functions/stats.ts` - getStats (aggregate market statistics)
  - `functions/recommend.ts` - recommendModels, listUseCases (use-case presets)
  - `functions/diff.ts` - diffModels (compare current vs cached snapshot)
  - `functions/query.ts` - QueryBuilder fluent API
  - `__tests__/` - 19 test files (164 tests, unit + live API schema validation)
- `build/` - compiled output (npm package)
- `dist/` - binary output
- `action.yml` - GitHub Action for CI/CD integration
- `.github/workflows/` - CI/CD (build, test, lint, publish, monitor-apis)

## Code conventions
- Strict TypeScript (`strict: true`)
- Double quotes, trailing commas (Biome)
- ESM modules (`"type": "module"`)
- Tests use `describe`/`it` blocks with `bun:test`
- Tests that mock `fetch` must call `setCacheEnabled(false)` in `beforeAll`
- Conventional commits (semantic-release parses them)
- Types inferred from Zod schemas, never manually duplicated
- All new domain types defined as Zod schemas in `schemas/functions.ts`
- ANSI regex patterns use `biome-ignore` comment for control character rule
- README.md must be updated whenever a command, option, or library export is added or changed
