// A passphrase-protected vault of secrets (API keys of several providers…),
// WebCrypto only. Each secret is encrypted with AES-GCM under a random 256-bit
// vault key; the vault key is wrapped by a key derived from the passphrase
// (PBKDF2-SHA256 by default, or the app's own KDF such as Argon2id).

/** Format of what the vault stores; part of every AAD. */
const FORMAT = "llm-connect-vault/1";

/** Id of the built-in KDF, as stored with the vault. */
export const PBKDF2_KDF_ID = "pbkdf2-sha256";
/** OWASP's recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_DEFAULT_ITERATIONS = 600_000;
/** Bounds of the iteration count, checked before deriving (a stored count included). */
export const PBKDF2_ITERATION_BOUNDS = [100_000, 10_000_000] as const;

const META = "meta";
const SECRETS = "secrets";
const HEADER_ID = "vault";
const DEVICE_ID = "device";
const SALT_BYTES = 16;
const VAULT_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

type Bytes = Uint8Array<ArrayBuffer>;
type StoreName = typeof META | typeof SECRETS;

/** Parameters of a KDF, stored in clear with the vault. */
export type KeyVaultKdfParams = Readonly<Record<string, number | string>>;

/**
 * How a passphrase becomes key material. The `id` and `params` are stored with
 * the vault, so unlocking always uses what the vault was wrapped with; `derive`
 * returns at least 32 bytes (they are not stored).
 *
 * ```ts
 * import { argon2id } from "hash-wasm";
 * const kdf: KeyVaultKdf = {
 *   id: "argon2id",
 *   params: { m: 65536, t: 3, p: 1 },
 *   derive: (password, salt, { m, t, p }) =>
 *     argon2id({ password, salt, memorySize: +m, iterations: +t, parallelism: +p, hashLength: 32, outputType: "binary" }),
 * };
 * ```
 */
export interface KeyVaultKdf {
  id: string;
  params: KeyVaultKdfParams;
  derive(passphrase: Bytes, salt: Bytes, params: KeyVaultKdfParams): Promise<Uint8Array>;
}

/** The built-in KDF: PBKDF2-HMAC-SHA256, `iterations` within {@link PBKDF2_ITERATION_BOUNDS}. */
export function pbkdf2Kdf(iterations: number = PBKDF2_DEFAULT_ITERATIONS): KeyVaultKdf {
  checkIterations(iterations);
  return {
    id: PBKDF2_KDF_ID,
    params: { iterations },
    async derive(passphrase, salt, params) {
      const count = params.iterations;
      checkIterations(count);
      const base = await crypto.subtle.importKey("raw", passphrase, "PBKDF2", false, [
        "deriveBits",
      ]);
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: count as number },
        base,
        256,
      );
      return new Uint8Array(bits);
    },
  };
}

function checkIterations(value: unknown): void {
  const [min, max] = PBKDF2_ITERATION_BOUNDS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new KeyVaultError("unsupported", `PBKDF2 iterations must be between ${min} and ${max}`);
}

export type KeyVaultErrorCode =
  /** No vault was created (or it was reset). */
  | "no-vault"
  /** `create` on a vault that already exists. */
  | "exists"
  /** A secret was read or written while the vault is locked. */
  | "locked"
  | "wrong-passphrase"
  /** An empty or malformed passphrase, or an empty secret name. */
  | "invalid-input"
  /** What is stored was modified: authentication failed or the data is malformed. */
  | "tampered"
  /** A format, KDF or parameter this version does not accept. */
  | "unsupported"
  /** IndexedDB refused a write. */
  | "storage";

export class KeyVaultError extends Error {
  readonly code: KeyVaultErrorCode;
  constructor(code: KeyVaultErrorCode, message: string = code) {
    super(message);
    this.name = "KeyVaultError";
    this.code = code;
  }
}

/**
 * - `loading`: storage not read yet (`load()` runs on first use);
 * - `empty`: no vault on this device, `create` makes one;
 * - `locked`: a vault exists, `unlock` opens it;
 * - `unlocked`: secrets can be read and written.
 */
export type KeyVaultState = "loading" | "empty" | "locked" | "unlocked";

export interface KeyVaultOptions {
  /** IndexedDB database of the vault. */
  dbName: string;
  /** KDF of new passphrases. Default {@link pbkdf2Kdf}() (600 000 iterations). */
  kdf?: KeyVaultKdf;
  /** Lock after this long without use (`get`, `set`, `delete`, `list`, `touch`). Off by default. */
  autoLockMs?: number;
}

export interface UnlockOptions {
  /**
   * `true` also wraps the vault key with a non-extractable key of this device,
   * so the vault unlocks itself on the next load; `false` removes that copy;
   * left out, it stays as it is.
   */
  rememberOnDevice?: boolean;
}

export interface KeyVault {
  getState(): KeyVaultState;
  /** Whether secrets cannot be read: any state but `unlocked`. */
  readonly isLocked: boolean;
  /** Whether the vault lives in IndexedDB; false in memory (no IndexedDB or WebCrypto) or before `load`. */
  readonly persistent: boolean;
  /** Calls `listener` now and on every state change (the Svelte store contract); returns the unsubscribe. */
  subscribe(listener: (state: KeyVaultState) => void): () => void;
  /** Read storage once, and unlock with the device key when one is remembered. */
  load(): Promise<KeyVaultState>;
  create(passphrase: string, options?: UnlockOptions): Promise<void>;
  unlock(passphrase: string, options?: UnlockOptions): Promise<void>;
  /** Drop the vault key from memory. A remembered device copy stays: see `forgetDevice`. */
  lock(): void;
  /** Restart the auto-lock timer (user activity). */
  touch(): void;
  /** Rewrap the vault key under a new passphrase; secrets are not re-encrypted. Keeps the lock state. */
  changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void>;
  /** Whether the vault key is also wrapped by this device's key. */
  isRememberedOnDevice(): Promise<boolean>;
  /** Remove the device copy: the next load asks for the passphrase. */
  forgetDevice(): Promise<void>;
  /** The secret stored under `name`, or null. Throws `locked` or `tampered`. */
  get(name: string): Promise<string | null>;
  set(name: string, secret: string): Promise<void>;
  /** Also works while locked: removing a record needs no key. */
  delete(name: string): Promise<void>;
  /** Names of the stored secrets, never their values. Also works while locked: names are stored in clear. */
  list(): Promise<string[]>;
  /**
   * Delete the vault without the passphrase: the wrapped vault key, its salt and
   * KDF parameters, the device copy and every secret. Irreversible, and the only
   * way out when the passphrase is lost. Works while locked; the state becomes `empty`.
   */
  reset(): Promise<void>;
  /** Same as `reset`. */
  destroy(): Promise<void>;
}

interface Sealed {
  iv: Bytes;
  ciphertext: Bytes;
}

interface VaultHeader {
  format: typeof FORMAT;
  /** 16 random bytes, hex: binds every record and wrap to this vault. */
  id: string;
  kdf: { id: string; params: KeyVaultKdfParams; salt: Bytes };
  /** The vault key under the passphrase key. */
  wrap: Sealed;
  /** HMAC under a key derived from the passphrase: tells a wrong passphrase from tampering. */
  check: Bytes;
}

interface DeviceRecord {
  key: CryptoKey;
  wrap: Sealed;
}

interface Backend {
  persistent: boolean;
  get(store: StoreName, key: string): Promise<unknown>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  /** False when the key exists already. */
  add(store: StoreName, key: string, value: unknown): Promise<boolean>;
  delete(store: StoreName, key: string): Promise<void>;
  keys(store: StoreName): Promise<string[]>;
  clear(): Promise<void>;
}

const encoder = new TextEncoder();

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Additional data of a record or a wrap: the format, the kind, the vault and the name. */
function aad(...parts: string[]): Bytes {
  return utf8([FORMAT, ...parts].join("\0"));
}

function normalizePassphrase(passphrase: string): Bytes {
  // A lone surrogate would encode as U+FFFD, so two passphrases would derive the same key
  if (typeof passphrase !== "string" || /\p{Cs}/u.test(passphrase))
    throw new KeyVaultError("invalid-input", "The passphrase is not well-formed text");
  const normalized = passphrase.normalize("NFKC");
  if (!normalized) throw new KeyVaultError("invalid-input", "The passphrase is empty");
  return utf8(normalized);
}

function checkName(name: string): void {
  if (typeof name !== "string" || !name)
    throw new KeyVaultError("invalid-input", "A secret needs a name");
}

function sameParams(a: KeyVaultKdfParams, b: KeyVaultKdfParams): boolean {
  const sorted = (p: KeyVaultKdfParams) => JSON.stringify(Object.entries(p).sort());
  return sorted(a) === sorted(b);
}

function hasCrypto(): boolean {
  try {
    return !!globalThis.crypto?.subtle;
  } catch {
    return false;
  }
}

function isBytes(value: unknown, min: number, max = min): value is Bytes {
  return value instanceof Uint8Array && value.length >= min && value.length <= max;
}

function isSealed(value: unknown, length?: number): value is Sealed {
  if (!value || typeof value !== "object") return false;
  const { iv, ciphertext } = value as Partial<Sealed>;
  return (
    isBytes(iv, IV_BYTES) &&
    isBytes(ciphertext, length ?? TAG_BYTES, length ?? Number.MAX_SAFE_INTEGER)
  );
}

/** The stored header, checked member by member. */
function parseHeader(value: unknown): VaultHeader {
  if (!value || typeof value !== "object") throw new KeyVaultError("tampered", "No vault header");
  const header = value as Partial<VaultHeader>;
  if (header.format !== FORMAT)
    throw new KeyVaultError("unsupported", `Vault format ${String(header.format)}`);
  const kdf = header.kdf;
  const valid =
    typeof header.id === "string" &&
    /^[0-9a-f]{32}$/.test(header.id) &&
    !!kdf &&
    typeof kdf.id === "string" &&
    !!kdf.params &&
    typeof kdf.params === "object" &&
    Object.values(kdf.params).every((v) => typeof v === "number" || typeof v === "string") &&
    isBytes(kdf.salt, SALT_BYTES, 64) &&
    isSealed(header.wrap, VAULT_KEY_BYTES + TAG_BYTES) &&
    isBytes(header.check, 32);
  if (!valid) throw new KeyVaultError("tampered", "Malformed vault header");
  return header as VaultHeader;
}

async function seal(key: CryptoKey, plain: Bytes, additionalData: Bytes): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    plain,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/** The plaintext, or a `tampered` error when authentication fails. */
async function open(key: CryptoKey, sealed: Sealed, additionalData: Bytes): Promise<Bytes> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData },
      key,
      sealed.ciphertext,
    );
    return new Uint8Array(plain);
  } catch {
    throw new KeyVaultError("tampered", "Authentication failed");
  }
}

/** The wrapping key and the check key, from the KDF output through HKDF-SHA256. */
async function passphraseKeys(
  material: Uint8Array,
  vaultId: string,
): Promise<{ wrapKey: CryptoKey; checkKey: CryptoKey }> {
  if (material.length < 32)
    throw new KeyVaultError("unsupported", "The KDF must return at least 32 bytes");
  const ikm = new Uint8Array(new ArrayBuffer(material.length));
  ikm.set(material);
  material.fill(0);
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  ikm.fill(0);
  const hkdf = (info: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: utf8(vaultId),
    info: aad(info),
  });
  const [wrapKey, checkKey] = await Promise.all([
    crypto.subtle.deriveKey(hkdf("wrap-key"), base, { name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
    crypto.subtle.deriveKey(hkdf("check-key"), base, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]),
  ]);
  return { wrapKey, checkKey };
}

function importVaultKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function memoryBackend(): Backend {
  const stores: Record<StoreName, Map<string, unknown>> = { meta: new Map(), secrets: new Map() };
  return {
    persistent: false,
    get: async (store, key) => stores[store].get(key),
    put: async (store, key, value) => void stores[store].set(key, value),
    async add(store, key, value) {
      if (stores[store].has(key)) return false;
      stores[store].set(key, value);
      return true;
    },
    delete: async (store, key) => void stores[store].delete(key),
    keys: async (store) => [...stores[store].keys()],
    async clear() {
      stores.meta.clear();
      stores.secrets.clear();
    },
  };
}

/** IndexedDB, opened for each operation (so nothing blocks another tab's upgrade), or null when unusable. */
async function indexedDbBackend(dbName: string): Promise<Backend | null> {
  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(META);
        request.result.createObjectStore(SECRETS);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run<T>(
    stores: StoreName[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => IDBRequest<T> | undefined,
  ): Promise<T | undefined> {
    const db = await openDb();
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        const request = body(tx);
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  try {
    if (!globalThis.indexedDB) return null;
    (await openDb()).close();
  } catch {
    // Blocked (some private modes): the vault lives in memory
    return null;
  }

  return {
    persistent: true,
    get: (store, key) => run([store], "readonly", (tx) => tx.objectStore(store).get(key)),
    async put(store, key, value) {
      await run([store], "readwrite", (tx) => tx.objectStore(store).put(value, key));
    },
    async add(store, key, value) {
      let added = false;
      await run([store], "readwrite", (tx) => {
        const objects = tx.objectStore(store);
        const existing = objects.getKey(key);
        existing.onsuccess = () => {
          if (existing.result !== undefined) return;
          objects.add(value, key);
          added = true;
        };
        return undefined;
      });
      return added;
    },
    async delete(store, key) {
      await run([store], "readwrite", (tx) => tx.objectStore(store).delete(key));
    },
    async keys(store) {
      const keys = await run([store], "readonly", (tx) => tx.objectStore(store).getAllKeys());
      return (keys ?? []).filter((key): key is string => typeof key === "string");
    },
    async clear() {
      await run([META, SECRETS], "readwrite", (tx) => {
        tx.objectStore(META).clear();
        tx.objectStore(SECRETS).clear();
        return undefined;
      });
    },
  };
}

/**
 * A vault of secrets behind a passphrase, kept in IndexedDB (`dbName`):
 *
 * - each secret is encrypted with AES-GCM 256 under a random vault key, with a
 *   fresh IV on every write and the vault id and the secret's name as AAD, so a
 *   record moved to another name or vault fails to decrypt;
 * - the vault key is wrapped by a key derived from the passphrase (PBKDF2-SHA256,
 *   600 000 iterations, a random 16-byte salt, or `kdf`), with an HMAC check that
 *   tells a wrong passphrase from tampering;
 * - `lock()` (or `autoLockMs` without use) drops the vault key from memory;
 * - `rememberOnDevice` adds a copy wrapped by a non-extractable device key, so
 *   the vault unlocks itself on load: same-origin script can then use it, as
 *   with {@link secureStorage}.
 *
 * Without IndexedDB the vault lives in memory for the page; without WebCrypto
 * (an insecure context) secrets are kept in memory unencrypted and `lock()`
 * forgets them.
 */
export function createKeyVault({ dbName, kdf, autoLockMs }: KeyVaultOptions): KeyVault {
  const configuredKdf = kdf ?? pbkdf2Kdf();
  let state: KeyVaultState = "loading";
  let backend: Backend | null = null;
  /** No WebCrypto: plain secrets in memory, null when no vault. */
  let plain: Map<string, string> | null = null;
  let header: VaultHeader | null = null;
  let vaultKey: CryptoKey | null = null;
  /** Bumped by every lock: an operation started before it does not hand out plaintext. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading: Promise<KeyVaultState> | null = null;
  const listeners = new Set<(state: KeyVaultState) => void>();

  function setState(next: KeyVaultState): void {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function stopTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function touch(): void {
    if (!autoLockMs || state !== "unlocked") return;
    stopTimer();
    timer = setTimeout(lock, autoLockMs);
  }

  /** Drop the vault key and stop the timer, without a state change. */
  function wipe(): void {
    generation++;
    stopTimer();
    vaultKey = null;
  }

  function lock(): void {
    wipe();
    if (!backend) {
      plain = null;
      if (state !== "loading") setState("empty");
      return;
    }
    if (state === "unlocked") setState(header ? "locked" : "empty");
  }

  function kdfFor(id: string): KeyVaultKdf {
    if (configuredKdf.id === id) return configuredKdf;
    if (id === PBKDF2_KDF_ID) return pbkdf2Kdf();
    throw new KeyVaultError("unsupported", `Unknown KDF ${id}`);
  }

  async function storage<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof KeyVaultError) throw error;
      throw new KeyVaultError("storage", error instanceof Error ? error.message : "Storage failed");
    }
  }

  /** A header wrapping `raw` under `passphrase` with the configured KDF and a fresh salt. */
  async function sealHeader(id: string, raw: Bytes, passphrase: string): Promise<VaultHeader> {
    const salt = randomBytes(SALT_BYTES);
    const material = await configuredKdf.derive(
      normalizePassphrase(passphrase),
      salt,
      configuredKdf.params,
    );
    const { wrapKey, checkKey } = await passphraseKeys(material, id);
    const check = new Uint8Array(await crypto.subtle.sign("HMAC", checkKey, aad("check", id)));
    return {
      format: FORMAT,
      id,
      kdf: { id: configuredKdf.id, params: { ...configuredKdf.params }, salt },
      wrap: await seal(wrapKey, raw, aad("wrap", "passphrase", id)),
      check,
    };
  }

  /** The raw vault key of `stored`, or `wrong-passphrase` / `tampered` / `unsupported`. */
  async function openHeader(stored: VaultHeader, passphrase: string): Promise<Bytes> {
    const normalized = normalizePassphrase(passphrase);
    const material = await kdfFor(stored.kdf.id).derive(
      normalized,
      stored.kdf.salt,
      stored.kdf.params,
    );
    const { wrapKey, checkKey } = await passphraseKeys(material, stored.id);
    const ok = await crypto.subtle.verify("HMAC", checkKey, stored.check, aad("check", stored.id));
    if (!ok) throw new KeyVaultError("wrong-passphrase", "Wrong passphrase");
    const raw = await open(wrapKey, stored.wrap, aad("wrap", "passphrase", stored.id));
    if (raw.length !== VAULT_KEY_BYTES) throw new KeyVaultError("tampered", "Bad vault key");
    return raw;
  }

  async function readHeader(): Promise<VaultHeader | null> {
    const value = await backend?.get(META, HEADER_ID);
    return value === undefined ? null : parseHeader(value);
  }

  async function rememberDevice(raw: Bytes, id: string): Promise<void> {
    if (!backend?.persistent) return;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const record: DeviceRecord = { key, wrap: await seal(key, raw, aad("wrap", "device", id)) };
    await storage(() => (backend as Backend).put(META, DEVICE_ID, record));
  }

  async function forgetDevice(): Promise<void> {
    if (backend) await storage(() => (backend as Backend).delete(META, DEVICE_ID));
  }

  async function unlockWithDevice(stored: VaultHeader): Promise<void> {
    const record = (await backend?.get(META, DEVICE_ID)) as Partial<DeviceRecord> | undefined;
    if (!(record?.key instanceof CryptoKey) || !isSealed(record.wrap, VAULT_KEY_BYTES + TAG_BYTES))
      return;
    try {
      const raw = await open(record.key, record.wrap, aad("wrap", "device", stored.id));
      vaultKey = await importVaultKey(raw);
      raw.fill(0);
      setState("unlocked");
      touch();
    } catch {
      // A device copy that does not open: ask for the passphrase
    }
  }

  async function applyDeviceOption(raw: Bytes, id: string, options?: UnlockOptions) {
    if (options?.rememberOnDevice === true) await rememberDevice(raw, id);
    else if (options?.rememberOnDevice === false) await forgetDevice();
  }

  function load(): Promise<KeyVaultState> {
    loading ??= (async () => {
      if (!hasCrypto()) {
        setState("empty");
        return state;
      }
      backend = (await indexedDbBackend(dbName)) ?? memoryBackend();
      try {
        header = await readHeader();
      } catch {
        // Unreadable or malformed: locked, and unlock says why
        header = null;
        setState("locked");
        return state;
      }
      setState(header ? "locked" : "empty");
      if (header) await unlockWithDevice(header).catch(() => {});
      return state;
    })();
    return loading.then(() => state);
  }

  /** The vault key and header of an unlocked vault, or a `locked` error. */
  async function unlocked(): Promise<{ key: CryptoKey; id: string; at: number }> {
    await load();
    if (state !== "unlocked" || !vaultKey || !header)
      throw new KeyVaultError("locked", "The vault is locked");
    return { key: vaultKey, id: header.id, at: generation };
  }

  function stillUnlocked(at: number): void {
    if (at !== generation) throw new KeyVaultError("locked", "The vault was locked");
  }

  async function reset(): Promise<void> {
    await load();
    wipe();
    if (backend) await storage(() => (backend as Backend).clear());
    header = null;
    plain = null;
    setState("empty");
  }

  return {
    getState: () => state,
    get isLocked() {
      return state !== "unlocked";
    },
    get persistent() {
      return !!backend?.persistent;
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    load,

    async create(passphrase, options) {
      await load();
      if (!backend) {
        normalizePassphrase(passphrase);
        if (plain) throw new KeyVaultError("exists", "A vault exists already");
        plain = new Map();
        setState("unlocked");
        touch();
        return;
      }
      if (state !== "empty") throw new KeyVaultError("exists", "A vault exists already");
      const id = toHex(randomBytes(16));
      const raw = randomBytes(VAULT_KEY_BYTES);
      try {
        const sealed = await sealHeader(id, raw, passphrase);
        const added = await storage(() => (backend as Backend).add(META, HEADER_ID, sealed));
        if (!added) {
          header = await readHeader().catch(() => null);
          setState("locked");
          throw new KeyVaultError("exists", "A vault exists already");
        }
        // Stale records of a vault reset elsewhere would never decrypt
        for (const name of await (backend as Backend).keys(SECRETS))
          await (backend as Backend).delete(SECRETS, name);
        header = sealed;
        await applyDeviceOption(raw, id, options);
        vaultKey = await importVaultKey(raw);
      } finally {
        raw.fill(0);
      }
      generation++;
      setState("unlocked");
      touch();
    },

    async unlock(passphrase, options) {
      await load();
      if (!backend) {
        if (!plain) throw new KeyVaultError("no-vault", "No vault on this device");
        return;
      }
      const stored = await readHeader();
      if (!stored) {
        header = null;
        setState("empty");
        throw new KeyVaultError("no-vault", "No vault on this device");
      }
      const raw = await openHeader(stored, passphrase);
      try {
        let current = stored;
        // Stored with other KDF settings: rewrap with the configured ones
        if (
          stored.kdf.id !== configuredKdf.id ||
          !sameParams(stored.kdf.params, configuredKdf.params)
        ) {
          current = await sealHeader(stored.id, raw, passphrase);
          await storage(() => (backend as Backend).put(META, HEADER_ID, current));
        }
        await applyDeviceOption(raw, stored.id, options);
        header = current;
        vaultKey = await importVaultKey(raw);
      } finally {
        raw.fill(0);
      }
      generation++;
      setState("unlocked");
      touch();
    },

    lock,
    touch,

    async changePassphrase(oldPassphrase, newPassphrase) {
      await load();
      if (!backend) {
        if (!plain) throw new KeyVaultError("no-vault", "No vault on this device");
        normalizePassphrase(newPassphrase);
        return;
      }
      const stored = await readHeader();
      if (!stored) throw new KeyVaultError("no-vault", "No vault on this device");
      normalizePassphrase(newPassphrase);
      const raw = await openHeader(stored, oldPassphrase);
      try {
        const next = await sealHeader(stored.id, raw, newPassphrase);
        await storage(() => (backend as Backend).put(META, HEADER_ID, next));
        header = next;
      } finally {
        raw.fill(0);
      }
      touch();
    },

    async isRememberedOnDevice() {
      await load();
      return (await backend?.get(META, DEVICE_ID)) !== undefined;
    },

    async forgetDevice() {
      await load();
      await forgetDevice();
    },

    async get(name) {
      checkName(name);
      await load();
      if (!backend) {
        if (!plain) throw new KeyVaultError("locked", "The vault is locked");
        touch();
        return plain.get(name) ?? null;
      }
      const { key, id, at } = await unlocked();
      const record = await (backend as Backend).get(SECRETS, name);
      if (record === undefined) return null;
      if (!isSealed(record)) throw new KeyVaultError("tampered", `Malformed record ${name}`);
      const plainBytes = await open(key, record, aad("record", id, name));
      stillUnlocked(at);
      touch();
      const secret = new TextDecoder().decode(plainBytes);
      plainBytes.fill(0);
      return secret;
    },

    async set(name, secret) {
      checkName(name);
      if (typeof secret !== "string")
        throw new KeyVaultError("invalid-input", "A secret is a string");
      await load();
      if (!backend) {
        if (!plain) throw new KeyVaultError("locked", "The vault is locked");
        plain.set(name, secret);
        touch();
        return;
      }
      const { key, id, at } = await unlocked();
      const bytes = utf8(secret);
      const record = await seal(key, bytes, aad("record", id, name));
      bytes.fill(0);
      stillUnlocked(at);
      await storage(() => (backend as Backend).put(SECRETS, name, record));
      touch();
    },

    async delete(name) {
      checkName(name);
      await load();
      if (!backend) {
        plain?.delete(name);
        return;
      }
      await storage(() => (backend as Backend).delete(SECRETS, name));
      touch();
    },

    async list() {
      await load();
      touch();
      if (!backend) return [...(plain?.keys() ?? [])].sort();
      return (await backend.keys(SECRETS)).sort();
    },

    reset,
    destroy: reset,
  };
}
