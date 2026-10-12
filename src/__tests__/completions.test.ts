import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../cli";
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "../completions";
import { TIERS } from "../functions/latest";
import { listUseCases } from "../functions/recommend";
import { CapabilityEnum, ModelSortFieldSchema } from "../schemas/functions";

const program = createProgram();
const generators = {
  bash: generateBashCompletion,
  zsh: generateZshCompletion,
  fish: generateFishCompletion,
};

/** How each shell spells a flag in its script. */
function spelled(shell: keyof typeof generators, flag: string): string {
  if (shell !== "fish") return flag;
  return flag.startsWith("--") ? `-l ${flag.slice(2)}` : `-s ${flag.slice(1)}`;
}

for (const [shell, generate] of Object.entries(generators) as [
  keyof typeof generators,
  typeof generateBashCompletion,
][]) {
  describe(`${shell} completion`, () => {
    const script = generate(program);

    it("names every command", () => {
      for (const command of program.commands) expect(script).toContain(command.name());
    });

    it("offers every option of every command", () => {
      for (const command of [program, ...program.commands]) {
        for (const option of command.options) {
          if (option.long) expect(script).toContain(spelled(shell, option.long));
          if (option.short) expect(script).toContain(spelled(shell, option.short));
        }
      }
    });

    it("completes values from the schemas", () => {
      for (const value of [
        ...CapabilityEnum.options,
        ...ModelSortFieldSchema.options,
        ...TIERS,
        ...Object.keys(listUseCases()),
        "alpha",
        "markdown",
        "chatbot",
      ]) {
        expect(script).toContain(value);
      }
    });

    it("drops the --use-case option that never existed", () => {
      expect(script).not.toContain("use-case[");
      expect(script).not.toContain("-l use-case");
      expect(script).not.toContain("--use-case");
    });

    const binary = Bun.which(shell);
    it.if(binary !== null)("parses with the shell's syntax check", () => {
      const dir = mkdtempSync(join(tmpdir(), "llm-models-completion-"));
      const file = join(dir, `completion.${shell}`);
      writeFileSync(file, script);
      try {
        const result = Bun.spawnSync([binary as string, "-n", file]);
        expect(result.stderr.toString()).toBe("");
        expect(result.exitCode).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
