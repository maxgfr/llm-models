export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCost(cost: number | undefined | null): string {
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
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || "").length)));

  const pad = (s: string, w: number, right = false) => (right ? s.padStart(w) : s.padEnd(w));

  // Detect numeric columns (right-align)
  const rightAlign = headers.map((_, i) => rows.length > 0 && /^[\d$.\-]+$/.test(rows[0][i] || ""));

  const headerLine = headers.map((h, i) => pad(h, widths[i], rightAlign[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  console.log(headerLine);
  console.log(separator);
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell || "", widths[i], rightAlign[i])).join("  "));
  }
}
