# llm-connect

Let the users of a web app bring their own LLM: pick a provider and a model from a catalog, paste
a key (or point at Ollama / LM Studio), test the connection, save, then call the model through the
[AI SDK](https://ai-sdk.dev) straight from the browser.

- **Framework-free core**: provider registry, `createModel` / `loadModel`, `testConnection`, and
  a settings store you can drive from any UI. `llm-connect/react` binds it to React; Svelte reads it
  as a store.
- **Five providers built in**: OpenAI, Anthropic (and Anthropic-compatible APIs), Google, Mistral,
  and every provider of the generic `@ai-sdk/openai-compatible` SDK (DeepSeek, Z.ai, Groq…).
  Each SDK loads only when used.
- **The catalog comes from [llm-models](https://github.com/maxgfr/llm-models/tree/main/packages/llm-models)**, built live in the browser
  (`liveCatalog`) with a static `models.json` as fallback, and a recommended model per provider.
- **The key never sits in clear text**: `secureStorage` encrypts it with AES-GCM under a
  non-extractable key, `createKeyVault` keeps the keys of several providers behind a passphrase,
  and a custom endpoint must be https (plain http only on this machine).
- **Each provider's request rules**: reasoning effort per provider and model, what each model
  accepts (sampling, prefill, tools, web search), Claude's adaptive thinking, stateless OpenAI
  Responses calls, headers that pass a browser's CORS preflight, and errors classified without
  the key.
- **Speech to text**: `transcribe` with the provider's own transcription model (OpenAI, Gemini,
  Mistral, Groq), or on the device with NVIDIA Parakeet or Canary (`llm-connect/nemo`) or Whisper
  (`llm-connect/whisper`), all in one shape and timed to the word.

## Install

```bash
npm install llm-connect llm-models ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral @ai-sdk/openai-compatible
```

`ai` (v7), the `@ai-sdk/*` packages (v4) and `@ai-sdk/openai-compatible` (v3) are optional peers:
install the ones your users can pick.
`react` (18+) is only needed for `llm-connect/react`.

The store builds the catalog in the browser when settings open (see
[The catalog](#the-catalog)). Write the fallback at build time:

```bash
npx llm-models catalog --npm callable --require openai,anthropic,google,mistral --out public/models.json
```

## Call a model

```ts
import { generateText } from "ai";
import { loadModel } from "llm-connect";

const model = await loadModel(settings); // imports @ai-sdk/anthropic on first use
const { text } = await generateText({ model, prompt: "Hello" });
```

`settings` is what the store saves (`LlmSettings`):

| Field | |
|-------|-|
| `apiKey`, `model` | The key and the catalog model id |
| `providerId`, `providerName`, `providerNpm`, `providerApi` | The catalog provider: its SDK package and base URL |
| `customEndpoint`, `customModel` | An OpenAI-compatible server (Ollama, LM Studio, vLLM…); wins over the provider |
| `headers` | Extra request headers |
| `language` | Code of the language answers are written in (`"fr"`) |

Both take options as a second argument:

| Option | Default | |
|--------|---------|-|
| `fetch` | `globalThis.fetch` | The fetch every request of the model goes through: route them through your own wrapper (logging, a proxy, a network policy) |
| `strictHeaders` | `false` | Send only the headers the provider's API defines (plus `content-type` and `accept`); the settings' `headers` are dropped |

`createModel(settings)` does the same synchronously, for providers you registered yourself:

```ts
import { createModel, registerProvider, fromSDK } from "llm-connect";
import { register as registerAnthropic } from "llm-connect/providers/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

registerAnthropic(); // or "llm-connect/providers/all" for the five
registerProvider("openai", fromSDK(createOpenAI));
registerProvider("my-llm", (config) => myLanguageModel(config.apiKey, config.model));
```

The registry is shared by every copy of llm-connect loaded in the page, so a library and the app
that resolve different installs still see the same providers.

What the built-in providers take care of:

- A custom endpoint goes through the OpenAI SDK with Chat Completions; the official OpenAI URL
  keeps the Responses API.
- Every request goes through `guardedFetch`, which removes the `user-agent` header the AI SDK adds
  (no provider's CORS preflight allows it, and Firefox sends it).
- Anthropic's own API gets the `anthropic-dangerous-direct-browser-access` header. An
  Anthropic-compatible provider (MiniMax…) gets its own base URL, so its key never goes to
  Anthropic, and not that header, which its preflight does not allow. Its base URL works with
  or without the trailing `/v1` (`anthropicBaseUrl`): gateways document it without, for
  Anthropic's own clients, as Z.ai does with `https://api.z.ai/api/anthropic`.
- A gateway that answers an error with HTTP 200 and a JSON body (Z.ai:
  `{"code":500,"msg":"404 NOT_FOUND","success":false}`) gets the status the body stands for
  (`maskedErrorStatus`), so the call fails with the provider's message instead of a parse error
  or a stream that ends without a finish.
- The generic SDK refuses a provider without URL, asks for the usage chunk at the end of a stream
  (`stream_options.include_usage`), and turns structured output (`json_schema`) into
  `json_object` plus the schema in a system message, for APIs such as GLM.

`guardedFetch(kind, { fetch, strictHeaders })` is exported for providers you register yourself:
pass it as their `fetch`.

## Call options

What a call may carry depends on the provider and the model. `callOptions` builds the provider
options for the model the settings point to, to spread into `streamText` or `generateText`:

```ts
import { streamText } from "ai";
import { callOptions, callProblem, loadModel, resolveCapabilities, providerKindOf } from "llm-connect";

const capabilities = resolveCapabilities({
  kind: providerKindOf(settings), // "anthropic" | "openai" | "google" | "mistral" | "openai-compatible"
  modelId: settings.model,
  catalog: slimModel, // the catalog's entry, optional
});
const call = { effort: "high", messages } as const;
const problem = callProblem(settings, call, capabilities); // null, or { code, message }
if (problem) throw new Error(problem.message);

const result = streamText({
  model: await loadModel(settings),
  messages,
  ...callOptions(settings, { effort: "high", capabilities }),
});
```

Per protocol, `callOptions` sends:

| Protocol | Options |
|----------|---------|
| Anthropic | Claude 4.6 and later: `output_config.effort` and adaptive thinking with `display: "summarized"` (left out when the call sets a sampling parameter, which thinking refuses). Earlier models: a thinking budget, with the output cap lowered so the sum stays within the model's limit. `refusalFallback: true` opts in to the server-side refusal fallback (`fallbacks: "default"`) on Anthropic's own API, for the models that have one |
| OpenAI (Responses, official URL) | `store: false`, so OpenAI keeps no conversation state. On a reasoning model, `include: ["reasoning.encrypted_content"]` and a reasoning summary; the effort as `reasoning.effort` |
| Gemini | Thought summaries on a reasoning model; the effort as `thinkingLevel` (Gemini 3) or a thinking budget (Gemini 2.5) |
| Mistral, OpenAI-compatible | Nothing: a server may refuse a parameter it does not know |

Replaying a conversation needs nothing more: pass back each turn's `response.messages`. Their
reasoning parts carry Anthropic's thinking signatures, OpenAI's encrypted reasoning and Gemini's
thought signatures, and the SDK sends them back unchanged.

`callOptions` throws `LlmCallError` (`code: "effort"`) for an effort the model does not take.
`callProblem(settings, call, capabilities?)` checks the rest before any network call, rather than
letting a parameter be dropped: an effort or sampling parameter the model refuses, a sampling
parameter next to a thinking budget, an assistant message last (prefill), a system message after
the first one, tools, a forced tool choice, web search, images, PDFs, and the output cap.

### Reasoning effort

`EFFORTS` is the scale, weakest first: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
`effortLevels(kind, modelId)` gives the levels a model takes, from the makers' documentation, and
an empty list for a model nobody documented (hide the control then):

| Models | Levels | Sent as |
|--------|--------|---------|
| Claude Opus 4.7 and later, Claude 5 | `low` to `max`, `xhigh` included | `output_config.effort` |
| Claude Opus and Sonnet 4.6 | `low`, `medium`, `high`, `max` | `output_config.effort` |
| Claude 4 to 4.5 | `low`, `medium`, `high` | `thinking.budget_tokens` (2048, 8192, 24576) |
| GPT-5 and later, o-series | per model (`none` / `minimal` to `xhigh`, never `max`) | `reasoning.effort` |
| Gemini 3 | per model (`minimal` to `high`) | `thinkingConfig.thinkingLevel` |
| Gemini 2.5 | `low`, `medium`, `high` | `thinkingConfig.thinkingBudget` (1024, 8192, 24576) |
| Mistral, OpenAI-compatible servers | none | |

Model ids match without case, dots, `:variant` or date suffix (`modelKey`), so
`claude-sonnet-4-6-20260115` and `gemini-2.5-flash` resolve like their bare names.
`effortWire(kind, modelId, effort)` says where a level goes, and `usableEffort(effort, levels)`
keeps a saved level only when the model takes it.

### Capabilities

`resolveCapabilities({ kind, modelId, catalog?, override? })` says what a model accepts: `vision`,
`pdf`, `tools`, `reasoning`, `effort` (`levels`, `default`), `thinkingDisplay`, `sampling`,
`prefill`, `forcedToolChoice`, `webSearch`, `midConversationSystem`, `toolChanges`,
`refusalFallback`, `contextWindow`, `maxOutput` and `cost`.

- Current Claude models are pinned from Anthropic's documentation (`KNOWN_ANTHROPIC_MODELS`), and
  win over the catalog: Claude 4.6 and later take no prefill, Opus 4.7 and later no sampling
  parameter, and some refuse a forced tool choice.
- Every other model follows its catalog entry (a `SlimModel`, or a richer `CatalogModelInfo` with
  limits, input modalities and prices), with conservative defaults for what it leaves out: no
  prefill, no forced tool choice unless the API documents it, no mid-conversation system message.
- `override`, a user's corrections, is applied last.

### Web search

`webSearchTools(capabilities.webSearch, { maxUses })` returns the provider's own search tool, keyed
`web_search`, to spread into `tools`; `{}` when the model has none. It imports only that
provider's SDK: Anthropic's dynamic-filtering search (Claude 4.6 and later) or its basic one,
capped at `maxUses` searches per answer (5); OpenAI's `web_search`; Gemini's Google Search. A Gemini
model before 3 cannot combine it with function tools (`callProblem` says so). Anthropic's results
come back encrypted in `response.messages` and are replayed unchanged on the next turn.

### Stop reasons and errors

`stopReasonOf(kind, finishReason, rawFinishReason)` reads a step's or a response's end: `end`,
`length`, `tool-calls`, `stop-sequence`, `refusal` (Anthropic's `stop_reason: "refusal"`; its
category and explanation come from `refusalOf(providerMetadata)`), `content-filter`, `pause`
(Anthropic's `pause_turn`), `truncated` (the stream closed before the provider's finish event) or
`other`.

`describeError(error, apiKey)` classifies any failed call as `{ code, message, status?, retryable }`:

| Code | |
|------|-|
| `auth` | Key refused: 401, 403, or Gemini's 400 "API key not valid" |
| `auth-or-network` | No readable answer: offline, DNS, a CORS refusal, or a key refused by a server that answers errors without CORS headers. A page cannot tell these apart: show "key refused or network" |
| `rate-limit`, `overloaded`, `server` | Retryable |
| `context-length`, `invalid-request`, `not-found`, `unknown` | Not retryable |

It reads the provider's error body (Anthropic, OpenAI, Gemini and Z.ai shapes), an error event inside a
stream, and a `RetryError` through its last attempt. The message is the provider's, untrusted:
show it as text. It is cut to 500 characters, and the key is replaced by `***` in case a server
echoed it back.

## Test a connection

```ts
import { testConnection } from "llm-connect";

const result = await testConnection(settings); // lists the models: costs nothing
if (!result.ok) console.log(result.reason); // "auth" | "cors" | "http" | "timeout" | "config" | "insecure"
```

A test is free unless you ask for a generation:

- `models` (default): `GET {base}/models` with the provider's own auth headers (`x-api-key` for
  Anthropic, `x-goog-api-key` for Google, a bearer token otherwise). 5 s for a custom endpoint, 10 s
  for a provider. Returns the model ids a server lists, OpenAI's `data` or Gemini's `models`. Never
  runs a generation.
- `generate`: a short generation through the AI SDK, exactly as the app will call the model. It
  spends a few tokens of the user's quota, so it only runs when you pass `mode: "generate"`.
- `auto`: `models` first, then the generation only when the server has no model list to give
  (404, 405 or 501, the request blocked by the browser, or no API URL). A refused key (401/403),
  another status or a timeout stays the verdict. Passing `auto` opts in to that generation.

A custom endpoint in plain http to another machine is not called at all (`insecure`).

`cors` means the request failed without a readable answer: offline, a CORS refusal, or a key
refused by a server that sends its errors without CORS headers. Show it as "key refused or
network". `fetch` is used for every request of the test, the listing and the generation, and a
message never contains the key. A listing answered with HTTP 200 and an error body fails with
that error's status and message.

`listEndpointModels(endpoint, apiKey?)` lists the models of an OpenAI-compatible server.

## The settings store

`createLlmSettingsStore` holds everything a settings dialog needs: catalog download (one request,
retried on demand), provider and model choice with the recommended model applied, model search,
two key slots (the provider's and the custom endpoint's, so toggling keeps both), local endpoint
presets, connection test, validation and storage.

```ts
import { createLlmSettingsStore, liveCatalog, secureStorage } from "llm-connect";

const store = createLlmSettingsStore({
  catalog: liveCatalog({ fallbackUrl: "/models.json" }),
  storage: secureStorage({ prefsKey: "my-app-ai", dbName: "my-app-secrets" }),
});

await store.load(); // saved settings → draft
store.open(); // a dialog opens: drop unsaved edits, load the catalog
store.selectProvider("anthropic"); // and its recommended model
store.setApiKey("sk-ant-…");
store.setLanguage("fr");
await store.test();
const result = await store.save({ theme: "dark" }); // your own fields are kept too
if (!result.ok) console.log(result.reason); // "incomplete" | "invalid-endpoint" | "insecure-endpoint"
```

Options:

| Option | Default | |
|--------|---------|-|
| `catalog` | required | A URL (`"/models.json"`) or a loader such as `liveCatalog(…)`; `catalogUrl` is a deprecated alias |
| `storage` | required | `secureStorage(…)`, `vaultStorage(…)`, `webStorage(…)` or your own `SettingsStorage` |
| `recommended` | `DEFAULT_RECOMMENDED` | Provider ids listed first: OpenAI, Anthropic, Google, Mistral |
| `testMode` | `"models"` | The `testConnection` mode of `test()`: `models` (free), `auto` (model list, a generation only when there is none) or `generate` |
| `defaults` | | `providerId`, `model`, `rememberKey` (false), `language` (the browser's) |

State (`store.getState()`): `catalog`, `catalogStatus` (`idle | loading | error | ready`),
`catalogError`, `saved`, `draft`, `search`, `testing`, `testResult`, and derived `provider`,
`providers` (`recommended` / `others`), `isRecommendedProvider`, `models` (filtered by `search`),
`recommendedModel`, `apiKey` (active slot), `canSave`, `canTest`.

Actions: `load`, `reset(settings)` (for settings the app already holds), `open`, `retryCatalog`, `selectProvider`, `selectModel`, `setApiKey`, `setSearch`,
`toggleCustom`, `applyPreset(ENDPOINT_PRESETS.ollama)` (also `lmstudio` and `jan`), `setEndpoint`, `setCustomModel`,
`setRememberKey`, `setLanguage`, `settings`, `test`, `save`, `clear` (also resets the language).

### The catalog

`liveCatalog({ fallbackUrl, npm, required })` returns a loader that imports `llm-models` on first
call (so Zod and the API clients stay out of the main bundle), fetches models.dev and OpenRouter,
and keeps the providers whose SDK llm-connect calls (`CALLABLE_NPM`). If that fails (offline, an
API down, a `required` provider missing), it downloads `fallbackUrl`. Every caller shares one
request; a failure is forgotten, so retrying works. The page's `connect-src` must allow
`https://models.dev` and `https://openrouter.ai`.

The two API responses (models.dev's is about 5.7 MB) are kept in Cache Storage, keyed by URL, so
the next page load or PWA launch does not download them again:

- for `cacheTtlMs` (1 hour, as in llm-models) a stored response is used without a request;
- after that it is revalidated: with `If-None-Match` and its ETag on the page's own origin (a 304
  keeps it), and through the browser's HTTP cache across origins, where a manual `If-None-Match`
  would need a CORS preflight that models.dev and OpenRouter refuse;
- when the network fails or an API errors, the stored response is used however old it is.

`cacheName` (default `"llm-connect-catalog"`) names the cache, `false` turns it off, and
`cacheStorage` replaces `globalThis.caches`. Without Cache Storage (outside a browser, or in an
insecure context) the responses stay in llm-models' in-memory cache, as before. `fetch` is used for
these requests and for `fallbackUrl`.

### Storage

`secureStorage({ prefsKey, dbName, sessionKey? })` (recommended):

- preferences, without the key, in `localStorage` (JSON under `prefsKey`);
- the key encrypted with AES-GCM 256 under a non-extractable `CryptoKey` kept in IndexedDB
  (`dbName`), with a fresh IV on every save. A remembered key's ciphertext goes to IndexedDB;
  otherwise to `sessionStorage`, so it survives a reload and goes away with the tab;
- without IndexedDB or WebCrypto (some private modes), the key lasts for the page, in memory;
- `clear()` removes the preferences, the ciphertext and the `CryptoKey`.

A dump of cookies, `localStorage`, `sessionStorage` and IndexedDB never shows the key. Script
running in the page (an XSS) can still have the browser decrypt it: a strict
Content-Security-Policy is what protects against that.

`webStorage({ prefsKey, apiKeyKey })` keeps the key in clear text, in `sessionStorage` or in
`localStorage` when remembered; it stays for compatibility. Any other scheme fits the
`SettingsStorage` interface (`load`, optional `loadDraft`, `save`, `clear`).

`vaultStorage({ vault, prefsKey, keyName? })` keeps the key in a passphrase-protected vault (see
[Key vault](#key-vault)).

### Choosing a storage

| | `webStorage` | `secureStorage` | `vaultStorage` + `createKeyVault` |
|-|-|-|-|
| Key at rest | In clear | AES-GCM under a non-extractable key of the browser | AES-GCM under a vault key wrapped by the passphrase |
| Keys | One | One | One per provider (any name) |
| The user types | Nothing | Nothing | A passphrase on each load (unless remembered on the device) |
| Copy of the browser profile (backup, stolen disk, forensic dump) | Reads the key | Gets ciphertext, and the key that decrypts it is in the same profile: protected only as far as the browser protects its non-extractable keys | Gets ciphertext; has to guess the passphrase, at the cost of the KDF per guess |
| Script in the page (XSS, a compromised dependency) | Reads the key | Has the browser decrypt it at any time | Reads keys only while the vault is unlocked; nothing while locked |
| A browser extension or the OS | Reads the key | Reads the key | Reads the key while unlocked, or captures the passphrase |

- `webStorage`: an app that already stores keys this way, or keys with no value (a local server).
- `secureStorage`: the default. No prompt, and nothing readable in a dump of the storage, but a
  script running in the page can still use the key.
- The vault: keys worth a prompt (paid accounts, several providers), shared or unmanaged devices,
  and apps where a script loaded later should not be able to read keys at any time. It does not
  protect against a script that runs while the vault is unlocked, or that shows a fake passphrase
  prompt: a strict Content-Security-Policy is still what keeps foreign code out of the page.

### Key vault

```ts
import { createKeyVault, createLlmSettingsStore, vaultStorage } from "llm-connect";

const vault = createKeyVault({ dbName: "my-app-vault", autoLockMs: 15 * 60_000 });
if ((await vault.load()) === "empty") await vault.create(passphrase);
else if (vault.isLocked) await vault.unlock(passphrase);

await vault.set("anthropic", key); // any name; vaultStorage uses the provider id
await vault.get("anthropic"); // the key, or null
await vault.list(); // ["anthropic"]: names, never values

const store = createLlmSettingsStore({
  catalog: "/models.json",
  storage: vaultStorage({ vault, prefsKey: "my-app-ai" }),
});
```

States (`vault.getState()`, `vault.subscribe(listener)`, `vault.isLocked`): `loading` (storage not
read yet), `empty` (no vault: `create`), `locked` (`unlock`), `unlocked`.

| Method | |
|--------|-|
| `load()` | Read storage once, and unlock with the device key when one is remembered; the other methods call it |
| `create(passphrase, { rememberOnDevice? })` | A new vault, unlocked; `exists` when there is one |
| `unlock(passphrase, { rememberOnDevice? })` | `wrong-passphrase` on a wrong one, and the vault stays locked |
| `lock()` | Drop the vault key from memory; reads that were in flight fail with `locked` |
| `touch()` | Restart the `autoLockMs` timer (user activity); every read and write also does |
| `changePassphrase(old, new)` | Rewrap the vault key under the new passphrase; secrets are not re-encrypted |
| `get(name)`, `set(name, secret)` | Need the vault unlocked (`locked` otherwise) |
| `delete(name)`, `list()` | Also work while locked: names are stored in clear, and deleting needs no key |
| `isRememberedOnDevice()`, `forgetDevice()` | Whether the vault unlocks itself on load; remove that copy |
| `reset()` (alias `destroy()`) | Delete the vault and every secret, without the passphrase |

Errors are `KeyVaultError`s with a `code`: `no-vault`, `exists`, `locked`, `wrong-passphrase`,
`invalid-input` (an empty passphrase or name), `tampered`, `unsupported` (an unknown format or
KDF, or parameters out of bounds) or `storage` (IndexedDB refused a write).

**A lost passphrase cannot be recovered.** Nothing else unwraps the vault key, so the secrets are
gone with it. `reset()` is the only way out: it works while locked, asks for no passphrase, and
deletes the wrapped vault key, its salt and KDF parameters, the device copy and every secret from
IndexedDB, then returns the vault to `empty`. It cannot be undone. Other databases are not touched.

How it is built (WebCrypto only, no dependency):

- **Secrets**: each one is encrypted with AES-GCM 256 under a random 256-bit vault key, with a fresh
  12-byte IV on every write. The additional data binds the record to the format version
  (`llm-connect-vault/1`), the vault id (16 random bytes) and its name, so a record that is edited,
  moved to another name or copied from another vault fails to decrypt (`tampered`).
- **Passphrase**: normalised to NFKC, then PBKDF2-HMAC-SHA256 with 600 000 iterations (OWASP's
  recommendation) and a random 16-byte salt. HKDF-SHA256 turns the output into an AES-GCM key that
  wraps the vault key and an HMAC key whose tag over the vault id tells a wrong passphrase
  (`wrong-passphrase`) from tampering (`tampered`). The KDF, its parameters and the salt are
  stored with the vault, so later versions can change the defaults; a stored iteration count
  outside 100 000 to 10 000 000 is refused before anything is derived.
- **Your own KDF**: pass `kdf` to use Argon2id or another function without llm-connect depending
  on it. New and changed passphrases use it; a vault wrapped with PBKDF2 still opens, and is
  rewrapped with the configured KDF on its next unlock.

  ```ts
  import { argon2id } from "hash-wasm";

  const vault = createKeyVault({
    dbName: "my-app-vault",
    kdf: {
      id: "argon2id",
      params: { m: 65536, t: 3, p: 1 },
      derive: (password, salt, { m, t, p }) =>
        argon2id({
          password,
          salt,
          memorySize: Number(m),
          iterations: Number(t),
          parallelism: Number(p),
          hashLength: 32,
          outputType: "binary",
        }),
    },
  });
  ```

- **In memory**: only the vault key while unlocked, as a non-extractable `CryptoKey`. Secrets are
  decrypted on each `get` and not cached.
- **`rememberOnDevice: true`** also wraps the vault key with a non-extractable `CryptoKey` kept in
  IndexedDB, so the vault unlocks itself on the next load. This is a convenience: it gives up the
  protection against same-origin script, which can again use the keys at any time, exactly as with
  `secureStorage`. A copy of the browser profile still only yields ciphertext. `lock()` holds for
  the page; `forgetDevice()` or `unlock(passphrase, { rememberOnDevice: false })` removes the copy.
- **Fallbacks**: without IndexedDB (some private modes) the vault works in memory for the page
  (`vault.persistent` is false); without WebCrypto (an insecure context) secrets are kept in memory
  unencrypted and `lock()` forgets them, as `secureStorage` keeps its key for the page.

`vaultStorage` stores the key of the saved settings under `keyName(settings)` (the provider id, or
`"custom"` for a custom endpoint), so each provider keeps its own; preferences go to `localStorage`
without the key. While the vault is locked the key reads as empty (`load()` gives null for a
provider) and saving a key throws `locked`. A key saved with `rememberKey: false` stays in memory
for the page and is forgotten on lock. `clear()` removes the saved provider's key only; the vault
keeps the others (`vault.reset()` removes everything). To fill the form when the user switches
provider, read `vault.get(providerId)` and pass it to `store.setApiKey`.

`migrateToVault(from, to)` moves saved settings from `secureStorage` or `webStorage` to a
`vaultStorage`: the key is written to the (unlocked) vault first, then `from.clear()` erases the old
copy (and `secureStorage`'s `CryptoKey`), then the preferences are written again. It resolves to
whether a key moved.

```ts
const legacy = secureStorage({ prefsKey: "my-app-ai", dbName: "my-app-secrets" });
const storage = vaultStorage({ vault, prefsKey: "my-app-ai" });
await vault.unlock(passphrase);
await migrateToVault(legacy, storage);
```

`isConfigured(settings)` tells whether settings can call a model: a provider key, or a custom
endpoint **with a model name** (local servers need no key).

### Security

- `endpointProblem(url)` / `validateEndpoint(url)` accept https anywhere and http only on this
  machine (`localhost`, `127.0.0.0/8`, `[::1]`), so a key never crosses the network in clear.
  `save()` answers `insecure-endpoint` and `testConnection` does not call such an endpoint. A URL
  with a user name or password is `invalid-endpoint`: fetch refuses it.
- `strictHeaders` keeps every request to the headers the provider's API defines, so nothing
  identifying leaves and nothing fails the CORS preflight.
- A matching CSP: `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`.

### Response language

`RESPONSE_LANGUAGES` lists 16 languages as `{ code, name, label }` (`fr`, `French`, `Français`).
Settings store the code; `languageName(codeOrName)` gives the English name for a prompt (it also
reads the names older settings stored), `toLanguageCode(value)` migrates them, and
`browserLanguage()` is the default.

```ts
const system = `Answer in ${languageName(settings.language)}.`;
```

## Speech to text

`transcribe(settings, audio, options)` sends audio to the transcription model of the provider the
settings already point to, with the same key and the same guarded fetch, and always answers one
shape:

```ts
import { transcribe, transcriptionProblem, toWebVtt } from "llm-connect";

const problem = transcriptionProblem(settings); // null, or { code, message } to show
const t = await transcribe(settings, recordingBlob, { language: "fr", vocabulary: ["stepcast"] });
// t.text, t.language, t.duration
// t.segments: [{ text, start, end }]  about a sentence each, in seconds
// t.words:    [{ text, start, end }]
// t.wordTimings: "exact" | "estimated" | "none"
const vtt = toWebVtt(t);
```

| Provider | Model (default) | Word timings |
| --- | --- | --- |
| OpenAI | `whisper-1` (`gpt-4o-transcribe` on request) | exact with Whisper |
| Gemini | `gemini-3.5-transcribe` | exact |
| Mistral | `voxtral-mini-latest` | exact |
| Groq | `whisper-large-v3-turbo` | exact |
| A custom OpenAI-compatible server | the `model` you name | when it sends them |
| Anthropic | none: `transcriptionProblem` says so | |

A `MediaRecorder` blob works as is: its own type is sent (the AI SDK does not recognise WebM or
MP4 audio from their bytes). When a model gives only segments, words are estimated inside them;
when it gives words, segments are rebuilt at sentence ends and pauses. Providers cap uploads (25 MB
for OpenAI and Groq), so cut long recordings first. `loadTranscriptionModel(settings)` returns the
AI SDK model itself, and `transcriptionTargetOf(settings)` the SDK, model and URL it uses.

### NVIDIA Parakeet and Canary in the page

`llm-connect/nemo` runs NVIDIA's NeMo speech models in the browser with
[onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) (install `onnxruntime-web`): no
key, nothing leaves the device, same `Transcript` shape. They hear better than Whisper and keep
the fillers ("euh", "um") that text-based editing removes.

| Model | Languages | Word timings | Download |
| --- | --- | --- | --- |
| `parakeet` (default): Parakeet TDT 0.6B v3 | 25 European ones, found by the model | exact (transducer frames, 80 ms) | ~670 MB |
| `canary`: Canary 180M Flash | English, French, German, Spanish | spread over each phrase | ~215 MB |

```ts
// On the page
import { decodeAudio } from "llm-connect/nemo";
const samples = await decodeAudio(blob); // 16 kHz mono
worker.postMessage(samples, [samples.buffer]);

// In a worker
import { loadNemo, nemoSupports } from "llm-connect/nemo";
const nemo = await loadNemo({
  model: "parakeet",
  wasmPaths: "/ort/", // serve onnxruntime-web's .wasm files yourself
  onProgress: ({ ratio }) => postMessage({ progress: ratio }),
});
const transcript = await nemo.transcribe(samples, { onProgress: (r) => postMessage({ done: r }) });
```

The files (istupakov's ONNX exports, int8, with NeMo's mel front end) come from Hugging Face once,
then from Cache Storage (`llm-connect-models`); pass `baseUrl` to serve them yourself and `cache:
null` to keep nothing. Long audio is cut at its quietest moments (30 s at most for Parakeet).
Canary's own timestamp tokens drift in the ONNX export, so it is cut at every pause and each
phrase's time is spread over its words: pick it for a smaller download, Parakeet for editing to
the word. Canary needs the spoken language (`language`, the browser's by default); Parakeet does
not. `nemoSupports(model, language)` says whether one fits, so an app can fall back to Whisper.

It runs on WebAssembly, about three times faster than real time on a laptop. Any onnxruntime with
the same API fits (`runtime`, for instance onnxruntime-node with `executionProviders: ["cpu"]`).
A CSP needs `'wasm-unsafe-eval'` in `script-src` and `https:` (or `https://huggingface.co
https://*.hf.co`) in `connect-src`.

### Whisper in the page

`llm-connect/whisper` runs Whisper in the browser with
[transformers.js](https://github.com/huggingface/transformers.js) (install
`@huggingface/transformers`): no key, nothing leaves the device, same `Transcript` shape.

| Preset | Model | Download |
| --- | --- | --- |
| `fast` | `onnx-community/whisper-base_timestamped` | ~80 MB |
| `balanced` | `onnx-community/whisper-small_timestamped` | ~250 MB |
| `accurate` | `onnx-community/whisper-large-v3-turbo_timestamped` (WebGPU) | ~600 MB |

```ts
// On the page: decode any audio or video file to 16 kHz mono samples
import { decodeAudio } from "llm-connect/whisper";
const samples = await decodeAudio(blob);
worker.postMessage(samples, [samples.buffer]);

// In a worker
import { loadWhisper, recommendedWhisperPreset } from "llm-connect/whisper";
const whisper = await loadWhisper({
  preset: await recommendedWhisperPreset(), // accurate on WebGPU, fast otherwise
  wasmPaths: "/ort/", // serve onnxruntime-web's .wasm files yourself
  onProgress: ({ ratio }) => postMessage({ progress: ratio }),
});
const transcript = await whisper.transcribe(samples, { language: "fr" });
```

Whisper in the page does not detect the spoken language, and without one it decodes in English
(French speech comes back translated). Pass `language` when you know it; otherwise the browser's
language is used (`spokenLanguage()`).

The model is downloaded once from Hugging Face, then served from the browser's cache. WebGPU is used
when the browser has it, WebAssembly otherwise. A CSP needs `'wasm-unsafe-eval'` in `script-src`
and `https:` (or `https://huggingface.co https://*.hf.co`) in `connect-src`.

## React

```tsx
import { useEffect } from "react";
import { liveCatalog } from "llm-connect";
import { useLlmStore } from "llm-connect/react";

function Settings({ storage }) {
  const { state, store } = useLlmStore({ catalog: liveCatalog({ fallbackUrl: "/models.json" }), storage });
  useEffect(() => {
    store.load().then(() => store.open());
  }, [store]);

  return (
    <>
      <select value={state.draft.providerId} onChange={(e) => store.selectProvider(e.target.value)}>
        {[...state.providers.recommended, ...state.providers.others].map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {state.models.map((m) => (
        <button key={m.id} aria-pressed={state.draft.model === m.id} onClick={() => store.selectModel(m.id)}>
          {m.name}
        </button>
      ))}
      <input type="password" value={state.apiKey} onChange={(e) => store.setApiKey(e.target.value)} />
      <button disabled={!state.canSave} onClick={() => store.save()}>Save</button>
    </>
  );
}
```

`useLlmSettings(store)` subscribes to a store created elsewhere.

`useKeyVault(vault)` reads the vault's storage on mount and returns `{ state, isLocked, create,
unlock, lock, reset, vault }`, re-rendering on every state change:

```tsx
import { useKeyVault } from "llm-connect/react";

function VaultGate({ vault, children }) {
  const { state, unlock, create, reset } = useKeyVault(vault);
  if (state === "loading") return null;
  if (state === "unlocked") return children;
  return (
    <form onSubmit={(e) => { e.preventDefault(); const p = e.currentTarget.passphrase.value; state === "empty" ? create(p) : unlock(p); }}>
      <input name="passphrase" type="password" autoComplete="current-password" />
      <button>{state === "empty" ? "Create" : "Unlock"}</button>
      {state === "locked" && <button type="button" onClick={reset}>Forgot it: delete every key</button>}
    </form>
  );
}
```

## Svelte

The store follows Svelte's store contract (`subscribe` calls back at once and returns the
unsubscribe), so `$store` is its state:

```svelte
<script>
  import { createLlmSettingsStore, secureStorage } from "llm-connect";
  const store = createLlmSettingsStore({
    catalog: "/models.json",
    storage: secureStorage({ prefsKey: "ai", dbName: "ai-secrets" }),
  });
  store.load().then(() => store.open());
</script>

<select value={$store.draft.providerId} on:change={(e) => store.selectProvider(e.currentTarget.value)}>
  {#each $store.providers.recommended.concat($store.providers.others) as p}
    <option value={p.id}>{p.name}</option>
  {/each}
</select>
<input type="password" value={$store.apiKey} on:input={(e) => store.setApiKey(e.currentTarget.value)} />
<button disabled={!$store.canSave} on:click={() => store.save()}>Save</button>
```

## Vanilla

```ts
const stop = store.subscribe((state) => render(state));
```

## License

MIT
