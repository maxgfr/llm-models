import { bold, colorizeCost, stripAnsi } from "./colors";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes require control characters
const ANSI_RE = /\x1b\[\d+m/g;

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCost(cost: number | undefined | null): string {
  if (cost == null) return "-";
  const formatted = `$${cost.toFixed(2)}`;
  return colorizeCost(cost, formatted);
}

export function formatCostRaw(cost: number | undefined | null): string {
  if (cost == null) return "-";
  return `$${cost.toFixed(2)}`;
}

export function formatContext(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return Number.isInteger(val) ? `${val}M` : `${val.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return Number.isInteger(val) ? `${val}K` : `${val.toFixed(1)}K`;
  }
  return String(n);
}

export function parseTokenCount(input: string): number {
  const normalized = input.trim().toUpperCase();
  const match = normalized.match(/^([\d.]+)(K|M)?$/);
  if (!match) {
    throw new Error(`Invalid token count: "${input}". Use a number or suffix K/M (e.g., 100K, 1M)`);
  }
  const value = Number.parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === "M") return value * 1_000_000;
  if (suffix === "K") return value * 1_000;
  return value;
}

export function formatCapabilities(caps: Record<string, boolean | undefined>): string {
  return Object.entries(caps)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(", ");
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] || ""))),
  );

  const pad = (s: string, w: number, right = false) => {
    const visible = stripAnsi(s);
    const diff = w - visible;
    if (diff <= 0) return s;
    return right ? " ".repeat(diff) + s : s + " ".repeat(diff);
  };

  // Detect numeric columns (right-align) — strip ANSI for detection
  const rightAlign = headers.map((_, i) => {
    if (rows.length === 0) return false;
    const raw = (rows[0][i] || "").replace(ANSI_RE, "");
    return /^[\d$.\-]+$/.test(raw);
  });

  const headerLine = headers
    .map((h, i) => pad(bold(h), widths[i] + (bold(h).length - h.length), rightAlign[i]))
    .join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  console.log(headerLine);
  console.log(separator);
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell || "", widths[i], rightAlign[i])).join("  "));
  }
}

// --- Multiple output formats ---

export type OutputFormat = "table" | "json" | "csv" | "markdown";

export function formatAsCSV(headers: string[], rows: string[][]): string {
  const csvEscape = (s: string) => {
    const clean = s.replace(ANSI_RE, ""); // strip ANSI
    if (clean.includes(",") || clean.includes('"') || clean.includes("\n")) {
      return `"${clean.replace(/"/g, '""')}"`;
    }
    return clean;
  };
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

export function formatAsMarkdown(headers: string[], rows: string[][]): string {
  const clean = (s: string) => s.replace(ANSI_RE, "");
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => clean(r[i] || "").length)),
  );

  const pad = (s: string, w: number) => clean(s).padEnd(w);
  const headerLine = `| ${headers.map((h, i) => pad(h, widths[i])).join(" | ")} |`;
  const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  const dataLines = rows.map(
    (row) => `| ${row.map((cell, i) => pad(cell || "", widths[i])).join(" | ")} |`,
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

export function outputFormatted(
  format: OutputFormat,
  headers: string[],
  rows: string[][],
  jsonData?: unknown,
): void {
  switch (format) {
    case "json":
      console.log(JSON.stringify(jsonData ?? rows, null, 2));
      break;
    case "csv":
      console.log(formatAsCSV(headers, rows));
      break;
    case "markdown":
      console.log(formatAsMarkdown(headers, rows));
      break;
    default:
      printTable(headers, rows);
      break;
  }
}
