import type { UnifiedModel } from "../types";

/**
 * Read a dotted path out of a model object: "context_length", "cost.input",
 * "modalities.input". Array values are joined with "," so a field always
 * renders as a single tab-safe token.
 */
export function readField(model: UnifiedModel, path: string): string | null {
  let current: unknown = model;

  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }

  if (current == null) return null;
  if (Array.isArray(current)) return current.length > 0 ? current.join(",") : null;
  if (typeof current === "object") return JSON.stringify(current);
  return String(current);
}

/** Split a --field value ("a,b" or repeated flags) into individual paths. */
export function parseFieldList(value: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Render one model as a tab-separated line. Missing fields become empty
 * columns so the column count always matches the requested field count.
 * Returns null when every requested field is missing — callers treat that as
 * "no usable data" and exit non-zero.
 */
export function formatFields(model: UnifiedModel, paths: string[]): string | null {
  const values = paths.map((path) => readField(model, path));
  if (values.every((value) => value === null)) return null;
  return values.map((value) => value ?? "").join("\t");
}
