const COMMANDS = [
  "find",
  "compare",
  "provider",
  "cost",
  "cheapest",
  "recommend",
  "stats",
  "diff",
  "info",
  "cache",
  "config",
  "openrouter",
  "models-dev",
  "mcp",
  "completion",
];

const CAPABILITIES = ["reasoning", "tool_call", "structured_output", "open_weights", "attachment"];
const SORT_FIELDS = [
  "cost_input",
  "cost_output",
  "context_length",
  "release_date",
  "name",
  "knowledge_cutoff",
  "value",
];
const FORMATS = ["table", "json", "csv", "markdown"];
const STATUSES = ["active", "beta", "deprecated"];
const USE_CASES = [
  "code-gen",
  "vision",
  "cheap-chatbot",
  "reasoning",
  "long-context",
  "open-source",
  "audio",
  "tool-use",
];

export function generateBashCompletion(): string {
  return `# bash completion for llm-models
_llm_models() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${COMMANDS.join(" ")}"

  case "\${prev}" in
    --capability|-C)
      COMPREPLY=( $(compgen -W "${CAPABILITIES.join(" ")}" -- "\${cur}") )
      return 0
      ;;
    --sort)
      COMPREPLY=( $(compgen -W "${SORT_FIELDS.join(" ")}" -- "\${cur}") )
      return 0
      ;;
    --format)
      COMPREPLY=( $(compgen -W "${FORMATS.join(" ")}" -- "\${cur}") )
      return 0
      ;;
    --status)
      COMPREPLY=( $(compgen -W "${STATUSES.join(" ")}" -- "\${cur}") )
      return 0
      ;;
    --use-case|-u)
      COMPREPLY=( $(compgen -W "${USE_CASES.join(" ")}" -- "\${cur}") )
      return 0
      ;;
  esac

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi
}
complete -F _llm_models llm-models
`;
}

export function generateZshCompletion(): string {
  return `#compdef llm-models
_llm_models() {
  local -a commands capabilities sort_fields formats statuses use_cases
  commands=(${COMMANDS.map((c) => `'${c}'`).join(" ")})
  capabilities=(${CAPABILITIES.join(" ")})
  sort_fields=(${SORT_FIELDS.join(" ")})
  formats=(${FORMATS.join(" ")})
  statuses=(${STATUSES.join(" ")})
  use_cases=(${USE_CASES.map((u) => `'${u}'`).join(" ")})

  _arguments -C \\
    '1:command:(\${commands})' \\
    '--capability[Filter by capability]:capability:(\${capabilities})' \\
    '-C[Filter by capability]:capability:(\${capabilities})' \\
    '--sort[Sort field]:field:(\${sort_fields})' \\
    '--format[Output format]:format:(\${formats})' \\
    '--status[Filter by status]:status:(\${statuses})' \\
    '--use-case[Use case]:use_case:(\${use_cases})' \\
    '-u[Use case]:use_case:(\${use_cases})' \\
    '-p[Provider ID]:provider:' \\
    '--provider[Provider ID]:provider:' \\
    '-s[Search term]:search:' \\
    '--search[Search term]:search:' \\
    '-n[Limit results]:limit:' \\
    '--limit[Limit results]:limit:' \\
    '--json[Output as JSON]' \\
    '--desc[Sort descending]' \\
    '--count[Show count only]' \\
    '--ids-only[Output IDs only]' \\
    '--no-cache[Disable cache]' \\
    '--quiet[Suppress info messages]' \\
    '--verbose[Show debug info]' \\
    '*:model ID:'
}
_llm_models "$@"
`;
}

export function generateFishCompletion(): string {
  const lines = ["# fish completion for llm-models", "complete -c llm-models -f", "", "# Commands"];

  for (const cmd of COMMANDS) {
    lines.push(`complete -c llm-models -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} command'`);
  }

  lines.push("", "# Capabilities");
  for (const cap of CAPABILITIES) {
    lines.push(`complete -c llm-models -l capability -s C -a '${cap}'`);
  }

  lines.push("", "# Sort fields");
  for (const field of SORT_FIELDS) {
    lines.push(`complete -c llm-models -l sort -a '${field}'`);
  }

  lines.push("", "# Formats");
  for (const fmt of FORMATS) {
    lines.push(`complete -c llm-models -l format -a '${fmt}'`);
  }

  lines.push("", "# Statuses");
  for (const status of STATUSES) {
    lines.push(`complete -c llm-models -l status -a '${status}'`);
  }

  lines.push("", "# Use cases");
  for (const uc of USE_CASES) {
    lines.push(`complete -c llm-models -l use-case -s u -a '${uc}'`);
  }

  lines.push(
    "",
    "# Flags",
    "complete -c llm-models -l json -d 'Output as JSON'",
    "complete -c llm-models -l desc -d 'Sort descending'",
    "complete -c llm-models -l count -s c -d 'Show count only'",
    "complete -c llm-models -l ids-only -d 'Output IDs only'",
    "complete -c llm-models -l no-cache -d 'Disable cache'",
    "complete -c llm-models -l quiet -d 'Suppress info messages'",
    "complete -c llm-models -l verbose -d 'Show debug info'",
  );

  return `${lines.join("\n")}\n`;
}
