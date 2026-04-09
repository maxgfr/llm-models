# llm-models

Fetch latest LLM models from [OpenRouter](https://openrouter.ai) and [models.dev](https://models.dev) APIs.

Validates API responses with [Zod](https://zod.dev) schemas to detect breaking changes.

## Installation

### Homebrew

```bash
brew install maxgfr/tap/llm-models
```

### npm

```bash
npm install -g llm-models
```

### Binary

Download the latest binary from [GitHub Releases](https://github.com/maxgfr/llm-models/releases).

| Platform | Binary |
|----------|--------|
| macOS ARM64 | `llm-models-macos-arm64` |
| macOS Intel | `llm-models-macos-x64` |
| Linux x86_64 | `llm-models-linux-x64` |
| Linux ARM64 | `llm-models-linux-arm64` |
| Windows x64 | `llm-models-win-x64.exe` |

## CLI Usage

### OpenRouter

```bash
# List all models
llm-models openrouter

# Filter by provider
llm-models openrouter --provider google

# Search by name or ID
llm-models openrouter --search "claude"

# Show model count
llm-models openrouter --count
```

### models.dev

```bash
# List all providers and models
llm-models models-dev

# Filter by provider
llm-models models-dev --provider openai

# Search models
llm-models models-dev --search "gpt-4"

# Show count
llm-models models-dev --count
```

### Options

| Option | Description |
|--------|-------------|
| `-p, --provider <id>` | Filter by provider prefix/ID |
| `-s, --search <term>` | Search models by name or ID |
| `-c, --count` | Show count only |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

## Library Usage

```typescript
import { fetchOpenRouterModels, fetchModelsDevModels } from "llm-models";

// Fetch from OpenRouter
const openrouter = await fetchOpenRouterModels();
console.log(openrouter.data.length, "models");

// Fetch from models.dev
const modelsDev = await fetchModelsDevModels();
console.log(Object.keys(modelsDev).length, "providers");
```

### Zod Schemas

All schemas are exported for custom validation:

```typescript
import { OpenRouterResponseSchema, ModelsDevResponseSchema } from "llm-models";

const result = OpenRouterResponseSchema.safeParse(myData);
if (!result.success) {
  console.error(result.error.issues);
}
```

### Types

All types are inferred from Zod schemas:

```typescript
import type { OpenRouterModel, ModelsDevModel, ModelsDevProvider } from "llm-models";
```

## Data Sources

- **OpenRouter**: https://openrouter.ai/api/v1/models
- **models.dev**: https://models.dev/api.json

## License

MIT
