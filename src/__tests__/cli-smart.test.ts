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
    expect(stdout).toContain("--daily");
    expect(stdout).toContain("--monthly");
    expect(stdout).toContain("--profile");
  });

  it("find --help shows new Wave 1-3 flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "find", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--status");
    expect(stdout).toContain("--max-cost-output");
    expect(stdout).toContain("--family");
    expect(stdout).toContain("--count");
    expect(stdout).toContain("--ids-only");
    expect(stdout).toContain("--format");
  });

  it("cheapest --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "cheapest", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--capability");
    expect(stdout).toContain("--min-context");
    expect(stdout).toContain("--limit");
    expect(stdout).toContain("--json");
  });

  it("info --help shows expected args", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "info", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("model");
    expect(stdout).toContain("--json");
  });

  it("recommend --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "recommend", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("use-case");
    expect(stdout).toContain("--max-cost");
    expect(stdout).toContain("--list");
    expect(stdout).toContain("--json");
  });

  it("stats --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "stats", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--json");
  });

  it("diff --help shows expected flags", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "diff", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--json");
  });

  it("completion --help shows shell argument", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "completion", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("shell");
    expect(stdout).toContain("bash");
  });

  it("mcp --help shows description", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "mcp", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("MCP");
  });

  it("main --help shows global options", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "--help"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("--no-cache");
    expect(stdout).toContain("--quiet");
    expect(stdout).toContain("--verbose");
  });
});
