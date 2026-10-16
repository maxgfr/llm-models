import { describe, expect, it } from "bun:test";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { createMemoryStore } from "../cache-core";

const SRC = join(import.meta.dir, "..");

/**
 * Bundle `entry` for the browser and list every Node.js builtin it pulls in.
 * Bun's browser target quietly polyfills some builtins (node:path, node:os…),
 * so the resolver is watched instead of trusting the build's success.
 */
async function nodeBuiltinsIn(entry: string): Promise<string[]> {
  const pulled = new Set<string>();
  await Bun.build({
    entrypoints: [join(SRC, entry)],
    target: "browser",
    throw: false,
    plugins: [
      {
        name: "watch-node-builtins",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (isBuiltin(args.path)) pulled.add(args.path);
            return undefined;
          });
        },
      },
    ],
  });
  return [...pulled].sort();
}

describe("browser entry", () => {
  it("bundles for the browser without any Node.js builtin", async () => {
    expect(await nodeBuiltinsIn("browser.ts")).toEqual([]);
  });

  it("the check catches builtins (the Node entry pulls some in)", async () => {
    expect(await nodeBuiltinsIn("index.ts")).toContain("node:fs");
  });

  it("bundles the catalog entry without any Node.js builtin or Zod", async () => {
    expect(await nodeBuiltinsIn("catalog.ts")).toEqual([]);
    const build = await Bun.build({ entrypoints: [join(SRC, "catalog.ts")], target: "browser" });
    const code = await build.outputs[0].text();
    expect(code).not.toContain("zod");
    expect(code.length).toBeLessThan(2000);
  });

  it("exports the same API as the Node entry", async () => {
    const browser = await import("../browser");
    const node = await import("../index");
    expect(Object.keys(browser).sort()).toEqual(Object.keys(node).sort());
  });
});

describe("memory cache store", () => {
  it("reads back what it wrote and clears", () => {
    const store = createMemoryStore();
    expect(store.read("k")).toBeNull();
    store.write("k", { timestamp: 1, data: { a: 1 } });
    expect(store.read("k")).toEqual({ timestamp: 1, data: { a: 1 } });
    expect(store.clear()).toBe(true);
    expect(store.read("k")).toBeNull();
    expect(store.clear()).toBe(false);
  });
});
