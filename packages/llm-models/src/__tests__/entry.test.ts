import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function run(cmd: string[]): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: resolve(import.meta.dir, "../.."),
  });
  const stdout = await new Response(proc.stdout).text();
  return { stdout, code: await proc.exited };
}

describe("entry points", () => {
  it("does not start the CLI when the library is bundled into another program", async () => {
    // A bundle is its own entry point: any "am I the entry?" check in the library says yes.
    const dir = mkdtempSync(join(tmpdir(), "llm-models-entry-"));
    try {
      const app = join(dir, "app.ts");
      const index = resolve(import.meta.dir, "../index.ts");
      writeFileSync(
        app,
        `import { getStats } from ${JSON.stringify(index)};\nconsole.log("app:" + typeof getStats);\n`,
      );
      const build = await Bun.build({ entrypoints: [app], outdir: dir, target: "bun" });
      expect(build.success).toBe(true);
      const { stdout, code } = await run([process.execPath, join(dir, "app.js"), "--version"]);
      expect(stdout).toBe("app:function\n");
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts the CLI from src/bin.ts", async () => {
    const { stdout, code } = await run([process.execPath, "run", "src/bin.ts", "--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(code).toBe(0);
  });
});
