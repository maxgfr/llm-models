import { type KeyVault, KeyVaultError } from "./key-vault.js";
import { isConfigured, type LlmSettings } from "./settings.js";
import {
  readPrefs,
  removeWeb,
  type SettingsStorage,
  type StoredSettings,
  writeWeb,
} from "./storage.js";

export interface VaultStorageOptions {
  /** The vault holding the API keys (see `createKeyVault`). */
  vault: KeyVault;
  /** localStorage key of the non-secret preferences (JSON). */
  prefsKey: string;
  /** Name of the settings' key in the vault. Default: the provider id, or "custom" for a custom endpoint. */
  keyName?: (settings: Partial<LlmSettings>) => string;
}

/** The provider id, or "custom" for a custom endpoint; "openai" when neither is set. */
export function defaultKeyName(settings: Partial<LlmSettings>): string {
  if (settings.customEndpoint) return "custom";
  return settings.providerId || "openai";
}

/**
 * Settings whose API key lives in a {@link KeyVault}, under the provider's
 * name (`keyName`), so each provider keeps its own key. Preferences, without
 * the key, go to localStorage as with {@link secureStorage}.
 *
 * While the vault is locked the key reads as empty (`load()` gives null for a
 * provider, `loadDraft()` the preferences), and saving a key throws a
 * `KeyVaultError` with the code `locked`: unlock first. A key saved with
 * `rememberKey: false` stays in memory for the page and is forgotten on lock.
 */
export function vaultStorage<E extends object = object>({
  vault,
  prefsKey,
  keyName = defaultKeyName,
}: VaultStorageOptions): SettingsStorage<E> {
  // Keys of the session only (rememberKey: false), dropped when the vault locks
  const memory = new Map<string, string>();
  vault.subscribe((state) => {
    if (state !== "unlocked") memory.clear();
  });

  async function readKey(name: string): Promise<string> {
    const kept = memory.get(name);
    if (kept !== undefined) return kept;
    await vault.load();
    if (vault.isLocked) return "";
    try {
      return (await vault.get(name)) ?? "";
    } catch {
      // Tampered or locked meanwhile: ask for the key again
      return "";
    }
  }

  async function loadDraft(): Promise<StoredSettings<E> | null> {
    const prefs = readPrefs<E>(prefsKey);
    if (!prefs) return null;
    return { ...prefs, apiKey: await readKey(keyName(prefs)) };
  }

  return {
    loadDraft,
    async load() {
      const draft = await loadDraft();
      return isConfigured(draft) ? draft : null;
    },
    async save(settings, { rememberKey }) {
      const { apiKey, ...prefs } = settings;
      const name = keyName(settings);
      await vault.load();
      if (apiKey && vault.isLocked) throw new KeyVaultError("locked", "Unlock the vault first");
      if (apiKey && rememberKey) await vault.set(name, apiKey);
      else await vault.delete(name);
      memory.delete(name);
      if (apiKey && !rememberKey) memory.set(name, apiKey);
      writeWeb("localStorage", prefsKey, JSON.stringify({ ...prefs, rememberKey }));
    },
    async clear() {
      const prefs = readPrefs<E>(prefsKey);
      removeWeb("localStorage", prefsKey);
      if (!prefs) return;
      const name = keyName(prefs);
      memory.delete(name);
      try {
        await vault.delete(name);
      } catch {
        // Nothing to clean up
      }
    },
  };
}

/**
 * Move saved settings from another storage (`secureStorage`, `webStorage`…) to
 * a vault-backed one: the key goes into the vault (`to` must be unlocked), then
 * `from` is cleared, which erases its copy of the key, and the preferences are
 * written again through `to` (both may share a `prefsKey`). Resolves to whether
 * a key moved; without one, nothing is touched.
 */
export async function migrateToVault<E extends object = object>(
  from: SettingsStorage<E>,
  to: SettingsStorage<E>,
): Promise<boolean> {
  const saved = await (from.loadDraft ?? from.load)();
  if (!saved?.apiKey) return false;
  const { rememberKey: _remembered, ...rest } = saved;
  const settings = rest as LlmSettings & E;
  // Stored first, so a locked vault or a failed write leaves the old copy in place
  await to.save(settings, { rememberKey: true });
  await from.clear();
  await to.save(settings, { rememberKey: true });
  return true;
}
