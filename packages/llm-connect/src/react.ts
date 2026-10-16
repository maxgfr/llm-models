import { useRef, useSyncExternalStore } from "react";
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
