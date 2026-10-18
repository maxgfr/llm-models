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
- Anthropic gets the `anthropic-dangerous-direct-browser-access` header, and an Anthropic-compatible
  provider (MiniMax…) its own base URL, so its key never goes to Anthropic.
- The generic SDK refuses a provider without URL, and turns structured output (`json_schema`) into
  `json_object` plus the schema in a system message, for APIs such as GLM.

## Test a connection

```ts
import { testConnection } from "llm-connect";

const result = await testConnection(settings); // lists the models: costs nothing
if (!result.ok) console.log(result.reason); // "auth" | "cors" | "http" | "timeout" | "config" | "insecure"
```

A test is free unless you ask for a generation:

- `models` (default): `GET {base}/models` with the provider's own auth headers (`x-api-key` for
  Anthropic, `x-goog-api-key` for Google, a bearer token otherwise). 5 s for a custom endpoint, 10 s
  for a provider. Returns the model ids a server lists. Never runs a generation.
- `generate`: a short generation through the AI SDK, exactly as the app will call the model. It
  spends a few tokens of the user's quota, so it only runs when you pass `mode: "generate"`.
- `auto`: `models` first, then the generation only when the server has no model list to give
  (404, 405 or 501, the request blocked by the browser, or no API URL). A refused key (401/403),
  another status or a timeout stays the verdict. Passing `auto` opts in to that generation.

A custom endpoint in plain http to another machine is not called at all (`insecure`).

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
`toggleCustom`, `applyPreset(ENDPOINT_PRESETS.ollama)`, `setEndpoint`, `setCustomModel`,
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
  `save()` answers `insecure-endpoint` and `testConnection` does not call such an endpoint.
- A matching CSP: `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`.

### Response language

`RESPONSE_LANGUAGES` lists 16 languages as `{ code, name, label }` (`fr`, `French`, `Français`).
Settings store the code; `languageName(codeOrName)` gives the English name for a prompt (it also
reads the names older settings stored), `toLanguageCode(value)` migrates them, and
`browserLanguage()` is the default.

```ts
const system = `Answer in ${languageName(settings.language)}.`;
```

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
