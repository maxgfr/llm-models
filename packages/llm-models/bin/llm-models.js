#!/usr/bin/env node

// CLI entry installed by npm. The library entry (build/index.js) never starts the CLI.
import { runCommand } from "../build/index.js";

runCommand();
