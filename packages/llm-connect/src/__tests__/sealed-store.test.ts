import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { SealedStoreUnavailable, sealedStore } from "../sealed-store.js";

const SECRET = "ghp_secret-token-123";

/** Every value IndexedDB holds for a database, by key. */
function readAll(dbName: string): Promise<Map<string, unknown>> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(dbName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const out = new Map<string, unknown>();
      if (!db.objectStoreNames.contains("kv")) {
        db.close();
        resolve(out);
        return;
      }
      const tx = db.transaction("kv", "readonly");
      const cursor = tx.objectStore("kv").openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        out.set(String(c.key), c.value);
        c.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(out);
      };
    };
  });
}

/** Overwrite one stored value. */
function write(dbName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(dbName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("sealedStore", () => {
  it("stores values sealed, never in clear, with a fresh IV each time", async () => {
    const store = sealedStore({ dbName: "app-secrets" });
    expect(await store.set("token", SECRET)).toBe(true);
    expect(await store.get("token")).toBe(SECRET);

    const first = (await readAll("app-secrets")).get("token") as { iv: Uint8Array; v: number };
    expect(first.v).toBe(2);
    const decoder = new TextDecoder();
    for (const value of (await readAll("app-secrets")).values()) {
      if (value instanceof CryptoKey) continue;
      expect(JSON.stringify(value)).not.toContain(SECRET);
      expect(decoder.decode((value as { ciphertext: ArrayBuffer }).ciphertext)).not.toContain(
        SECRET,
      );
    }
    await store.set("token", SECRET);
    const second = (await readAll("app-secrets")).get("token") as { iv: Uint8Array };
    expect([...second.iv]).not.toEqual([...first.iv]);
  });

  it("binds the name: a record copied under another name does not open", async () => {
    const store = sealedStore({ dbName: "app-secrets" });
    await store.set("token", SECRET);
    await write("app-secrets", "other", (await readAll("app-secrets")).get("token"));
    expect(await store.get("other")).toBeNull();
  });

  it("opens records written before names were bound", async () => {
    const store = sealedStore({ dbName: "app-secrets" });
    await store.set("warm-up", "x"); // creates the CryptoKey
    const key = (await readAll("app-secrets")).get("crypto-key") as CryptoKey;
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(SECRET),
    );
    await write("app-secrets", "api-key", { iv, ciphertext });
    expect(await store.get("api-key")).toBe(SECRET);
  });

  it("reads a tampered value, or one sealed under a destroyed key, as missing", async () => {
    const store = sealedStore({ dbName: "app-secrets" });
    await store.set("token", SECRET);
    const record = (await readAll("app-secrets")).get("token") as { ciphertext: ArrayBuffer };
    const bytes = new Uint8Array(record.ciphertext.slice(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    await write("app-secrets", "token", { ...record, ciphertext: bytes.buffer });
    expect(await store.get("token")).toBeNull();

    const sealed = await store.seal("token", SECRET);
    await store.destroy();
    expect(await store.unseal("token", sealed)).toBeNull();
    expect((await readAll("app-secrets")).size).toBe(0);
  });

  it("deletes one value and leaves the others", async () => {
    const store = sealedStore({ dbName: "app-secrets" });
    await store.set("a", "1");
    await store.set("b", "2");
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBe("2");
  });

  it("keeps one CryptoKey when two stores of the same database start together", async () => {
    const one = sealedStore({ dbName: "app-secrets" });
    const two = sealedStore({ dbName: "app-secrets" });
    await Promise.all([one.set("a", "1"), two.set("b", "2")]);
    expect(await one.get("b")).toBe("2");
    expect(await two.get("a")).toBe("1");
  });

  it("says when nothing can be stored, and never falls back to clear text", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error: a browser without IndexedDB (some private modes)
    delete globalThis.indexedDB;
    try {
      const store = sealedStore({ dbName: "app-secrets" });
      expect(store.available).toBe(false);
      expect(await store.set("token", SECRET)).toBe(false);
      expect(await store.get("token")).toBeNull();
      await expect(store.seal("token", SECRET)).rejects.toBeInstanceOf(SealedStoreUnavailable);
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it("says when the write was refused (quota)", async () => {
    const store = sealedStore({ dbName: "app-secrets" });
    await store.set("warm-up", "x");
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    try {
      expect(await store.set("token", SECRET)).toBe(false);
    } finally {
      IDBObjectStore.prototype.put = original;
    }
  });
});
