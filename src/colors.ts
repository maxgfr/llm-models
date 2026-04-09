const isTTY = typeof process !== "undefined" && process.stdout?.isTTY === true;
const noColor =
  typeof process !== "undefined" &&
  (process.env.NO_COLOR !== undefined || process.env.TERM === "dumb");

const enabled = isTTY && !noColor;

function wrap(code: string, resetCode: string): (text: string) => string {
  if (!enabled) return (text: string) => text;
  return (text: string) => `\x1b[${code}m${text}\x1b[${resetCode}m`;
}

export const bold = wrap("1", "22");
export const dim = wrap("2", "22");
export const green = wrap("32", "39");
export const yellow = wrap("33", "39");
export const red = wrap("31", "39");
export const cyan = wrap("36", "39");
export const gray = wrap("90", "39");

export function colorizeCost(cost: number | undefined | null, formatted: string): string {
  if (cost == null || !enabled) return formatted;
  if (cost === 0) return green(formatted);
  if (cost <= 1) return green(formatted);
  if (cost <= 5) return yellow(formatted);
  if (cost <= 20) return formatted;
  return red(formatted);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes require control characters
const ANSI_REGEX = /\x1b\[\d+m/g;

export function stripAnsi(str: string): number {
  return str.replace(ANSI_REGEX, "").length;
}

export function isColorEnabled(): boolean {
  return enabled;
}
