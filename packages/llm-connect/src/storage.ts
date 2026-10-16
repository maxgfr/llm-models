import { isConfigured, type LlmSettings } from "./settings.js";

/** Saved settings, with the app's own fields (`E`) and where the key lives. */
export type StoredSettings<E extends object = object> = LlmSettings & E & { rememberKey?: boolean };

/**
 * Where settings are kept: {@link secureStorage} (encrypted key, recommended)
 * or {@link webStorage}. An app with its own scheme (migrations…) wraps one of
 * them in these few methods.
 */
export interface SettingsStorage<E extends object = object> {
  /** Settings that can call a model, or null. */
  load(): Promise<StoredSettings<E> | null>;
  /** Saved settings even without a key, to prefill a form. Falls back to `load`. */
  loadDraft?(): Promise<StoredSettings<E> | null>;
  save(settings: LlmSettings & E, options: { rememberKey: boolean }): Promise<void>;
  clear(): Promise<void>;
}

export interface WebStorageOptions {
  /** localStorage key of the non-secret preferences (JSON). */
  prefsKey: string;
  /** Key of the API key: sessionStorage, or localStorage when remembered. */
  apiKeyKey: string;
}

type Kind = "localStorage" | "sessionStorage";

// Storage can be missing or throw (server rendering, private mode, blocked site data, quota).
function webStore(kind: Kind): Storage | null {
  try {
    return (globalThis as { [K in Kind]?: Storage })[kind] ?? null;
  } catch {
    return null;
  }
}

export function readWeb(kind: Kind, key: string): string | null {
  try {
    return webStore(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeWeb(kind: Kind, key: string, value: string): void {
  try {
    webStore(kind)?.setItem(key, value);
  } catch {
    // Full or blocked: the settings only last for this page
  }
}

export function removeWeb(kind: Kind, key: string): void {
  try {
    webStore(kind)?.removeItem(key);
  } catch {
    // Nothing to clean up
  }
}

const STRING_FIELDS = [
  "model",
  "providerId",
  "providerName",
  "providerNpm",
  "providerApi",
  "customEndpoint",
  "customModel",
  "language",
] as const;

/**
 * The preferences saved under `prefsKey`, without the key: string fields only,
 * `model` always set, the app's own fields as they are. Null when none.
 */
export function readPrefs<E extends object>(prefsKey: string): StoredSettings<E> | null {
  const raw = readWeb("localStorage", prefsKey);
  if (raw === null) return null;
  let prefs: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      prefs = parsed as Record<string, unknown>;
  } catch {
    // Corrupted preferences: start from the defaults
  }
  const settings: Record<string, unknown> = { ...prefs, apiKey: "", model: "" };
  for (const field of STRING_FIELDS) {
    const value = prefs[field];
    if (typeof value === "string" && value) settings[field] = value;
    else if (field !== "model") delete settings[field];
  }
  settings.rememberKey = prefs.rememberKey === true;
  return settings as StoredSettings<E>;
}

/**
 * Preferences in localStorage; the API key in sessionStorage (forgotten with
 * the tab), or in localStorage when the user asks to remember it, in clear
 * text: prefer {@link secureStorage}, which encrypts it. Every access is
 * guarded, so a blocked storage degrades to settings that last for the page.
 * Fields beyond {@link LlmSettings} (a language…) are kept as they are.
 */
export function webStorage<E extends object = object>({
  prefsKey,
  apiKeyKey,
}: WebStorageOptions): SettingsStorage<E> {
  async function loadDraft(): Promise<StoredSettings<E> | null> {
    const prefs = readPrefs<E>(prefsKey);
    const apiKey = readWeb("sessionStorage", apiKeyKey) ?? readWeb("localStorage", apiKeyKey) ?? "";
    if (!prefs && !apiKey) return null;
    return { ...(prefs ?? ({ model: "", rememberKey: false } as StoredSettings<E>)), apiKey };
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
      removeWeb("localStorage", apiKeyKey);
      removeWeb("sessionStorage", apiKeyKey);
      if (apiKey) writeWeb(rememberKey ? "localStorage" : "sessionStorage", apiKeyKey, apiKey);
    },
    async clear() {
      removeWeb("localStorage", prefsKey);
      removeWeb("localStorage", apiKeyKey);
      removeWeb("sessionStorage", apiKeyKey);
    },
  };
}
