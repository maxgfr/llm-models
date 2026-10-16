import { isConfigured } from "./settings.js";
import {
  readPrefs,
  readWeb,
  removeWeb,
  type SettingsStorage,
  type StoredSettings,
  writeWeb,
} from "./storage.js";

export interface SecureStorageOptions {
  /** localStorage key of the non-secret preferences (JSON). */
  prefsKey: string;
  /** IndexedDB database holding the encryption key and a remembered API key. */
  dbName: string;
  /** sessionStorage key of a key kept for the tab only. Default `${prefsKey}-key`. */
  sessionKey?: string;
}

interface EncryptedSecret {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

const STORE = "kv";
const CRYPTO_KEY_ID = "crypto-key";
const API_KEY_ID = "api-key";

function hasCrypto(): boolean {
  try {
    return !!globalThis.indexedDB && !!globalThis.crypto?.subtle;
  } catch {
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Preferences in localStorage; the API key never in clear text anywhere. It is
 * encrypted with AES-GCM under a non-extractable CryptoKey kept in IndexedDB,
 * with a fresh IV on every save. A remembered key's ciphertext goes to
 * IndexedDB; otherwise to sessionStorage, so it survives a reload and goes
 * away with the tab. A dump of browser storage only yields opaque bytes.
 *
 * Without IndexedDB or WebCrypto (some private modes), the key stays in memory
 * for the page. Every access is guarded.
 *
 * Code running inside the page (an XSS) can still have the browser decrypt:
 * the Content-Security-Policy is what protects against that.
 */
export function secureStorage<E extends object = object>({
  prefsKey,
  dbName,
  sessionKey = `${prefsKey}-key`,
}: SecureStorageOptions): SettingsStorage<E> {
  // The key as last saved or decrypted; null until read once
  let memoryKey: string | null = null;

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
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  const idbGet = <T>(id: string) =>
    withStore<T | undefined>("readonly", (s) => s.get(id) as IDBRequest<T | undefined>);
  const idbPut = (id: string, value: unknown) => withStore("readwrite", (s) => s.put(value, id));
  const idbDelete = (id: string) => withStore("readwrite", (s) => s.delete(id));

  async function cryptoKey(create: boolean): Promise<CryptoKey | undefined> {
    const existing = await idbGet<CryptoKey>(CRYPTO_KEY_ID);
    if (existing || !create) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(CRYPTO_KEY_ID, key);
    return key;
  }

  async function encrypt(apiKey: string): Promise<EncryptedSecret> {
    const key = await cryptoKey(true);
    if (!key) throw new Error("No encryption key");
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(apiKey),
    );
    return { iv, ciphertext };
  }

  async function decrypt(secret: EncryptedSecret | undefined): Promise<string> {
    const key = secret && (await cryptoKey(false));
    if (!secret || !key) return "";
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: secret.iv },
      key,
      secret.ciphertext,
    );
    return new TextDecoder().decode(plain);
  }

  function sessionSecret(): EncryptedSecret | undefined {
    const raw = readWeb("sessionStorage", sessionKey);
    if (!raw) return undefined;
    try {
      const { iv, ciphertext } = JSON.parse(raw) as { iv: string; ciphertext: string };
      return { iv: fromBase64(iv), ciphertext: fromBase64(ciphertext).buffer };
    } catch {
      return undefined;
    }
  }

  async function readKey(rememberKey: boolean): Promise<string> {
    if (!hasCrypto()) return "";
    try {
      return await decrypt(rememberKey ? await idbGet(API_KEY_ID) : sessionSecret());
    } catch {
      // Tampered or undecryptable (the CryptoKey was cleared): ask for the key again
      return "";
    }
  }

  async function writeKey(apiKey: string, rememberKey: boolean): Promise<void> {
    removeWeb("sessionStorage", sessionKey);
    if (!hasCrypto()) return;
    try {
      if (!apiKey || !rememberKey) await idbDelete(API_KEY_ID);
      if (!apiKey) return;
      const secret = await encrypt(apiKey);
      if (rememberKey) await idbPut(API_KEY_ID, secret);
      else
        writeWeb(
          "sessionStorage",
          sessionKey,
          JSON.stringify({
            iv: toBase64(secret.iv),
            ciphertext: toBase64(new Uint8Array(secret.ciphertext)),
          }),
        );
    } catch {
      // IndexedDB blocked: the key lasts for this page
    }
  }

  async function loadDraft(): Promise<StoredSettings<E> | null> {
    const prefs = readPrefs<E>(prefsKey);
    if (!prefs) return null;
    if (memoryKey === null) memoryKey = await readKey(prefs.rememberKey === true);
    return { ...prefs, apiKey: memoryKey };
  }

  return {
    loadDraft,
    async load() {
      const draft = await loadDraft();
      return isConfigured(draft) ? draft : null;
    },
    async save(settings, { rememberKey }) {
      const { apiKey, ...prefs } = settings;
      writeWeb("localStorage", prefsKey, JSON.stringify({ ...prefs, rememberKey }));
      memoryKey = apiKey;
      await writeKey(apiKey, rememberKey);
    },
    async clear() {
      memoryKey = null;
      removeWeb("localStorage", prefsKey);
      removeWeb("sessionStorage", sessionKey);
      if (!hasCrypto()) return;
      try {
        await idbDelete(API_KEY_ID);
        await idbDelete(CRYPTO_KEY_ID);
      } catch {
        // Nothing to clean up
      }
    },
  };
}
