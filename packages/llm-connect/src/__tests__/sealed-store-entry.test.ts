import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("llm-connect/sealed-store entry", () => {
  it("is exported on its own subpath", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.exports["./sealed-store"]).toEqual({
      types: "./build/sealed-store.d.ts",
      default: "./build/sealed-store.js",
    });
  });

  it("imports nothing, so apps using it alone bundle no AI SDK", () => {
    const source = readFileSync(join(root, "src", "sealed-store.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
