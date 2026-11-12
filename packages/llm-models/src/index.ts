// Node entry point: the library (same API as the browser entry), backed by the
// disk cache and the config files. It never starts the CLI on import: a program
// that bundles llm-models is its own entry point, so an "am I the entry?" check
// would run the CLI inside it. The CLI starts from bin/llm-models.js (npm) or
// src/bin.ts (dev, compiled binaries).

import "./cache";
import "./config";

export { runCommand } from "./cli";
export * from "./lib";
