import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createKeyVault, type KeyVault } from "../key-vault.js";
import { secureStorage } from "../secure-storage.js";
import { webStorage } from "../storage.js";
import { createLlmSettingsStore } from "../store.js";
import { defaultKeyName, migrateToVault, vaultStorage } from "../vault-storage.js";
import { installStorages } from "./memory-storage.js";

const PASSPHRASE = "correct horse battery staple";
let stores: ReturnType<typeof installStorages>;
let vault: KeyVault;

function dump(storage: Storage): string {
  let text = "";
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i) ?? "";
    text += `${key}=${storage.getItem(key)}\n`;
  }
  return text;
}

/** Every value of an IndexedDB database's "kv" store (secureStorage's). */
function readKv(name: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.close();
        return resolve([]);
      }
      const request = db.transaction("kv").objectStore("kv").getAll();
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    };
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  stores = installStorages();
  vault = createKeyVault({ dbName: "vault" });
});
afterEach(() => stores.restore());

describe("vaultStorage", () => {
  it("names a key after the provider, or custom", () => {
    expect(defaultKeyName({ providerId: "anthropic" })).toBe("anthropic");
    expect(defaultKeyName({ providerId: "anthropic", customEndpoint: "http://localhost" })).toBe(
      "custom",
    );
    expect(defaultKeyName({})).toBe("openai");
  });

  it("keeps the key in the vault and the preferences in localStorage", async () => {
    await vault.create(PASSPHRASE);
    const storage = vaultStorage({ vault, prefsKey: "prefs" });
    await storage.save(
      { apiKey: "test-key-1", model: "claude", providerId: "anthropic" },
      { rememberKey: true },
    );
    expect(await vault.list()).toEqual(["anthropic"]);
    expect(await vault.get("anthropic")).toBe("test-key-1");
    expect(JSON.parse(stores.local.getItem("prefs") ?? "")).toEqual({
      model: "claude",
      providerId: "anthropic",
      rememberKey: true,
    });
    expect(dump(stores.local) + dump(stores.session)).not.toContain("test-key-1");
    expect(await storage.load()).toMatchObject({ apiKey: "test-key-1", providerId: "anthropic" });
  });

  it("reads no key while the vault is locked", async () => {
    await vault.create(PASSPHRASE);
    const storage = vaultStorage({ vault, prefsKey: "prefs" });
    await storage.save(
      { apiKey: "test-key-1", model: "gpt", providerId: "openai" },
      { rememberKey: true },
    );

    const reloaded = createKeyVault({ dbName: "vault" });
    const locked = vaultStorage({ vault: reloaded, prefsKey: "prefs" });
    expect(await locked.load()).toBeNull();
    expect(await locked.loadDraft?.()).toMatchObject({ apiKey: "", model: "gpt" });
    await expect(
      locked.save({ apiKey: "test-key-2", model: "gpt" }, { rememberKey: true }),
    ).rejects.toMatchObject({ code: "locked" });

    await reloaded.unlock(PASSPHRASE);
    expect((await locked.load())?.apiKey).toBe("test-key-1");
  });

  it("feeds the settings store once unlocked", async () => {
    await vault.create(PASSPHRASE);
    await vaultStorage({ vault, prefsKey: "prefs" }).save(
      { apiKey: "test-key-1", model: "mistral-large", providerId: "mistral" },
      { rememberKey: true },
    );
    const reloaded = createKeyVault({ dbName: "vault" });
    const store = createLlmSettingsStore({
      catalog: async () => ({}),
      storage: vaultStorage({ vault: reloaded, prefsKey: "prefs" }),
    });
    await store.load();
    expect(store.getState().draft).toMatchObject({ providerId: "mistral", apiKey: "" });
    await reloaded.unlock(PASSPHRASE);
    await store.load();
    expect(store.getState().draft).toMatchObject({ providerId: "mistral", apiKey: "test-key-1" });
  });

  it("keeps one key per provider, and clear removes the saved one only", async () => {
    await vault.create(PASSPHRASE);
    const storage = vaultStorage({ vault, prefsKey: "prefs" });
    await storage.save(
      { apiKey: "test-key-1", model: "gpt", providerId: "openai" },
      { rememberKey: true },
    );
    await storage.save(
      { apiKey: "test-key-2", model: "claude", providerId: "anthropic" },
      { rememberKey: true },
    );
    expect(await vault.list()).toEqual(["anthropic", "openai"]);
    expect(await vault.get("openai")).toBe("test-key-1");

    await storage.clear();
    expect(await vault.list()).toEqual(["openai"]);
    expect(stores.local.getItem("prefs")).toBeNull();
  });

  it("keeps a key for the session in memory and forgets it on lock", async () => {
    await vault.create(PASSPHRASE);
    const storage = vaultStorage({ vault, prefsKey: "prefs" });
    await storage.save(
      { apiKey: "test-key-1", model: "gpt", providerId: "openai" },
      { rememberKey: false },
    );
    expect(await vault.list()).toEqual([]);
    expect((await storage.load())?.apiKey).toBe("test-key-1");
    vault.lock();
    expect(await storage.load()).toBeNull();
  });

  it("saves a keyless custom endpoint while locked", async () => {
    const storage = vaultStorage({ vault, prefsKey: "prefs" });
    await storage.save(
      { apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1", customModel: "llama" },
      { rememberKey: true },
    );
    expect(await storage.load()).toMatchObject({ customModel: "llama", apiKey: "" });
  });
});

describe("migrateToVault", () => {
  it("moves a key from webStorage and erases the old copy", async () => {
    const from = webStorage({ prefsKey: "prefs", apiKeyKey: "key" });
    await from.save(
      { apiKey: "test-key-1", model: "gpt", providerId: "openai", language: "fr" },
      { rememberKey: true },
    );
    await vault.create(PASSPHRASE);
    const to = vaultStorage({ vault, prefsKey: "prefs" });
    expect(await migrateToVault(from, to)).toBe(true);
    expect(await vault.get("openai")).toBe("test-key-1");
    expect(dump(stores.local) + dump(stores.session)).not.toContain("test-key-1");
    expect(stores.local.getItem("key")).toBeNull();
    expect(await to.load()).toMatchObject({
      apiKey: "test-key-1",
      model: "gpt",
      language: "fr",
      rememberKey: true,
    });
    // Nothing left to move
    expect(await migrateToVault(from, to)).toBe(false);
  });

  it("moves a key from secureStorage and erases its ciphertext and CryptoKey", async () => {
    const from = secureStorage({ prefsKey: "old-prefs", dbName: "old-secrets" });
    await from.save(
      { apiKey: "test-key-2", model: "claude", providerId: "anthropic" },
      { rememberKey: true },
    );
    expect(await readKv("old-secrets")).toHaveLength(2);
    await vault.create(PASSPHRASE);
    const to = vaultStorage({ vault, prefsKey: "prefs" });
    expect(await migrateToVault(from, to)).toBe(true);
    expect(await readKv("old-secrets")).toEqual([]);
    expect(stores.local.getItem("old-prefs")).toBeNull();
    expect(await to.load()).toMatchObject({ apiKey: "test-key-2", providerId: "anthropic" });
  });

  it("leaves the old copy in place while the vault is locked", async () => {
    const from = webStorage({ prefsKey: "prefs", apiKeyKey: "key" });
    await from.save({ apiKey: "test-key-1", model: "gpt" }, { rememberKey: true });
    await createKeyVault({ dbName: "vault" }).create(PASSPHRASE);
    const locked = createKeyVault({ dbName: "vault" });
    await expect(
      migrateToVault(from, vaultStorage({ vault: locked, prefsKey: "prefs" })),
    ).rejects.toMatchObject({ code: "locked" });
    expect(stores.local.getItem("key")).toBe("test-key-1");
  });
});
