/**
 * Secrets sealed at rest with AES-GCM 256 under a non-extractable CryptoKey
 * kept in IndexedDB, with a fresh IV on every write and the secret's name
 * bound as additional data, so a record copied under another name does not
 * open. `secureStorage` keeps its API key here; an app keeps any other secret
 * (a sync token, a TURN password, a server key) the same way, without writing
 * its own crypto.
 *
 * A dump of the browser's storage only yields opaque bytes. Script running on
 * the same origin can still have the browser decrypt: on an origin shared by
 * several sites (the project pages of a user.github.io) that includes every
 * one of them. Only a passphrase (see `createKeyVault`) protects against that.
 */

/** A sealed value as stored. Records without `v` were written before names were bound. */
export interface SealedRecord {
  v?: 2;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export interface SealedStoreOptions {
  /** IndexedDB database holding the CryptoKey and the sealed values. Prefix it with the app. */
  dbName: string;
}

export interface SealedStore {
  /** Whether IndexedDB and WebCrypto are there; without them nothing is stored. */
  readonly available: boolean;
  /** The value, or null when absent, tampered with or sealed under a key that is gone. */
  get(name: string): Promise<string | null>;
  /** Whether the value was stored (false: storage full, blocked or missing). Never stored in clear. */
  set(name: string, value: string): Promise<boolean>;
  delete(name: string): Promise<void>;
  /** Seal without storing, for a copy kept elsewhere (sessionStorage…). Throws when unavailable. */
  seal(name: string, value: string): Promise<SealedRecord>;
  /** Open a record from `seal`; null when it does not open. */
  unseal(name: string, record: SealedRecord | undefined): Promise<string | null>;
  /** Remove every value and the CryptoKey: whatever was sealed with it no longer opens. */
  destroy(): Promise<void>;
}

const STORE = "kv";
const CRYPTO_KEY_ID = "crypto-key";

function hasCrypto(): boolean {
  try {
    return !!globalThis.indexedDB && !!globalThis.crypto?.subtle;
  } catch {
    return false;
  }
}

/** Raised by `seal` when there is no WebCrypto or IndexedDB to seal with. */
export class SealedStoreUnavailable extends Error {
  constructor() {
    super("No IndexedDB or WebCrypto to seal secrets with");
    this.name = "SealedStoreUnavailable";
  }
}

export function sealedStore({ dbName }: SealedStoreOptions): SealedStore {
  const available = hasCrypto();
  const encoder = new TextEncoder();

  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        // Resolved on commit only: a full quota aborts the transaction after the request succeeded
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new DOMException("Aborted", "AbortError"));
      });
    } finally {
      db.close();
    }
  }

  const idbGet = <T>(id: string) =>
    withStore<T | undefined>("readonly", (s) => s.get(id) as IDBRequest<T | undefined>);

  async function readOrCreateKey(create: boolean): Promise<CryptoKey | undefined> {
    const existing = await idbGet<CryptoKey>(CRYPTO_KEY_ID);
    if (existing || !create) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    try {
      // add, not put: another tab creating its key at the same moment must not replace ours
      await withStore("readwrite", (s) => s.add(key, CRYPTO_KEY_ID));
      return key;
    } catch (error) {
      const winner = await idbGet<CryptoKey>(CRYPTO_KEY_ID).catch(() => undefined);
      if (winner) return winner;
      throw error;
    }
  }

  // Read on each use, not cached: another tab may have destroyed it meanwhile
  const cryptoKey = readOrCreateKey;

  async function seal(name: string, value: string): Promise<SealedRecord> {
    if (!available) throw new SealedStoreUnavailable();
    const key = await cryptoKey(true);
    if (!key) throw new SealedStoreUnavailable();
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(name) },
      key,
      encoder.encode(value),
    );
    return { v: 2, iv, ciphertext };
  }

  async function unseal(name: string, record: SealedRecord | undefined): Promise<string | null> {
    if (!available || !record?.iv || !record.ciphertext) return null;
    try {
      const key = await cryptoKey(false);
      if (!key) return null;
      const params: AesGcmParams = { name: "AES-GCM", iv: record.iv };
      if (record.v === 2) params.additionalData = encoder.encode(name);
      const plain = await crypto.subtle.decrypt(params, key, record.ciphertext);
      return new TextDecoder().decode(plain);
    } catch {
      // Tampered, copied under another name, or the CryptoKey was cleared
      return null;
    }
  }

  return {
    available,
    seal,
    unseal,
    async get(name) {
      if (!available) return null;
      try {
        return await unseal(name, await idbGet<SealedRecord>(name));
      } catch {
        return null;
      }
    },
    async set(name, value) {
      if (!available) return false;
      try {
        const record = await seal(name, value);
        await withStore("readwrite", (s) => s.put(record, name));
        return true;
      } catch {
        return false;
      }
    },
    async delete(name) {
      if (!available) return;
      try {
        await withStore("readwrite", (s) => s.delete(name));
      } catch {
        // Nothing to clean up
      }
    },
    async destroy() {
      if (!available) return;
      try {
        await withStore("readwrite", (s) => s.clear());
      } catch {
        // Nothing to clean up
      }
    },
  };
}
