import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { webStorage } from "../storage.js";
import { installStorages, MemoryStorage } from "./memory-storage.js";

let stores: ReturnType<typeof installStorages>;
const storage = webStorage<{ language?: string }>({ prefsKey: "prefs", apiKeyKey: "key" });

beforeEach(() => {
  stores = installStorages();
});
afterEach(() => stores.restore());

describe("webStorage", () => {
  it("keeps the key for the session only, unless remembered", async () => {
    await storage.save(
      { apiKey: "sk-1", model: "gpt-5", providerId: "openai" },
      { rememberKey: false },
    );
    expect(stores.session.getItem("key")).toBe("sk-1");
    expect(stores.local.getItem("key")).toBeNull();
    expect(JSON.parse(stores.local.getItem("prefs") ?? "")).toEqual({
      model: "gpt-5",
      providerId: "openai",
      rememberKey: false,
    });

    await storage.save({ apiKey: "sk-2", model: "gpt-5" }, { rememberKey: true });
    expect(stores.local.getItem("key")).toBe("sk-2");
    expect(stores.session.getItem("key")).toBeNull();
  });

  it("loads what it saved, with the app's own fields", async () => {
    await storage.save(
      { apiKey: "sk", model: "claude", providerNpm: "@ai-sdk/anthropic", language: "fr" },
      { rememberKey: true },
    );
    expect(await storage.load()).toEqual({
      apiKey: "sk",
      model: "claude",
      providerNpm: "@ai-sdk/anthropic",
      language: "fr",
      rememberKey: true,
    });
  });

  it("counts a custom endpoint without key as configured", async () => {
    await storage.save(
      {
        apiKey: "",
        model: "",
        customEndpoint: "http://localhost:11434/v1",
        customModel: "llama3.2",
      },
      { rememberKey: false },
    );
    expect(await storage.load()).toMatchObject({ customEndpoint: "http://localhost:11434/v1" });
  });

  it("returns the draft without key, but load() only configured settings", async () => {
    await storage.save({ apiKey: "sk", model: "m" }, { rememberKey: false });
    stores.session.clear(); // the tab was closed
    expect(await storage.load()).toBeNull();
    expect(await storage.loadDraft?.()).toEqual({ apiKey: "", model: "m", rememberKey: false });
    expect(await webStorage({ prefsKey: "none", apiKeyKey: "none" }).loadDraft?.()).toBeNull();
  });

  it("ignores corrupted preferences and non-string fields", async () => {
    stores.local.setItem("prefs", "{not json");
    stores.session.setItem("key", "sk");
    expect(await storage.load()).toEqual({ apiKey: "sk", model: "", rememberKey: false });
    stores.local.setItem("prefs", JSON.stringify({ model: 3, providerId: "", rememberKey: "yes" }));
    expect(await storage.load()).toEqual({ apiKey: "sk", model: "", rememberKey: false });
  });

  it("clears everything", async () => {
    await storage.save({ apiKey: "sk", model: "m" }, { rememberKey: true });
    await storage.clear();
    expect(stores.local.length + stores.session.length).toBe(0);
    expect(await storage.loadDraft?.()).toBeNull();
  });

  it("survives a storage that throws, or none at all", async () => {
    class Throwing extends MemoryStorage {
      override getItem(): string | null {
        throw new Error("SecurityError");
      }
      override setItem() {
        throw new Error("QuotaExceededError");
      }
    }
    const g = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
    g.localStorage = new Throwing();
    g.sessionStorage = new Throwing();
    await storage.save({ apiKey: "sk", model: "m" }, { rememberKey: true });
    expect(await storage.load()).toBeNull();
    await storage.clear();

    g.localStorage = undefined;
    g.sessionStorage = undefined;
    await storage.save({ apiKey: "sk", model: "m" }, { rememberKey: false });
    expect(await storage.load()).toBeNull();
  });
});
