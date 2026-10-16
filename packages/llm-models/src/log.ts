let verbose = false;

/** Turn `--verbose` diagnostics on or off. */
export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function isVerbose(): boolean {
  return verbose;
}

/** A diagnostic for `--verbose`: stderr only, so stdout stays a clean contract. */
export function debug(message: string): void {
  if (verbose) console.error(`[llm-models] ${message}`);
}

/** Human-readable age of a timestamp: "42s", "12m", "3h", "2d". */
export function formatAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
