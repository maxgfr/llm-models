import { describe, expect, it } from "bun:test";

describe("CLI", () => {
  it("should show version with --version", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "--version"], {
      cwd: import.meta.dir.replace("/src/__tests__", ""),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should show help with --help", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "--help"], {
      cwd: import.meta.dir.replace("/src/__tests__", ""),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("openrouter");
    expect(stdout).toContain("models-dev");
  });

  it("should show openrouter help", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "openrouter", "--help"], {
      cwd: import.meta.dir.replace("/src/__tests__", ""),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--search");
    expect(stdout).toContain("--count");
  });

  it("should show models-dev help", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "models-dev", "--help"], {
      cwd: import.meta.dir.replace("/src/__tests__", ""),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--search");
    expect(stdout).toContain("--count");
  });
});
