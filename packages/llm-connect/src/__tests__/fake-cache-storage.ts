/** An in-memory Cache Storage: what a page keeps across loads, for tests. */
export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  failPuts = false;

  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache(this);
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }

  /** The stored entry of `url` in `name`, if any. */
  entry(name: string, url: string): { body: string; headers: Headers } | undefined {
    return this.caches.get(name)?.entries.get(url);
  }

  asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}

class FakeCache {
  readonly entries = new Map<string, { body: string; headers: Headers }>();

  constructor(private readonly storage: FakeCacheStorage) {}

  async match(url: string): Promise<Response | undefined> {
    const entry = this.entries.get(url);
    return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
  }

  async put(url: string, response: Response): Promise<void> {
    if (this.storage.failPuts) throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.entries.set(url, { body: await response.text(), headers: new Headers(response.headers) });
  }
}
