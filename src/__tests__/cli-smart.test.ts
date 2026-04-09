import { describe, expect, it } from "bun:test";

const cwd = import.meta.dir.replace("/src/__tests__", "");

describe("CLI smart commands", () => {
  it("find --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "find", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--capability");
    expect(stdout).toContain("--modality");
    expect(stdout).toContain("--max-cost");
    expect(stdout).toContain("--min-context");
    expect(stdout).toContain("--sort");
    expect(stdout).toContain("--json");
  });

  it("compare --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "compare", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("models");
    expect(stdout).toContain("--json");
  });

  it("provider --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "provider", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--list");
    expect(stdout).toContain("--json");
  });

  it("cost --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "cost", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--input");
    expect(stdout).toContain("--output");
    expect(stdout).toContain("--json");
  });
});
