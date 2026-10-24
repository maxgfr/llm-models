# AGENTS.md

## Project overview
CLI tool and library to fetch latest LLM model data from OpenRouter and models.dev APIs.
Validates API responses with Zod schemas. Provides smart wrapper functions: unified model
discovery, comparison, cost estimation, provider info, recommendations, stats, and diffs.
Features local caching (1h TTL), MCP server integration, multiple output formats, and
a fluent query builder API. Distributed via npm, Homebrew, and standalone binaries.

## Tech stack
- TypeScript 7, Bun runtime, ESM modules (Node.js >= 22.12 for the npm package)
- Bun as package manager and test runner
- Zod for API response validation
- Commander.js for CLI
- @modelcontextprotocol/sdk for MCP server
- Biome for linting and formatting
- semantic-release for versioning
- bun build --compile for binary builds

## Workspace
A bun workspace (`"workspaces": ["packages/*"]`, one `bun.lock` at the root) holding the npm packages:
- `packages/llm-models` - the `llm-models` CLI and library (tags `v*`, binaries, Homebrew)
- `packages/llm-connect` - `llm-connect`, the client side of the slim catalog (tags `llm-connect-v*`)

Each package releases on its own: semantic-release runs from the package folder (`.releaserc.json`
there), and `semantic-release-monorepo` only counts the commits that touch that folder. `action.yml`
stays at the repository root (`uses: maxgfr/llm-models@v1`).

## Commands
From the root (each delegates to every package with `bun run --filter "./packages/*"`):
- `bun install` - install dependencies
- `bun run build:all` - build every package + type declarations
- `bun run test` - run tests (includes live API schema validation); `bun test` alone skips per-package setup
- `bun run lint` / `bun run lint:fix` - Biome (one `biome.json` at the root)
- `bun run typecheck` - `tsc --noEmit` per package (CI runs it after `build:all`; `tsconfig` excludes tests)

From `packages/llm-models`:
- `bun run dev` - watch mode
- `bun run build:binary:macos-arm64` - build macOS ARM binary
- `bun run release` - semantic-release (CI only)

## Project structure (`packages/llm-models`)
- `src/` - source code
  - `index.ts` - Node entry point (CLI + library export); loads `cache.ts` and `config.ts` for their disk-backed stores
  - `browser.ts` - browser entry point (package.json `browser` / exports `browser` condition): same API, memory cache, no config file
  - `lib.ts` - the library API both entries re-export; nothing reachable from it may import a Node builtin (`browser-bundle.test.ts`)
  - `catalog.ts` - entry `llm-models/catalog`: slim catalog types (`SlimCatalog`…), `defaultModelOf`,
    `filterCatalogModels`, `CALLABLE_NPM`. Plain TypeScript, no Zod and no other import: app bundles load it
  - `cli.ts` - CLI commands (Commander.js, 19 commands); `createProgram()` builds, `runCommand()` parses
  - `format.ts` - CLI formatting utilities (table, cost, context, CSV, markdown)
  - `types.ts` - Zod-inferred type exports
  - `cache-core.ts` - Cache logic over a pluggable `CacheStore` (memory by default), TTL, enabled flag; no Node APIs
  - `cache.ts` - Node only: disk `CacheStore` (~/.cache/llm-models/), atomic best-effort writes; installs itself on import
  - `log.ts` - `--verbose` diagnostics (stderr only)
  - `colors.ts` - ANSI color helpers with NO_COLOR/TTY detection
  - `config-core.ts` - `loadConfig`/`getProfile`/`listProfiles` over a pluggable loader (none by default); no Node APIs
  - `config.ts` - Node only: config file loading (~/.config/llm-models/, .llm-modelsrc), validated by `LlmModelsConfigSchema`; installs itself on import
  - `completions.ts` - Shell completions (bash, zsh, fish) generated from the Commander program
  - `mcp.ts` - MCP server (11 tools for AI agent integration); `createMcpServer()` is testable in memory
  - `schemas/openrouter.ts` - Zod schemas for OpenRouter API
  - `schemas/models-dev.ts` - Zod schemas for models.dev API
  - `schemas/functions.ts` - Zod schemas for unified types (UnifiedModel, ProviderInfo, config, etc.)
  - `clients/http.ts` - fetchJson: 15s timeout, User-Agent
  - `clients/openrouter.ts` - OpenRouter fetch + per-entry tolerant parse + cache
  - `clients/models-dev.ts` - models.dev fetch + per-model tolerant parse + cache
  - `functions/normalize.ts` - Cross-source normalization + merge into UnifiedModel (exact, then loose 1:1 ids)
  - `functions/resolve.ts` - resolveModel (endpoint/provider-scoped lookup); findModel (lookup for info/compare/cost)
  - `functions/latest.ts` - latestModels/pickTiers: newest flagship + fast model per tier for an endpoint
  - `functions/fields.ts` - readField/formatFields: dotted-path `--field` extraction
  - `functions/search.ts` - filterModels, sortModels, findModels
  - `functions/compare.ts` - compareModels (side-by-side)
  - `functions/provider.ts` - getProvider, listProviders (`{ browser }` attaches CORS verdicts, cached per origin)
  - `functions/browser-models.ts` - listBrowserModels, recommendBrowserModel: WebLLM models that run
    in the page on WebGPU; family/release/language table and MMLU-Redux quality table, each row cited
  - `data/browser-models.json` - generated by `bun run catalog:browser` (`scripts/build-browser-models.ts`)
    from @mlc-ai/web-llm's npm tarball (`prebuiltAppConfig`) and each model's HF tensor-cache.json;
    never edit by hand, never import @mlc-ai/web-llm at runtime
  - `functions/browser.ts` - probeBrowserSupport (CORS preflight + GET fallback), DEFAULT_BASE_URLS, BROWSER_REQUIRED_HEADERS
  - `functions/cost.ts` - estimateCost, cheapestModels
  - `functions/catalog.ts` - slimCatalog/buildSlimCatalog: the catalog `llm-models catalog` writes for web apps
  - `functions/stats.ts` - getStats (aggregate market statistics)
  - `functions/recommend.ts` - recommendModels, listUseCases (use-case presets)
  - `functions/diff.ts` - diffModels (compare current vs its own snapshot.json, then save it)
  - `functions/query.ts` - QueryBuilder fluent API
  - `__tests__/` - test files (unit, CLI end-to-end on a fixture HOME, in-memory MCP,
    live API schema validation)
- `build/` - compiled output (npm package)
- `dist/` - binary output
- `../../action.yml` - GitHub Action for CI/CD integration (repository root)
- `.github/workflows/` - CI/CD (build, test, lint, publish, monitor-apis)

## llm-connect (`packages/llm-connect`)
Bring-your-own-key LLM settings for web apps, on top of the AI SDK (`ai` v7, `@ai-sdk/*` v4,
`@ai-sdk/openai-compatible` v3, all optional peers) and `llm-models/catalog`.
- `src/registry.ts` - provider registry (`registerProvider`, `fromSDK`, npm aliases → short names)
- `src/model.ts` - `createModel` (sync, registered providers) / `loadModel` (imports a built-in provider on demand)
- `src/providers/*.ts` - one module per built-in SDK (`factory`, `register()`), plus `all.ts`; entry `llm-connect/providers/*`
- `src/connection.ts` - `testConnection` (`models` by default, free; `generate`; `auto`: models, then a generation only when there is no list), `listEndpointModels`; never throws on a failed connection
- `src/settings.ts` - `LlmSettings`, `LlmDraft`, `isConfigured` (custom endpoint needs a model), `canSave`, `endpointProblem` / `validateEndpoint` (https, or http on loopback only), `ENDPOINT_PRESETS`
- `src/provider-kind.ts` - which wire protocol a provider speaks (Anthropic, OpenAI Responses, Gemini, OpenAI-compatible)
- `src/effort.ts` - reasoning-effort levels per model from the makers' docs (Claude 4.7+/5 `low`..`max` incl. `xhigh`, OpenAI `reasoning.effort`, Gemini levels or budgets); none for undocumented models
- `src/capabilities.ts` - capability resolution: pinned Claude table, then the catalog entry, then user overrides; cautious defaults
- `src/call.ts` - `callOptions` (provider options to spread into `streamText`/`generateText`: adaptive thinking + summarized display, Responses `store: false` + encrypted reasoning, Gemini thought summaries), `callProblem` (checks before any call), `stopReasonOf`, `refusalOf`
- `src/web-search.ts` - each provider's own web search tool (Anthropic newer/older variants, OpenAI, Gemini)
- `src/errors.ts` - `describeError`: code, status, retryable, provider message with the key masked; `auth-or-network` for an unreadable failure
- `src/fetch.ts` - `guardedFetch` used by every built-in model: drops the SDK user-agent, Anthropic's browser header only to api.anthropic.com, `strictHeaders`, gateway errors sent as 200 JSON turned into their status; apps may pass their own `fetch`
- `src/language.ts` - `RESPONSE_LANGUAGES` (16, stored as codes), `languageName`, `toLanguageCode`, `browserLanguage`
- `src/storage.ts` - `SettingsStorage` interface and `webStorage` (key in clear: compatibility only)
- `src/secure-storage.ts` - `secureStorage`: prefs in localStorage, key AES-GCM encrypted under a non-extractable CryptoKey in IndexedDB (ciphertext in IndexedDB when remembered, sessionStorage otherwise)
- `src/key-vault.ts` - `createKeyVault`: several secrets by name, AES-GCM under a random vault key wrapped by a passphrase key (PBKDF2-SHA256 600k + HKDF, or a `kdf` hook such as Argon2id), HMAC check for a wrong passphrase, AAD = format + vault id + name; `lock`/`autoLockMs`, `changePassphrase` (rewrap only), `rememberOnDevice` (device-key copy), `reset` = `destroy` (no passphrase); memory fallback without IndexedDB/WebCrypto
- `src/vault-storage.ts` - `vaultStorage` (`SettingsStorage` over a vault, key per provider, empty while locked), `migrateToVault` (from secureStorage/webStorage, erases the old copy)
- `src/catalog-client.ts` - `liveCatalog` (lazy `llm-models/browser` build through `cachedFetch`, static fallback), `loadCatalog` (one shared request per URL, forgotten on failure), `splitProviders`, `providerMeta`, `DEFAULT_RECOMMENDED`
- `src/http-cache.ts` - `cachedFetch`: GET responses in Cache Storage keyed by URL (1 h TTL, ETag revalidation on the page's origin, stale copy on network failure); plain fetch without Cache Storage; no Node APIs
- `src/store.ts` - `createLlmSettingsStore`: framework-free state + actions, Svelte store contract
- `src/react.ts` - entry `llm-connect/react`: `useLlmSettings`, `useLlmStore`, `useKeyVault`
- `src/transcript.ts` - `Transcript` (text, segments, words, `wordTimings`), `toTranscript` (words ↔ segments: rebuilds segments at sentence ends and pauses, estimates words inside segments), `toWebVtt`
- `src/transcription.ts` - `transcribe` over the AI SDK's `transcribe` with the provider's transcription model (OpenAI `whisper-1`, Gemini, Mistral Voxtral, Groq, named model on a custom endpoint; none for Anthropic), `transcriptionProblem`, `transcriptionTargetOf`, `loadTranscriptionModel`; sends the blob's own media type through `download`, reads raw `words` when a server also sends segments
- `src/whisper.ts` - entry `llm-connect/whisper`: `loadWhisper` (transformers.js, optional peer, imported on use; WebGPU or wasm; presets fast/balanced/accurate on onnx-community `_timestamped` models), `decodeAudio` (page only: OfflineAudioContext), `fromAsrOutput`

Conventions:
- No eager SDK import outside `providers/`: `ai` and each `@ai-sdk/*` load through dynamic imports
- Built with `tsc` (one ESM file per module, no bundling) so each SDK stays a separate import;
  relative imports carry their `.js` extension
- `llm-models` is a `workspace:^` dependency; the release's `prepareCmd` pins it to the released
  range before `npm publish`, after `@semantic-release/git` committed `package.json`
- npm must never reinstall the workspace (`NPM_CONFIG_WORKSPACES_UPDATE=false` in `publish.yml`):
  it rejects the `workspace:` protocol and the bun-installed tree
- Tests: `bun test` in the package; React hooks under happy-dom (`react.test.ts`), IndexedDB from `fake-indexeddb`, Cache Storage from `__tests__/fake-cache-storage.ts`

## Code conventions
- Strict TypeScript (`strict: true`)
- Double quotes, trailing commas (Biome)
- ESM modules (`"type": "module"`)
- Tests use `describe`/`it` blocks with `bun:test`
- Tests that mock `fetch` must call `setCacheEnabled(false)` in `beforeAll`
- Tests that need a real cache use `setCacheDir()` on a temp dir; never touch the real ~/.cache
- Library modules import `cache-core`/`config-core`, never `cache`/`config` (those pull in node:fs)
- Browser-callable claims are evidence-based: probe live, or cite the provider's doc next to the table entry
- Browser-model facts (release, languages, scores) cite a model card, vendor post or report next to
  the row; when no comparable score exists the model stays out of `QUALITY`, never an estimate
- Merged models keep the models.dev id; OpenRouter's spelling lives in `openrouter_id`, and lookups
  (`pickBestModel`, `findModel`) match both
- Conventional commits (semantic-release parses them)
- Types inferred from Zod schemas, never manually duplicated
- All new domain types defined as Zod schemas in `schemas/functions.ts`, except the slim catalog
  types in `catalog.ts`, which must stay Zod-free for app bundles
- ANSI regex patterns use `biome-ignore` comment for control character rule
- README.md must be updated whenever a command, option, or library export is added or changed
- `context_length` and `output_limit` must always come from the SAME source when merging: the two
  APIs describe different endpoints (OpenRouter routes deepseek-chat at 163,840 context, DeepSeek's
  own API serves 1,000,000), so mixing them yields impossible pairs. models.dev wins; output is
  clamped to context. See `mergeModels` in `functions/normalize.ts`.
- Script-facing output (`--field`, `resolve`, `latest`) is a contract: bare values on stdout, diagnostics on
  stderr, exit 1 on no match. Keep it stable — `ccs` (claude-code-switch) depends on it.
