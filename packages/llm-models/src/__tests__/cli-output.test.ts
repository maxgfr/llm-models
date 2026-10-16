import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end CLI runs against a fresh fixture cache in a throwaway HOME, so
// nothing here touches the network or the real ~/.cache.

const ROOT = import.meta.dir.replace("/src/__tests__", "");
let home = "";

function openRouterModel(id: string, prompt: string, completion: string) {
  return {
    id,
    canonical_slug: id,
    name: id,
    description: `${id} description`,
    created: 1715558400, // 2024-05-13
    context_length: 128000,
    supported_parameters: ["tools"],
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
      tokenizer: "GPT",
    },
    pricing: { prompt, completion },
    top_provider: { context_length: 128000, max_completion_tokens: 16384, is_moderated: false },
    links: { details: "/test" },
  };
}

function modelsDevModel(id: string, input: number, output: number) {
  return {
    id,
    name: id,
    attachment: false,
    reasoning: false,
    tool_call: true,
    open_weights: false,
    release_date: "2024-05-13",
    last_updated: "2024-05-13",
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 128000, output: 16384 },
    cost: { input, output },
  };
}

const acmeModels: Record<string, ReturnType<typeof modelsDevModel>> = {};
for (let i = 1; i <= 25; i++) {
  const id = `model-${String(i).padStart(2, "0")}`;
  acmeModels[id] = modelsDevModel(id, i, i * 2);
}

const openRouter = {
  data: [
    openRouterModel("openai/gpt-4o", "0.0000025", "0.00001"),
    openRouterModel("openai/gpt-4o-mini", "0.00000015", "0.0000006"),
  ],
};

const modelsDev = {
  openai: {
    id: "openai",
    name: "OpenAI",
    doc: "https://platform.openai.com/docs",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      "gpt-4o": modelsDevModel("gpt-4o", 2.5, 10),
      "gpt-4o-mini": modelsDevModel("gpt-4o-mini", 0.15, 0.6),
    },
  },
  acme: {
    id: "acme",
    name: "Acme",
    doc: "https://acme.example/docs",
    env: ["ACME_API_KEY"],
    npm: "@ai-sdk/acme",
    models: acmeModels,
  },
};

const TOTAL = 27;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "llm-models-cli-"));
  const cacheDir = join(home, ".cache", "llm-models");
  mkdirSync(cacheDir, { recursive: true });
  const write = (key: string, data: unknown) =>
    writeFileSync(join(cacheDir, `${key}.json`), JSON.stringify({ timestamp: Date.now(), data }));
  write("openrouter", openRouter);
  write("models-dev", modelsDev);
  // Browser probe verdicts for the default origin, so `provider --browser` never hits the network.
  const checked_at = new Date().toISOString();
  const origin = "https://example.com";
  write("browser-https_example_com", {
    openai: { callable: true, origin, evidence: "preflight", checked_at },
    acme: {
      callable: false,
      origin,
      evidence: "none",
      reason: "no known base URL",
      checked_at,
    },
  });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return runIn(home, ...args);
}

async function runIn(
  homeDir: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, code: await proc.exited };
}

const lines = (text: string) => text.trimEnd().split("\n");

describe("find output", () => {
  it("shows 20 rows and a footer in a table by default", async () => {
    const { stdout, code } = await run("find");
    expect(code).toBe(0);
    expect(stdout).toContain(`(20 of ${TOTAL} models shown, -n 0 to show all)`);
    // header + separator + 20 rows + blank + footer
    expect(lines(stdout)).toHaveLength(24);
  });

  it("prints every model and no footer in CSV", async () => {
    const { stdout } = await run("find", "--format", "csv");
    expect(lines(stdout)).toHaveLength(TOTAL + 1);
    expect(stdout).not.toContain("shown");
  });

  it("shows everything with -n 0", async () => {
    const { stdout } = await run("find", "-n", "0");
    expect(stdout).not.toContain("shown");
    expect(lines(stdout)).toHaveLength(TOTAL + 2);
  });

  it("rejects a cost with trailing characters instead of reading its prefix", async () => {
    for (const value of ["1,5", "2abc", "1.2.3", ""]) {
      const { stderr, code } = await run("find", "--max-cost", value);
      expect(code).toBe(1);
      expect(stderr).toContain("Expected a number");
    }
    expect((await run("find", "--max-cost", "2.5", "-c")).stdout.trim()).toBe("4");
  });

  it("rejects --desc without --sort", async () => {
    const { stderr, code } = await run("find", "--desc");
    expect(code).toBe(1);
    expect(stderr).toContain("--desc needs --sort");
  });
});

describe("model lookup", () => {
  it("info finds the exact id among ids that contain it", async () => {
    const { stdout, code } = await run("info", "gpt-4o", "--field", "id");
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("openai/gpt-4o");
  });

  it("compare accepts short ids and lays out every column", async () => {
    const { stdout, code } = await run("compare", "gpt-4o", "gpt-4o-mini");
    expect(code).toBe(0);
    expect(lines(stdout)[0]).toMatch(/openai\/gpt-4o\s+openai\/gpt-4o-mini/);
    expect(stdout).toContain("= best in category");
  });

  it("compare refuses two spellings of the same model", async () => {
    const { stderr, code } = await run("compare", "gpt-4o", "openai/gpt-4o");
    expect(code).toBe(1);
    expect(stderr).toContain("2 distinct models");
  });
});

describe("cost output", () => {
  it("shows sub-cent costs instead of $0.00", async () => {
    const { stdout } = await run("cost", "gpt-4o-mini", "-P", "chatbot");
    expect(stdout).toContain("$0.0015");
    expect(stdout).not.toContain("$0.00 ");
  });

  it("projects daily and monthly the same way in JSON and table", async () => {
    const args = ["cost", "gpt-4o", "-i", "1M", "-o", "0", "--daily", "10", "--monthly", "100"];
    const json = JSON.parse((await run(...args, "--json")).stdout);
    expect(json[0].daily_cost_usd).toBeCloseTo(25);
    expect(json[0].monthly_cost_usd).toBeCloseTo(250);
    const table = (await run(...args)).stdout;
    expect(table).toContain("$25.00");
    expect(table).toContain("$250.00");
  });

  it("keeps the header line out of CSV", async () => {
    const { stdout } = await run("cost", "gpt-4o", "-i", "1K", "-o", "1K", "--format", "csv");
    expect(lines(stdout)[0]).toBe("Model,Input Cost,Output Cost,Total");
  });
});

describe("machine formats stay clean", () => {
  it("provider details only print in a table", async () => {
    const { stdout } = await run("provider", "OPENAI", "--format", "csv");
    expect(lines(stdout)[0]).toBe("ID,Context,Output,$/M In,$/M Out,Capabilities");
  });

  it("provider lookup keeps models.dev details whatever the case", async () => {
    const { stdout } = await run("provider", "OPENAI");
    expect(stdout).toContain("OPENAI_API_KEY");
  });

  it("recommend prints no preamble in CSV", async () => {
    const { stdout } = await run("recommend", "tool-use", "--format", "csv");
    expect(lines(stdout)[0]).toBe("ID,Context,Output,$/M In,$/M Out,Capabilities");
  });
});

describe("provider --browser", () => {
  it("adds a Browser column to the provider list", async () => {
    const { stdout, code } = await run("provider", "--list", "--browser", "--format", "csv");
    expect(code).toBe(0);
    expect(lines(stdout)).toEqual([
      "Provider,Models,NPM Package,Browser",
      "acme,25,@ai-sdk/acme,no",
      "openai,2,@ai-sdk/openai,yes",
    ]);
  });

  it("keeps only callable providers with --browser-only", async () => {
    const { stdout } = await run("provider", "--browser-only", "--format", "csv");
    expect(lines(stdout)).toEqual([
      "Provider,Models,NPM Package,Browser",
      "openai,2,@ai-sdk/openai,yes",
    ]);
  });

  it("includes the verdict in JSON", async () => {
    const { stdout } = await run("provider", "--browser-only", "--json");
    const [openai] = JSON.parse(stdout);
    expect(openai.browser).toMatchObject({ callable: true, evidence: "preflight" });
  });

  it("prints the verdict in the provider view", async () => {
    const { stdout } = await run("provider", "acme", "--browser");
    expect(stdout).toContain("Browser: no (from https://example.com: no known base URL)");
  });

  it("leaves the column out without the flag", async () => {
    const { stdout } = await run("provider", "--list", "--format", "csv");
    expect(lines(stdout)[0]).toBe("Provider,Models,NPM Package");
  });

  it("rejects an origin that is not a URL", async () => {
    const { stderr, code } = await run("provider", "--browser", "--origin", "example");
    expect(code).toBe(1);
    expect(stderr).toContain("Expected an origin");
  });
});

describe("cache and config actions", () => {
  it("rejects an unknown cache action", async () => {
    const { stderr, code } = await run("cache", "bogus");
    expect(code).toBe(1);
    expect(stderr).toContain("Allowed choices are info, clear");
  });

  it("rejects an unknown config action", async () => {
    const { code } = await run("config", "bogus");
    expect(code).toBe(1);
  });

  it("reports the real cache directory", async () => {
    const { stdout } = await run("cache");
    expect(stdout).toContain(join(home, ".cache", "llm-models"));
    expect(stdout).toContain("Enabled: yes");
    expect(stdout).toContain("TTL: 3600s");
  });
});

describe("config file", () => {
  /** A HOME sharing the fixture cache, with its own config.json. */
  function homeWithConfig(config: string): string {
    const dir = mkdtempSync(join(tmpdir(), "llm-models-config-"));
    mkdirSync(join(dir, ".config", "llm-models"), { recursive: true });
    writeFileSync(join(dir, ".config", "llm-models", "config.json"), config);
    symlinkSync(join(home, ".cache"), join(dir, ".cache"));
    return dir;
  }

  it("applies cache.enabled and cache.ttl", async () => {
    const dir = homeWithConfig(JSON.stringify({ cache: { enabled: false, ttl: 60_000 } }));
    try {
      const { stdout } = await runIn(dir, "cache");
      expect(stdout).toContain("Enabled: no");
      expect(stdout).toContain("TTL: 60s");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies defaults.limit, defaults.sort and defaults.desc to find", async () => {
    const config = { defaults: { limit: 3, sort: "cost_input", desc: true } };
    const dir = homeWithConfig(JSON.stringify(config));
    try {
      const { stdout } = await runIn(dir, "find");
      const rows = lines(stdout).slice(2, 5);
      expect(rows.map((row) => row.split(/\s+/)[0])).toEqual([
        "acme/model-25",
        "acme/model-24",
        "acme/model-23",
      ]);
      expect(stdout).toContain(`(3 of ${TOTAL} models shown`);
      // --desc alone is fine once the config supplies the sort field.
      expect((await runIn(dir, "find", "--desc", "-c")).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns about an invalid config instead of ignoring it silently", async () => {
    const dir = homeWithConfig(JSON.stringify({ defaults: { sort: "bogus" } }));
    try {
      const { stderr, code } = await runIn(dir, "cache");
      expect(code).toBe(0);
      expect(stderr).toContain("Warning: ignoring config");
      expect(stderr).toContain("defaults.sort");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("catalog", () => {
  it("prints the slim catalog of the callable providers", async () => {
    const { stdout, code } = await run("catalog", "--npm", "callable");
    expect(code).toBe(0);
    const catalog = JSON.parse(stdout);
    // acme ships its own SDK, which a web app cannot call through llm-connect
    expect(Object.keys(catalog)).toEqual(["openai"]);
    expect(catalog.openai).toEqual({
      id: "openai",
      name: "OpenAI",
      npm: "@ai-sdk/openai",
      api: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      models: {
        "gpt-4o": { id: "gpt-4o", name: "gpt-4o", tool_call: true },
        "gpt-4o-mini": { id: "gpt-4o-mini", name: "gpt-4o-mini", tool_call: true },
      },
    });
  });

  it("writes the file only when its content changes", async () => {
    const out = join(home, "public", "models.json");
    const first = await run("catalog", "--npm", "@ai-sdk/openai,@ai-sdk/acme", "--out", out);
    expect(first.code).toBe(0);
    expect(first.stdout).toBe("");
    expect(first.stderr).toContain("2 providers, 27 models");
    expect(Object.keys(JSON.parse(await Bun.file(out).text()))).toEqual(["acme", "openai"]);

    const second = await run("catalog", "--npm", "@ai-sdk/openai,@ai-sdk/acme", "--out", out);
    expect(second.code).toBe(0);
    expect(second.stderr).toContain("Unchanged");
  });

  it("fails when a required provider is missing", async () => {
    const { stderr, code } = await run("catalog", "--npm", "callable", "--require", "openai,acme");
    expect(code).toBe(1);
    expect(stderr).toContain("missing required providers: acme");
  });
});
