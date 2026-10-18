import { useEffect, useRef, useSyncExternalStore } from "react";
import type { KeyVault, KeyVaultState } from "./key-vault.js";
import {
  createLlmSettingsStore,
  type LlmSettingsState,
  type LlmSettingsStore,
  type LlmStoreOptions,
} from "./store.js";

/** The store's state, re-rendering on every change. */
export function useLlmSettings<E extends object = object>(
  store: LlmSettingsStore<E>,
): LlmSettingsState<E> {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** A store created once for the component's lifetime (options are read on the first render), and its state. */
export function useLlmStore<E extends object = object>(
  options: LlmStoreOptions<E>,
): { state: LlmSettingsState<E>; store: LlmSettingsStore<E> } {
  const ref = useRef<LlmSettingsStore<E> | null>(null);
  if (!ref.current) ref.current = createLlmSettingsStore(options);
  const store = ref.current;
  return { state: useLlmSettings(store), store };
}

export interface KeyVaultControls {
  state: KeyVaultState;
  isLocked: boolean;
  create: KeyVault["create"];
  unlock: KeyVault["unlock"];
  lock: KeyVault["lock"];
  /** Delete the vault and every secret, without the passphrase (irreversible). */
  reset: KeyVault["reset"];
  vault: KeyVault;
}

/** A vault's lock state, re-rendering on every change; reads its storage on mount. */
export function useKeyVault(vault: KeyVault): KeyVaultControls {
  const state = useSyncExternalStore(vault.subscribe, vault.getState, vault.getState);
  useEffect(() => {
    void vault.load();
  }, [vault]);
  return {
    state,
    isLocked: state !== "unlocked",
    create: vault.create,
    unlock: vault.unlock,
    lock: vault.lock,
    reset: vault.reset,
    vault,
  };
}
