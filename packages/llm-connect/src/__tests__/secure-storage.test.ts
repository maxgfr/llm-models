import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { secureStorage } from "../secure-storage.js";
import { installStorages } from "./memory-storage.js";

const KEY = "sk-ant-secret-123";
const options = { prefsKey: "prefs", dbName: "secrets" };
let stores: ReturnType<typeof installStorages>;

/** Everything IndexedDB holds for the test database. */
function readSecrets(): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("secrets");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.close();
        resolve([]);
        return;
      }
      const request = db.transaction("kv", "readonly").objectStore("kv").getAll();
      request.onsuccess = () => {
        db.close();
        resolve(request.result as unknown[]);
      };
      request.onerror = () => reject(request.error);
    };
  });
}

/** Every value of a Web Storage, joined. */
function dump(storage: Storage): string {
  let text = "";
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i) ?? "";
    text += `${key}=${storage.getItem(key)}\n`;
  }
  return text;
}

/** Whether the key appears in clear anywhere: Web Storage, or IndexedDB values and bytes. */
async function leaks(): Promise<boolean> {
  if (dump(stores.local).includes(KEY) || dump(stores.session).includes(KEY)) return true;
  const decoder = new TextDecoder();
  for (const value of await readSecrets()) {
    if (value instanceof CryptoKey) continue;
    if (JSON.stringify(value).includes(KEY)) return true;
    const { ciphertext } = value as { ciphertext?: ArrayBuffer };
    if (ciphertext && decoder.decode(ciphertext).includes(KEY)) return true;
  }
  return false;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  stores = installStorages();
});
afterEach(() => stores.restore());

describe("secureStorage", () => {
  it("encrypts a remembered key into IndexedDB under a non-extractable key", async () => {
    await secureStorage(options).save(
      { apiKey: KEY, model: "claude", providerId: "anthropic", language: "fr" },
      { rememberKey: true },
    );
    expect(await leaks()).toBe(false);
    expect(stores.session.length).toBe(0);
    expect(JSON.parse(stores.local.getItem("prefs") ?? "")).toEqual({
      model: "claude",
      providerId: "anthropic",
      language: "fr",
      rememberKey: true,
    });
    const secrets = await readSecrets();
    const cryptoKey = secrets.find((value) => value instanceof CryptoKey) as CryptoKey;
    expect(cryptoKey.extractable).toBe(false);
    expect(cryptoKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });

    // A reload: a new instance decrypts it
    expect(await secureStorage(options).load()).toEqual({
      apiKey: KEY,
      model: "claude",
      providerId: "anthropic",
      language: "fr",
      rememberKey: true,
    });
  });

  it("keeps a key for the tab encrypted in sessionStorage", async () => {
    await secureStorage(options).save({ apiKey: KEY, model: "m" }, { rememberKey: false });
    expect(await leaks()).toBe(false);
    expect(stores.session.getItem("prefs-key")).toContain("ciphertext");
    expect((await readSecrets()).filter((value) => !(value instanceof CryptoKey))).toEqual([]);

    // Reloading the tab keeps it
    expect((await secureStorage(options).load())?.apiKey).toBe(KEY);
    // Closing the tab loses it
    stores.session.clear();
    const reopened = secureStorage(options);
    expect(await reopened.load()).toBeNull();
    expect(await reopened.loadDraft?.()).toMatchObject({ apiKey: "", model: "m" });
  });

  it("uses a fresh IV on every save", async () => {
    const storage = secureStorage(options);
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: false });
    const first = stores.session.getItem("prefs-key");
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: false });
    expect(stores.session.getItem("prefs-key")).not.toBe(first);
  });

  it("moves the key when remembering is turned on or off", async () => {
    const storage = secureStorage(options);
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: true });
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: false });
    expect((await readSecrets()).some((value) => !(value instanceof CryptoKey))).toBe(false);
    expect(stores.session.getItem("prefs-key")).not.toBeNull();
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: true });
    expect(stores.session.getItem("prefs-key")).toBeNull();
    expect((await secureStorage(options).load())?.apiKey).toBe(KEY);
  });

  it("counts a keyless custom endpoint with a model as configured", async () => {
    await secureStorage(options).save(
      {
        apiKey: "",
        model: "",
        customEndpoint: "http://localhost:11434/v1",
        customModel: "llama3.2",
      },
      { rememberKey: false },
    );
    expect(await secureStorage(options).load()).toMatchObject({
      apiKey: "",
      customEndpoint: "http://localhost:11434/v1",
      customModel: "llama3.2",
    });
  });

  it("clears the preferences, the ciphertext and the CryptoKey", async () => {
    const storage = secureStorage(options);
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: true });
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: false });
    await storage.clear();
    expect(stores.local.length + stores.session.length).toBe(0);
    expect(await readSecrets()).toEqual([]);
    expect(await storage.loadDraft?.()).toBeNull();
  });

  it("asks for the key again when the ciphertext cannot be decrypted", async () => {
    await secureStorage(options).save({ apiKey: KEY, model: "m" }, { rememberKey: false });
    stores.session.setItem("prefs-key", JSON.stringify({ iv: "AAAA", ciphertext: "AAAA" }));
    expect(await secureStorage(options).loadDraft?.()).toMatchObject({ apiKey: "" });
  });

  it("keeps the key in memory without IndexedDB", async () => {
    const g = globalThis as { indexedDB?: IDBFactory };
    g.indexedDB = undefined;
    const storage = secureStorage(options);
    await storage.save({ apiKey: KEY, model: "m" }, { rememberKey: true });
    expect(dump(stores.local) + dump(stores.session)).not.toContain(KEY);
    expect((await storage.load())?.apiKey).toBe(KEY);
    expect(await secureStorage(options).load()).toBeNull();
    await storage.clear();
    expect(await storage.loadDraft?.()).toBeNull();
  });
});
