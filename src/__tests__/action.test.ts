import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the GitHub Action's steps the way the runner does: `${{ … }}`
// expressions are substituted textually into `run` and `env`, then bash runs
// the script. `npx` is a stub printing canned JSON, so nothing is installed.

const ROOT = import.meta.dir.replace("/src/__tests__", "");
const SANDBOX = mkdtempSync(join(tmpdir(), "llm-models-action-"));

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

interface Step {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

/** The two `if:` shapes action.yml uses: `inputs.x != ''` and `inputs.x == 'true'`. */
function enabled(condition: string | undefined, context: Record<string, string>): boolean {
  if (!condition) return true;
  const match = /^(\S+) (==|!=) '([^']*)'$/.exec(condition.trim());
  if (!match) throw new Error(`unsupported if: ${condition}`);
  const value = context[match[1]] ?? "";
  return match[2] === "==" ? value === match[3] : value !== match[3];
}

const action = Bun.YAML.parse(await Bun.file(join(ROOT, "action.yml")).text()) as {
  runs: { steps: Step[] };
};

function substitute(text: string, context: Record<string, string>): string {
  return text.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => context[expr] ?? "");
}

/** Run the action's steps in order, in a fresh runner sandbox, with `npx` printing `json`. */
async function runAction(json: string, inputs: Record<string, string>) {
  const dir = mkdtempSync(join(SANDBOX, "run-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "result.json"), json);
  writeFileSync(join(bin, "npx"), `#!/bin/sh\ncat "${join(dir, "result.json")}"\n`);
  chmodSync(join(bin, "npx"), 0o755);
  const outputFile = join(dir, "github-output");
  writeFileSync(outputFile, "");

  const context: Record<string, string> = {
    "inputs.command": "find",
    "inputs.args": "",
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`inputs.${k}`, v])),
  };
  const results: { name: string; stdout: string; stderr: string; code: number }[] = [];
  for (const step of action.runs.steps) {
    if (!step.run || !step.name || !enabled(step.if, context)) continue;
    const env = Object.fromEntries(
      Object.entries(step.env ?? {}).map(([key, value]) => [key, substitute(value, context)]),
    );
    const proc = Bun.spawn(["bash", "-e", "-c", substitute(step.run, context)], {
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_OUTPUT: outputFile,
        RUNNER_TEMP: dir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    results.push({ name: step.name, stdout, stderr, code });
    if (code !== 0) break;
    // What the runner exposes as steps.run.outputs.result.
    const output = await Bun.file(outputFile).text();
    const result = /result<<EOF\n([\s\S]*?)\nEOF/.exec(output);
    if (result) context["steps.run.outputs.result"] = result[1];
  }
  return results;
}

// `find --json` output: descriptions routinely contain apostrophes.
const models = JSON.stringify([
  { id: "acme/old", status: "deprecated", description: "Acme's previous model" },
  { id: "acme/new", description: "Acme's current model" },
]);

describe("action.yml", () => {
  it("fails on a deprecated model even when the JSON holds an apostrophe", async () => {
    const steps = await runAction(models, { "fail-on-deprecated": "true" });
    const check = steps.find((s) => s.name === "Check deprecated");
    expect(check?.code).toBe(1);
    expect(check?.stderr).toContain("Deprecated models found: acme/old");
  });

  it("passes when no model is deprecated", async () => {
    const current = JSON.stringify([{ id: "acme/new", description: "Acme's current model" }]);
    const steps = await runAction(current, { "fail-on-deprecated": "true" });
    expect(steps.map((s) => [s.name, s.code])).toEqual([
      ["Run llm-models", 0],
      ["Check deprecated", 0],
    ]);
  });

  it("enforces the budget on cost output", async () => {
    const costs = JSON.stringify([
      { model: "acme/new", total_cost_usd: 12.5 },
      { model: "acme/cheap", total_cost_usd: 0.5 },
    ]);
    const over = await runAction(costs, { "max-budget": "10" });
    const budget = over.find((s) => s.name === "Check budget");
    expect(budget?.code).toBe(1);
    expect(budget?.stderr).toContain("Budget exceeded: acme/new");

    const within = await runAction(costs, { "max-budget": "20" });
    expect(within.find((s) => s.name === "Check budget")?.code).toBe(0);
  });
});
