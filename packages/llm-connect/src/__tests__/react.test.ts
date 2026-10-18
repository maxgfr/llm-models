import "fake-indexeddb/auto";
import { afterAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { IDBFactory } from "fake-indexeddb";
import { createKeyVault } from "../key-vault.js";
import type { SettingsStorage } from "../storage.js";
import { createLlmSettingsStore } from "../store.js";

// The DOM must exist before react-dom and Testing Library load
GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());
const { act, renderHook, waitFor } = await import("@testing-library/react");
const { useKeyVault, useLlmSettings, useLlmStore } = await import("../react.js");

const storage: SettingsStorage = {
  load: async () => null,
  save: async () => {},
  clear: async () => {},
};

const options = {
  catalogUrl: "/models.json",
  storage,
  fetch: (async () =>
    new Response(
      JSON.stringify({
        mistral: {
          id: "mistral",
          name: "Mistral",
          npm: "@ai-sdk/mistral",
          defaultModel: "mistral-large-4",
          models: { "mistral-large-4": { id: "mistral-large-4", name: "Mistral Large 4" } },
        },
      }),
    )) as unknown as typeof fetch,
};

describe("llm-connect/react", () => {
  it("useLlmStore keeps one store and re-renders on its changes", async () => {
    const { result, rerender } = renderHook(() =>
      useLlmStore({ ...options, recommended: ["mistral"] }),
    );
    const first = result.current.store;
    expect(result.current.state.catalogStatus).toBe("idle");

    act(() => result.current.store.open());
    await waitFor(() => expect(result.current.state.catalogStatus).toBe("ready"));
    expect(result.current.state.draft).toMatchObject({
      providerId: "mistral",
      model: "mistral-large-4",
    });

    act(() => result.current.store.setApiKey("mk"));
    expect(result.current.state.apiKey).toBe("mk");
    expect(result.current.state.canSave).toBe(true);

    rerender();
    expect(result.current.store).toBe(first);
  });

  it("useLlmSettings follows a store created outside React", () => {
    const store = createLlmSettingsStore(options);
    const { result } = renderHook(() => useLlmSettings(store));
    act(() => store.setSearch("large"));
    expect(result.current.search).toBe("large");
  });

  it("useKeyVault follows the lock state and unlocks, locks and resets", async () => {
    globalThis.indexedDB = new IDBFactory();
    await createKeyVault({ dbName: "react-vault" }).create("a passphrase");
    const vault = createKeyVault({ dbName: "react-vault" });
    const { result } = renderHook(() => useKeyVault(vault));
    await waitFor(() => expect(result.current.state).toBe("locked"));
    expect(result.current.isLocked).toBe(true);

    await act(() => result.current.unlock("a passphrase"));
    expect(result.current.state).toBe("unlocked");
    expect(result.current.isLocked).toBe(false);

    act(() => result.current.lock());
    expect(result.current.state).toBe("locked");

    await act(() => result.current.reset());
    expect(result.current.state).toBe("empty");
    await act(() => result.current.create("another passphrase"));
    expect(result.current.state).toBe("unlocked");
    expect(result.current.vault).toBe(vault);
  });
});
