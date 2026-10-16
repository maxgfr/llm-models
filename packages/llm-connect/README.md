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
- **The catalog comes from [llm-models](https://github.com/maxgfr/llm-models/tree/main/packages/llm-models)**: `llm-models catalog` writes the provider
  and model list at build time, with a recommended model per provider.

## Install

```bash
npm install llm-connect llm-models ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral @ai-sdk/openai-compatible
```

`ai` (v6) and the `@ai-sdk/*` packages are optional peers: install the ones your users can pick.
`react` (18+) is only needed for `llm-connect/react`.

Build the catalog once, at build time or from a scheduled job:

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

const result = await testConnection(settings, { mode: "models" });
if (!result.ok) console.log(result.reason); // "auth" | "cors" | "http" | "timeout" | "config"
```

- `models` (default): `GET {base}/models` with the provider's own auth headers (`x-api-key` for
  Anthropic, `x-goog-api-key` for Google, a bearer token otherwise). 5 s for a custom endpoint, 10 s
  for a provider. Returns the model ids a server lists.
- `generate`: a short generation through the AI SDK, exactly as the app will call the model.

`listEndpointModels(endpoint, apiKey?)` lists the models of an OpenAI-compatible server.

## The settings store

`createLlmSettingsStore` holds everything a settings dialog needs: catalog download (one request,
retried on demand), provider and model choice with the recommended model applied, model search,
two key slots (the provider's and the custom endpoint's, so toggling keeps both), local endpoint
presets, connection test, validation and storage.

```ts
import { createLlmSettingsStore, ENDPOINT_PRESETS, webStorage } from "llm-connect";

const store = createLlmSettingsStore({
  catalogUrl: "/models.json",
  storage: webStorage({ prefsKey: "my-app-ai", apiKeyKey: "my-app-ai-key" }),
  recommended: ["openai", "anthropic", "google", "mistral"],
  testMode: "models",
});

await store.load(); // saved settings → draft
store.open(); // a dialog opens: drop unsaved edits, download the catalog
store.selectProvider("anthropic"); // and its recommended model
store.setApiKey("sk-ant-…");
await store.test();
const result = await store.save({ language: "fr" }); // your own fields are kept too
```

State (`store.getState()`): `catalog`, `catalogStatus` (`idle | loading | error | ready`),
`catalogError`, `saved`, `draft`, `search`, `testing`, `testResult`, and derived `provider`,
`providers` (`recommended` / `others`), `isRecommendedProvider`, `models` (filtered by `search`),
`recommendedModel`, `apiKey` (active slot), `canSave`, `canTest`.

Actions: `load`, `reset(settings)` (for settings the app already holds), `open`, `retryCatalog`, `selectProvider`, `selectModel`, `setApiKey`, `setSearch`,
`toggleCustom`, `applyPreset(ENDPOINT_PRESETS.ollama)`, `setEndpoint`, `setCustomModel`,
`setRememberKey`, `settings`, `test`, `save`, `clear`.

### Storage

`webStorage` keeps the preferences in `localStorage` and the key in `sessionStorage` (forgotten
when the tab closes), or in `localStorage` when the user ticks "remember". Every access is guarded:
a blocked storage only means settings that last for the page. Any other scheme fits the
`SettingsStorage` interface (`load`, optional `loadDraft`, `save`, `clear`), for instance a key
encrypted in IndexedDB.

`isConfigured(settings)` tells whether settings can call a model (a key, or a custom endpoint).

## React

```tsx
import { useEffect } from "react";
import { useLlmStore } from "llm-connect/react";

function Settings({ storage }) {
  const { state, store } = useLlmStore({ catalogUrl: "/models.json", storage, recommended: ["openai"] });
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

## Svelte

The store follows Svelte's store contract (`subscribe` calls back at once and returns the
unsubscribe), so `$store` is its state:

```svelte
<script>
  import { createLlmSettingsStore, webStorage } from "llm-connect";
  const store = createLlmSettingsStore({
    catalogUrl: "/models.json",
    storage: webStorage({ prefsKey: "ai", apiKeyKey: "ai-key" }),
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
