#!/usr/bin/env node

// Node entry point: the library (same API as the browser entry), backed by the
// disk cache and the config files, plus the CLI when run as a program.

import "./cache";
import "./config";

export * from "./lib";

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCommand } from "./cli";

/**
 * True only when this file is the process entry point. Under Node the check
 * goes through realpath so the npm bin symlink still counts, and importing the
 * package as a library never starts the CLI.
 */
function isEntryPoint(): boolean {
  if (typeof Bun !== "undefined") return Bun.main === import.meta.path;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  runCommand();
}
