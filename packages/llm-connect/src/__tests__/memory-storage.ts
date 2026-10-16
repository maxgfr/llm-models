/** A Web Storage kept in a Map, installed as globalThis.localStorage/sessionStorage. */
export class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}

type Kind = "localStorage" | "sessionStorage";
const globals = globalThis as { [K in Kind]?: Storage };

/** Fresh storages for a test; returns them and a restore function. */
export function installStorages() {
  const previous = { localStorage: globals.localStorage, sessionStorage: globals.sessionStorage };
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  globals.localStorage = local;
  globals.sessionStorage = session;
  return {
    local,
    session,
    restore() {
      globals.localStorage = previous.localStorage;
      globals.sessionStorage = previous.sessionStorage;
    },
  };
}
