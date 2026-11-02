import { type SealedRecord, sealedStore } from "./sealed-store.js";
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

const API_KEY_ID = "api-key";

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
  const sealed = sealedStore({ dbName });

  function sessionSecret(): SealedRecord | undefined {
    const raw = readWeb("sessionStorage", sessionKey);
    if (!raw) return undefined;
    try {
      const { v, iv, ciphertext } = JSON.parse(raw) as { v?: 2; iv: string; ciphertext: string };
      return {
        ...(v === 2 ? { v } : {}),
        iv: fromBase64(iv),
        ciphertext: fromBase64(ciphertext).buffer,
      };
    } catch {
      return undefined;
    }
  }

  async function readKey(rememberKey: boolean): Promise<string> {
    if (!sealed.available) return "";
    const key = rememberKey
      ? await sealed.get(API_KEY_ID)
      : await sealed.unseal(API_KEY_ID, sessionSecret());
    // Tampered or undecryptable (the CryptoKey was cleared): ask for the key again
    return key ?? "";
  }

  /** Whether the key will survive a reload (no key to keep counts as kept). */
  async function writeKey(apiKey: string, rememberKey: boolean): Promise<boolean> {
    removeWeb("sessionStorage", sessionKey);
    if (!sealed.available) return !apiKey;
    if (!apiKey || !rememberKey) await sealed.delete(API_KEY_ID);
    if (!apiKey) return true;
    if (rememberKey) return sealed.set(API_KEY_ID, apiKey);
    try {
      const secret = await sealed.seal(API_KEY_ID, apiKey);
      return writeWeb(
        "sessionStorage",
        sessionKey,
        JSON.stringify({
          v: secret.v,
          iv: toBase64(secret.iv),
          ciphertext: toBase64(new Uint8Array(secret.ciphertext)),
        }),
      );
    } catch {
      // IndexedDB blocked or full: the key lasts for this page
      return false;
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
      const stored = writeWeb("localStorage", prefsKey, JSON.stringify({ ...prefs, rememberKey }));
      memoryKey = apiKey;
      return (await writeKey(apiKey, rememberKey)) && stored;
    },
    async clear() {
      memoryKey = null;
      removeWeb("localStorage", prefsKey);
      removeWeb("sessionStorage", sessionKey);
      await sealed.destroy();
    },
  };
}
