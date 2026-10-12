import type { Command, Option } from "commander";
import { listProfiles } from "./config";

// Completions are generated from the Commander program itself, so a new
// command, option or enum value shows up in every shell without editing a list.

interface OptionSpec {
  short?: string;
  long?: string;
  description: string;
  takesValue: boolean;
  values?: string[];
}

interface ArgumentSpec {
  name: string;
  variadic: boolean;
  values?: string[];
}

interface CommandSpec {
  name: string;
  description: string;
  options: OptionSpec[];
  args: ArgumentSpec[];
}

const HELP: OptionSpec = {
  short: "-h",
  long: "--help",
  description: "Display help",
  takesValue: false,
};

/** Values an option accepts that Commander cannot know: they live in the config. */
function dynamicValues(option: Option): string[] | undefined {
  if (option.long === "--profile") return Object.keys(listProfiles());
  return undefined;
}

function optionSpec(option: Option): OptionSpec {
  return {
    short: option.short,
    long: option.long,
    description: option.description,
    takesValue: option.required || option.optional,
    values: option.argChoices ?? dynamicValues(option),
  };
}

function describeProgram(program: Command): { globals: OptionSpec[]; commands: CommandSpec[] } {
  const visible = (options: readonly Option[]) => options.filter((o) => !o.hidden).map(optionSpec);
  const commands: CommandSpec[] = program.commands.map((command) => ({
    name: command.name(),
    description: command.description(),
    options: [...visible(command.options), HELP],
    args: command.registeredArguments.map((arg) => ({
      name: arg.name(),
      variadic: arg.variadic,
      values: arg.argChoices,
    })),
  }));
  commands.push({
    name: "help",
    description: "Display help for a command",
    options: [],
    args: [{ name: "command", variadic: false, values: commands.map((c) => c.name) }],
  });
  return { globals: [...visible(program.options), HELP], commands };
}

function flags(option: OptionSpec): string[] {
  return [option.short, option.long].filter((f): f is string => f !== undefined);
}

// --- bash ---

function bashCase(command: CommandSpec): string {
  const valueCases = command.options
    .filter((o) => o.takesValue)
    .map((o) => {
      const reply = o.values
        ? `COMPREPLY=( $(compgen -W "${o.values.join(" ")}" -- "$cur") ); `
        : "";
      return `        ${flags(o).join("|")}) ${reply}return 0 ;;`;
    });
  const argValues = command.args.flatMap((a) => a.values ?? []);
  const allFlags = command.options.flatMap(flags).join(" ");
  return [
    `    ${command.name})`,
    ...(valueCases.length > 0 ? ['      case "$prev" in', ...valueCases, "      esac"] : []),
    `      if [[ "$cur" == -* ]]; then`,
    `        COMPREPLY=( $(compgen -W "${allFlags}" -- "$cur") )`,
    ...(argValues.length > 0
      ? ["      else", `        COMPREPLY=( $(compgen -W "${argValues.join(" ")}" -- "$cur") )`]
      : []),
    "      fi",
    "      ;;",
  ].join("\n");
}

export function generateBashCompletion(program: Command): string {
  const { globals, commands } = describeProgram(program);
  return `# bash completion for llm-models
_llm_models() {
  local cur prev cmd i
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # The first word that is not a flag is the command (global flags take no value).
  cmd=""
  for ((i = 1; i < COMP_CWORD; i++)); do
    if [[ "\${COMP_WORDS[i]}" != -* ]]; then
      cmd="\${COMP_WORDS[i]}"
      break
    fi
  done

  case "$cmd" in
    "")
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "${globals.flatMap(flags).join(" ")}" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "${commands.map((c) => c.name).join(" ")}" -- "$cur") )
      fi
      ;;
${commands.map(bashCase).join("\n")}
  esac
  return 0
}
complete -F _llm_models llm-models
`;
}

// --- zsh ---

/** Text safe inside a single-quoted zsh word and an _arguments [description]. */
function zshText(text: string): string {
  return text.replace(/'/g, "'\\''").replace(/\[/g, "(").replace(/\]/g, ")").replace(/:/g, " -");
}

function zshOption(option: OptionSpec): string[] {
  const all = flags(option);
  const exclusion = all.length > 1 ? `(${all.join(" ")})` : "";
  const value = option.takesValue
    ? `:${zshText(option.long?.replace(/^--/, "") ?? "value")}:${option.values ? `(${option.values.join(" ")})` : " "}`
    : "";
  return all.map((flag) => `'${exclusion}${flag}[${zshText(option.description)}]${value}'`);
}

function zshArgument(arg: ArgumentSpec, position: number): string {
  const action = arg.values ? `(${arg.values.join(" ")})` : " ";
  const spec = arg.variadic ? "*" : String(position);
  return `'${spec}:${zshText(arg.name)}:${action}'`;
}

function zshCase(command: CommandSpec): string {
  const specs = [
    ...command.options.flatMap(zshOption),
    ...command.args.map((arg, index) => zshArgument(arg, index + 1)),
  ];
  return [
    `        ${command.name})`,
    `          _arguments \\`,
    specs.map((spec) => `            ${spec}`).join(" \\\n"),
    "          ;;",
  ].join("\n");
}

export function generateZshCompletion(program: Command): string {
  const { globals, commands } = describeProgram(program);
  const commandList = commands
    .map((c) => `    '${zshText(c.name)}:${zshText(c.description)}'`)
    .join("\n");
  return `#compdef llm-models
_llm_models() {
  local curcontext="$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
${globals
  .flatMap(zshOption)
  .map((spec) => `    ${spec} \\`)
  .join("\n")}
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      local -a commands
      commands=(
${commandList}
      )
      _describe -t commands 'llm-models command' commands
      ;;
    args)
      case $line[1] in
${commands.map(zshCase).join("\n")}
      esac
      ;;
  esac
}
_llm_models "$@"
`;
}

// --- fish ---

/** A single-quoted fish string. */
function fishQuote(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function fishOption(option: OptionSpec, condition: string): string {
  const parts = ["complete -c llm-models", `-n ${fishQuote(condition)}`];
  if (option.short) parts.push(`-s ${option.short.replace(/^-/, "")}`);
  if (option.long) parts.push(`-l ${option.long.replace(/^--/, "")}`);
  if (option.takesValue) parts.push("-x");
  if (option.values) parts.push(`-a ${fishQuote(option.values.join(" "))}`);
  parts.push(`-d ${fishQuote(option.description)}`);
  return parts.join(" ");
}

export function generateFishCompletion(program: Command): string {
  const { globals, commands } = describeProgram(program);
  const lines = ["# fish completion for llm-models", "complete -c llm-models -f", "", "# Commands"];

  for (const command of commands) {
    lines.push(
      `complete -c llm-models -n __fish_use_subcommand -a ${command.name} -d ${fishQuote(command.description)}`,
    );
  }

  lines.push("", "# Global options");
  for (const option of globals) lines.push(fishOption(option, "__fish_use_subcommand"));

  for (const command of commands) {
    const condition = `__fish_seen_subcommand_from ${command.name}`;
    lines.push("", `# ${command.name}`);
    for (const option of command.options) lines.push(fishOption(option, condition));
    const argValues = command.args.flatMap((a) => a.values ?? []);
    if (argValues.length > 0) {
      lines.push(
        `complete -c llm-models -n ${fishQuote(condition)} -a ${fishQuote(argValues.join(" "))}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
