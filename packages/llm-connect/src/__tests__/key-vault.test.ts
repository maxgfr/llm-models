import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  createKeyVault,
  type KeyVaultErrorCode,
  type KeyVaultKdf,
  type KeyVaultState,
  PBKDF2_DEFAULT_ITERATIONS,
  pbkdf2Kdf,
} from "../key-vault.js";

const DB = "vault";
const PASSPHRASE = "correct horse battery staple";
const SECRETS = { openai: "test-key-1", anthropic: "test-key-2", mistral: "test-key-3" };

type Records = Record<"meta" | "secrets", Map<string, unknown>>;

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Every record of the vault database, by store. */
async function readRecords(name = DB): Promise<Records> {
  const db = await openDb(name);
  const records: Records = { meta: new Map(), secrets: new Map() };
  try {
    for (const store of ["meta", "secrets"] as const) {
      if (!db.objectStoreNames.contains(store)) continue;
      await new Promise<void>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          records[store].set(String(cursor.key), cursor.value);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    }
  } finally {
    db.close();
  }
  return records;
}

async function writeRecord(store: "meta" | "secrets", key: string, value: unknown) {
  const db = await openDb(DB);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Every string a value could reveal: JSON, and its bytes as UTF-8, Latin-1 and base64. */
function texts(value: unknown, out: string[] = []): string[] {
  if (value instanceof Uint8Array) {
    out.push(new TextDecoder().decode(value));
    out.push(String.fromCharCode(...value));
    out.push(btoa(String.fromCharCode(...value)));
  } else if (value instanceof ArrayBuffer) {
    texts(new Uint8Array(value), out);
  } else if (value instanceof CryptoKey) {
    // Opaque, non-extractable
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      texts(item, out);
    }
  } else {
    out.push(String(value));
  }
  return out;
}

async function rejectsWith(promise: Promise<unknown>, code: KeyVaultErrorCode) {
  await expect(promise).rejects.toMatchObject({ name: "KeyVaultError", code });
}

function flip(bytes: Uint8Array, index = 0): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index] = (copy[index] ?? 0) ^ 1;
  return copy;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("createKeyVault", () => {
  it("stores secrets that a reloaded page reads after unlocking", async () => {
    const vault = createKeyVault({ dbName: DB });
    expect(await vault.load()).toBe("empty");
    expect(vault.isLocked).toBe(true);
    await vault.create(PASSPHRASE);
    expect(vault.getState()).toBe("unlocked");
    expect(vault.persistent).toBe(true);
    await vault.set("openai", SECRETS.openai);
    expect(await vault.get("openai")).toBe(SECRETS.openai);
    expect(await vault.get("missing")).toBeNull();

    const reloaded = createKeyVault({ dbName: DB });
    expect(await reloaded.load()).toBe("locked");
    await rejectsWith(reloaded.get("openai"), "locked");
    await reloaded.unlock(PASSPHRASE);
    expect(await reloaded.get("openai")).toBe(SECRETS.openai);

    const header = (await readRecords()).meta.get("vault") as {
      format: string;
      id: string;
      kdf: { id: string; params: { iterations: number }; salt: Uint8Array };
    };
    expect(header.format).toBe("llm-connect-vault/1");
    expect(header.id).toMatch(/^[0-9a-f]{32}$/);
    expect(header.kdf.id).toBe("pbkdf2-sha256");
    expect(header.kdf.params.iterations).toBe(PBKDF2_DEFAULT_ITERATIONS);
    expect(PBKDF2_DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(header.kdf.salt).toHaveLength(16);
  });

  it("refuses a wrong passphrase and stays locked", async () => {
    await createKeyVault({ dbName: DB }).create(PASSPHRASE);
    const vault = createKeyVault({ dbName: DB });
    await rejectsWith(vault.unlock("not the passphrase"), "wrong-passphrase");
    expect(vault.getState()).toBe("locked");
    await vault.unlock(PASSPHRASE);
    expect(vault.getState()).toBe("unlocked");
  });

  it("normalises the passphrase and refuses an empty one", async () => {
    const vault = createKeyVault({ dbName: DB });
    await rejectsWith(vault.create(""), "invalid-input");
    await rejectsWith(vault.create("a\uD800b"), "invalid-input");
    await vault.create("café");
    await rejectsWith(vault.create(PASSPHRASE), "exists");
    vault.lock();
    await vault.unlock("café");
    expect(vault.isLocked).toBe(false);
  });

  it("says when there is no vault", async () => {
    const vault = createKeyVault({ dbName: DB });
    await rejectsWith(vault.unlock(PASSPHRASE), "no-vault");
    await rejectsWith(vault.changePassphrase(PASSPHRASE, "other"), "no-vault");
    await rejectsWith(vault.get("openai"), "locked");
  });

  it("keeps several providers apart and lists names only", async () => {
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE);
    for (const [name, secret] of Object.entries(SECRETS)) await vault.set(name, secret);
    expect(await vault.list()).toEqual(["anthropic", "mistral", "openai"]);
    for (const [name, secret] of Object.entries(SECRETS))
      expect(await vault.get(name)).toBe(secret);
    await vault.set("openai", "test-key-4");
    expect(await vault.get("openai")).toBe("test-key-4");
    await vault.delete("mistral");
    expect(await vault.list()).toEqual(["anthropic", "openai"]);
    await rejectsWith(vault.set("", "test-key-5"), "invalid-input");
  });

  it("uses a fresh IV for every write", async () => {
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE);
    await vault.set("openai", SECRETS.openai);
    const first = (await readRecords()).secrets.get("openai") as { iv: Uint8Array };
    await vault.set("openai", SECRETS.openai);
    const second = (await readRecords()).secrets.get("openai") as { iv: Uint8Array };
    expect(second.iv).not.toEqual(first.iv);
  });

  describe("detects tampering", () => {
    async function setup() {
      const vault = createKeyVault({ dbName: DB });
      await vault.create(PASSPHRASE);
      await vault.set("openai", SECRETS.openai);
      await vault.set("anthropic", SECRETS.anthropic);
      const record = (await readRecords()).secrets.get("openai") as {
        iv: Uint8Array;
        ciphertext: Uint8Array;
      };
      return { vault, record };
    }

    it("of an IV", async () => {
      const { vault, record } = await setup();
      await writeRecord("secrets", "openai", { ...record, iv: flip(record.iv) });
      await rejectsWith(vault.get("openai"), "tampered");
    });

    it("of a ciphertext", async () => {
      const { vault, record } = await setup();
      await writeRecord("secrets", "openai", {
        ...record,
        ciphertext: flip(record.ciphertext, 3),
      });
      await rejectsWith(vault.get("openai"), "tampered");
      await writeRecord("secrets", "openai", { iv: record.iv });
      await rejectsWith(vault.get("openai"), "tampered");
    });

    it("of a name (a record moved to another provider)", async () => {
      const { vault, record } = await setup();
      await writeRecord("secrets", "anthropic", record);
      await rejectsWith(vault.get("anthropic"), "tampered");
      expect(await vault.get("openai")).toBe(SECRETS.openai);
    });

    it("of a record copied from another vault", async () => {
      const { record } = await setup();
      await createKeyVault({ dbName: DB }).reset();
      const other = createKeyVault({ dbName: DB });
      await other.create(PASSPHRASE);
      await writeRecord("secrets", "openai", record);
      await rejectsWith(other.get("openai"), "tampered");
    });

    it("of the wrapped vault key", async () => {
      await setup();
      const header = (await readRecords()).meta.get("vault") as {
        wrap: { iv: Uint8Array; ciphertext: Uint8Array };
      };
      await writeRecord("meta", "vault", {
        ...header,
        wrap: { ...header.wrap, ciphertext: flip(header.wrap.ciphertext) },
      });
      await rejectsWith(createKeyVault({ dbName: DB }).unlock(PASSPHRASE), "tampered");
    });

    it("of the KDF parameters", async () => {
      await setup();
      const header = (await readRecords()).meta.get("vault") as Record<string, unknown>;
      const kdf = header.kdf as { salt: Uint8Array };
      await writeRecord("meta", "vault", { ...header, kdf: { ...kdf, salt: flip(kdf.salt) } });
      await rejectsWith(createKeyVault({ dbName: DB }).unlock(PASSPHRASE), "wrong-passphrase");
      await writeRecord("meta", "vault", {
        ...header,
        kdf: { ...kdf, params: { iterations: 1 } },
      });
      await rejectsWith(createKeyVault({ dbName: DB }).unlock(PASSPHRASE), "unsupported");
      await writeRecord("meta", "vault", { ...header, format: "llm-connect-vault/9" });
      await rejectsWith(createKeyVault({ dbName: DB }).unlock(PASSPHRASE), "unsupported");
    });
  });

  it("wipes the vault key on lock, even for a read in flight", async () => {
    const vault = createKeyVault({ dbName: DB });
    const states: KeyVaultState[] = [];
    vault.subscribe((state) => states.push(state));
    await vault.create(PASSPHRASE);
    await vault.set("openai", SECRETS.openai);

    const inFlight = vault.get("openai");
    vault.lock();
    await rejectsWith(inFlight, "locked");
    expect(vault.isLocked).toBe(true);
    await rejectsWith(vault.get("openai"), "locked");
    await rejectsWith(vault.set("openai", SECRETS.openai), "locked");
    // Names are stored in clear and deleting needs no key
    expect(await vault.list()).toEqual(["openai"]);
    expect(states).toEqual(["loading", "empty", "unlocked", "locked"]);

    await vault.unlock(PASSPHRASE);
    expect(await vault.get("openai")).toBe(SECRETS.openai);
  });

  it("changes the passphrase by rewrapping the vault key only", async () => {
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE);
    await vault.set("openai", SECRETS.openai);
    const before = await readRecords();
    vault.lock();

    await rejectsWith(vault.changePassphrase("not the passphrase", "new one"), "wrong-passphrase");
    await rejectsWith(vault.changePassphrase(PASSPHRASE, ""), "invalid-input");
    await vault.changePassphrase(PASSPHRASE, "a new passphrase");
    expect(vault.isLocked).toBe(true);

    const after = await readRecords();
    expect(after.secrets.get("openai")).toEqual(before.secrets.get("openai"));
    const oldHeader = before.meta.get("vault") as { id: string; kdf: { salt: Uint8Array } };
    const newHeader = after.meta.get("vault") as { id: string; kdf: { salt: Uint8Array } };
    expect(newHeader.id).toBe(oldHeader.id);
    expect(newHeader.kdf.salt).not.toEqual(oldHeader.kdf.salt);

    const reloaded = createKeyVault({ dbName: DB });
    await rejectsWith(reloaded.unlock(PASSPHRASE), "wrong-passphrase");
    await reloaded.unlock("a new passphrase");
    expect(await reloaded.get("openai")).toBe(SECRETS.openai);
  });

  it("unlocks itself on this device when remembered", async () => {
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE, { rememberOnDevice: true });
    await vault.set("openai", SECRETS.openai);
    expect(await vault.isRememberedOnDevice()).toBe(true);
    const device = (await readRecords()).meta.get("device") as { key: CryptoKey };
    expect(device.key.extractable).toBe(false);
    expect(device.key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });

    const reloaded = createKeyVault({ dbName: DB });
    expect(await reloaded.load()).toBe("unlocked");
    expect(await reloaded.get("openai")).toBe(SECRETS.openai);
    // An explicit lock holds for the page
    reloaded.lock();
    expect(await reloaded.load()).toBe("locked");

    // Changing the passphrase keeps the device copy
    await reloaded.changePassphrase(PASSPHRASE, "a new passphrase");
    expect(await createKeyVault({ dbName: DB }).load()).toBe("unlocked");

    await reloaded.forgetDevice();
    expect(await createKeyVault({ dbName: DB }).load()).toBe("locked");

    // Turned on, then off, from unlock
    await createKeyVault({ dbName: DB }).unlock("a new passphrase", { rememberOnDevice: true });
    expect(await createKeyVault({ dbName: DB }).load()).toBe("unlocked");
    await createKeyVault({ dbName: DB }).unlock("a new passphrase", { rememberOnDevice: false });
    expect(await createKeyVault({ dbName: DB }).isRememberedOnDevice()).toBe(false);
    expect(await createKeyVault({ dbName: DB }).load()).toBe("locked");
  });

  it("asks for the passphrase when the device copy does not open", async () => {
    await createKeyVault({ dbName: DB }).create(PASSPHRASE, { rememberOnDevice: true });
    const device = (await readRecords()).meta.get("device") as {
      key: CryptoKey;
      wrap: { iv: Uint8Array; ciphertext: Uint8Array };
    };
    await writeRecord("meta", "device", {
      ...device,
      wrap: { ...device.wrap, iv: flip(device.wrap.iv) },
    });
    expect(await createKeyVault({ dbName: DB }).load()).toBe("locked");
  });

  it("locks after autoLockMs without use", async () => {
    jest.useFakeTimers();
    const vault = createKeyVault({ dbName: DB, autoLockMs: 60_000 });
    await vault.create(PASSPHRASE);
    await vault.set("openai", SECRETS.openai);

    jest.advanceTimersByTime(59_999);
    expect(vault.getState()).toBe("unlocked");
    // Any use restarts the timer
    expect(await vault.get("openai")).toBe(SECRETS.openai);
    jest.advanceTimersByTime(59_999);
    expect(vault.getState()).toBe("unlocked");
    vault.touch();
    jest.advanceTimersByTime(59_999);
    expect(vault.getState()).toBe("unlocked");
    jest.advanceTimersByTime(1);
    expect(vault.getState()).toBe("locked");
    await rejectsWith(vault.get("openai"), "locked");

    // No timer while locked, a new one after unlocking
    jest.advanceTimersByTime(120_000);
    await vault.unlock(PASSPHRASE);
    jest.advanceTimersByTime(60_000);
    expect(vault.getState()).toBe("locked");
  });

  it("never locks on its own without autoLockMs", async () => {
    jest.useFakeTimers();
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE);
    jest.advanceTimersByTime(24 * 3_600_000);
    expect(vault.getState()).toBe("unlocked");
  });

  it("derives through an app's own KDF and stores its parameters", async () => {
    const calls: { salt: Uint8Array; params: object }[] = [];
    const kdf: KeyVaultKdf = {
      id: "test-kdf",
      params: { cost: 3, label: "fast" },
      async derive(passphrase, salt, params) {
        calls.push({ salt: new Uint8Array(salt), params });
        const input = new Uint8Array([...passphrase, ...salt]);
        return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
      },
    };
    const vault = createKeyVault({ dbName: DB, kdf });
    await vault.create(PASSPHRASE);
    await vault.set("openai", SECRETS.openai);
    const header = (await readRecords()).meta.get("vault") as {
      kdf: { id: string; params: object; salt: Uint8Array };
    };
    expect(header.kdf.id).toBe("test-kdf");
    expect(header.kdf.params).toEqual({ cost: 3, label: "fast" });

    const reloaded = createKeyVault({ dbName: DB, kdf });
    await reloaded.unlock(PASSPHRASE);
    expect(await reloaded.get("openai")).toBe(SECRETS.openai);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.salt).toEqual(header.kdf.salt);
    expect(calls[1]?.params).toEqual({ cost: 3, label: "fast" });

    // Without that KDF the vault cannot be opened
    await rejectsWith(createKeyVault({ dbName: DB }).unlock(PASSPHRASE), "unsupported");

    // A KDF that returns too few bytes is refused
    const short: KeyVaultKdf = { ...kdf, id: "short", derive: async () => new Uint8Array(8) };
    await createKeyVault({ dbName: DB }).reset();
    await rejectsWith(createKeyVault({ dbName: DB, kdf: short }).create(PASSPHRASE), "unsupported");
  });

  it("moves a PBKDF2 vault to the configured KDF on unlock", async () => {
    await createKeyVault({ dbName: DB }).create(PASSPHRASE);
    let derived = 0;
    const kdf: KeyVaultKdf = {
      id: "test-kdf",
      params: { cost: 1 },
      async derive(passphrase, salt) {
        derived++;
        const input = new Uint8Array([...passphrase, ...salt]);
        return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
      },
    };
    await createKeyVault({ dbName: DB, kdf }).unlock(PASSPHRASE);
    expect(derived).toBe(1);
    const header = (await readRecords()).meta.get("vault") as { kdf: { id: string } };
    expect(header.kdf.id).toBe("test-kdf");
    await createKeyVault({ dbName: DB, kdf }).unlock(PASSPHRASE);
    expect(derived).toBe(2);
  });

  it("bounds the PBKDF2 iteration count", () => {
    expect(pbkdf2Kdf().params).toEqual({ iterations: 600_000 });
    expect(() => pbkdf2Kdf(1_000)).toThrow("PBKDF2 iterations");
    expect(() => pbkdf2Kdf(100_000_000)).toThrow("PBKDF2 iterations");
  });

  it("stores no secret or passphrase in clear", async () => {
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE, { rememberOnDevice: true });
    for (const [name, secret] of Object.entries(SECRETS)) await vault.set(name, secret);
    const records = await readRecords();
    const all = [...records.meta.values(), ...records.secrets.values()].flatMap((value) =>
      texts(value),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [...Object.values(SECRETS), PASSPHRASE])
      expect(all.some((text) => text.includes(secret))).toBe(false);
  });

  it("keeps the vault in memory without IndexedDB", async () => {
    const g = globalThis as { indexedDB?: IDBFactory };
    g.indexedDB = undefined;
    const vault = createKeyVault({ dbName: DB });
    await vault.create(PASSPHRASE, { rememberOnDevice: true });
    expect(vault.persistent).toBe(false);
    await vault.set("openai", SECRETS.openai);
    vault.lock();
    await rejectsWith(vault.unlock("not the passphrase"), "wrong-passphrase");
    await vault.unlock(PASSPHRASE);
    expect(await vault.get("openai")).toBe(SECRETS.openai);
    expect(await vault.isRememberedOnDevice()).toBe(false);
    // A reload loses it
    expect(await createKeyVault({ dbName: DB }).load()).toBe("empty");
  });

  it("keeps secrets in memory, unencrypted, without WebCrypto", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      const vault = createKeyVault({ dbName: DB });
      expect(await vault.load()).toBe("empty");
      await vault.create(PASSPHRASE);
      await vault.set("openai", SECRETS.openai);
      expect(await vault.get("openai")).toBe(SECRETS.openai);
      expect(await vault.list()).toEqual(["openai"]);
      // Nothing to unlock from: locking forgets them
      vault.lock();
      expect(vault.getState()).toBe("empty");
      await rejectsWith(vault.get("openai"), "locked");
      await rejectsWith(vault.unlock(PASSPHRASE), "no-vault");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    }
    expect((await readRecords()).meta.size).toBe(0);
  });

  describe("reset", () => {
    async function seed() {
      const vault = createKeyVault({ dbName: DB });
      await vault.create(PASSPHRASE, { rememberOnDevice: true });
      for (const [name, secret] of Object.entries(SECRETS)) await vault.set(name, secret);
      return vault;
    }

    async function writeOther() {
      const request = indexedDB.open("other-db", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      const db = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise<void>((resolve) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put("kept", "item");
        tx.oncomplete = () => resolve();
      });
      db.close();
    }

    async function readOther(): Promise<unknown> {
      const db = await openDb("other-db");
      const value = await new Promise((resolve) => {
        const request = db.transaction("kv").objectStore("kv").get("item");
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return value;
    }

    it("deletes everything while locked, without the passphrase", async () => {
      await seed();
      await writeOther();
      await createKeyVault({ dbName: DB }).forgetDevice();
      const vault = createKeyVault({ dbName: DB });
      const states: KeyVaultState[] = [];
      vault.subscribe((state) => states.push(state));
      expect(await vault.load()).toBe("locked");

      await vault.reset();
      expect(vault.getState()).toBe("empty");
      expect(states).toEqual(["loading", "locked", "empty"]);
      const records = await readRecords();
      expect(records.meta.size + records.secrets.size).toBe(0);
      expect(await readOther()).toBe("kept");
      expect(await createKeyVault({ dbName: DB }).load()).toBe("empty");
    });

    it("deletes everything while unlocked and wipes memory", async () => {
      const vault = await seed();
      await vault.destroy();
      expect(vault.getState()).toBe("empty");
      await rejectsWith(vault.get("openai"), "locked");
      expect(await vault.list()).toEqual([]);
      const records = await readRecords();
      expect(records.meta.size + records.secrets.size).toBe(0);
    });

    it("lets a new vault be created afterwards", async () => {
      const vault = await seed();
      await vault.reset();
      await vault.create("another passphrase");
      expect(await vault.list()).toEqual([]);
      expect(await vault.get("openai")).toBeNull();
      await vault.set("openai", "test-key-6");
      const reloaded = createKeyVault({ dbName: DB });
      expect(await reloaded.load()).toBe("locked");
      await rejectsWith(reloaded.unlock(PASSPHRASE), "wrong-passphrase");
      await reloaded.unlock("another passphrase");
      expect(await reloaded.get("openai")).toBe("test-key-6");
    });

    it("works on a vault whose header is unreadable", async () => {
      await seed();
      await writeRecord("meta", "vault", { format: "llm-connect-vault/1", id: 3 });
      const vault = createKeyVault({ dbName: DB });
      expect(await vault.load()).toBe("locked");
      await rejectsWith(vault.unlock(PASSPHRASE), "tampered");
      await vault.reset();
      await vault.create(PASSPHRASE);
      expect(vault.getState()).toBe("unlocked");
    });
  });
});
