#!/usr/bin/env bun
// Rebuilds src/data/browser-models.json, the catalog of models that run inside
// the browser on WebGPU through WebLLM (@mlc-ai/web-llm).
//
// Nothing in the catalog is typed by hand:
// - the model list comes from `prebuiltAppConfig` and `functionCallingModelIds`
//   in the published npm tarball of @mlc-ai/web-llm (the package documents
//   prebuiltAppConfig as "the only source of truth of which prebuilt model
//   libraries are compatible with the current WebLLM npm version");
// - weight sizes and the parameter-bytes metadata come from each model's
//   tensor-cache.json (ndarray-cache.json on older repos) on Hugging Face, the
//   manifest WebLLM itself downloads;
// - the compiled maximum context comes from the repo's mlc-chat-config.json.
// A value that cannot be fetched is written as null, never guessed.
//
// Usage: bun run catalog:browser [--version 0.2.86] [--out src/data/browser-models.json]
// The library never imports @mlc-ai/web-llm: this script only reads its tarball.

import { join } from "node:path";

const PACKAGE = "@mlc-ai/web-llm";
const REGISTRY = "https://registry.npmjs.org";
const ROOT = join(import.meta.dir, "..");
const FETCH_CONCURRENCY = 8;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

async function fetchWithRetry(url: string, tries = 3): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok || res.status === 401 || res.status === 404) return res;
      last = new Error(`${url}: HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await Bun.sleep(500 * (attempt + 1));
  }
  throw last;
}

// --- npm tarball ---------------------------------------------------------

interface PackageVersion {
  version: string;
  dist: { tarball: string; integrity: string };
}

async function resolvePackage(version: string): Promise<PackageVersion> {
  const res = await fetchWithRetry(`${REGISTRY}/${PACKAGE}/${version}`);
  if (!res.ok) throw new Error(`${PACKAGE}@${version}: HTTP ${res.status}`);
  return (await res.json()) as PackageVersion;
}

/** The tarball, checked against the registry's sha512 integrity. */
async function downloadTarball(pkg: PackageVersion): Promise<Uint8Array> {
  const res = await fetchWithRetry(pkg.dist.tarball);
  if (!res.ok) throw new Error(`${pkg.dist.tarball}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const [algo, expected] = pkg.dist.integrity.split("-", 2);
  if (algo !== "sha512") throw new Error(`unexpected integrity algorithm ${algo}`);
  const actual = new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
  if (actual !== expected) throw new Error(`${pkg.dist.tarball}: integrity mismatch`);
  return bytes;
}

/** One file out of a gzipped ustar archive (npm tarballs are plain ustar). */
function readTarEntry(tgz: Uint8Array, wanted: string): string {
  const tar = Bun.gunzipSync(tgz);
  const text = new TextDecoder();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = text.decode(header.subarray(0, 100)).replace(/\0.*$/s, "");
    if (!name) break;
    const prefix = text.decode(header.subarray(345, 500)).replace(/\0.*$/s, "");
    const size = Number.parseInt(text.decode(header.subarray(124, 136)).replace(/\0.*$/s, ""), 8);
    const path = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512;
    if (path === wanted) return text.decode(tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} not found in tarball`);
}

// --- prebuiltAppConfig extraction ---------------------------------------

/** The source text of the object/array literal that follows `marker`. */
function literalAfter(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`"${marker}" not found: the WebLLM bundle layout changed`);
  const from = start + marker.length;
  const open = src[from];
  const close = open === "{" ? "}" : "]";
  if (open !== "{" && open !== "[") throw new Error(`"${marker}" is not followed by a literal`);
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i);
    else if (c === "/" && src[i + 1] === "*") i = src.indexOf("*/", i) + 1;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`unbalanced literal after "${marker}"`);
}

/** A `const name = "value";` string constant of the bundle. */
function stringConst(src: string, name: string): string {
  const match = src.match(new RegExp(`const ${name} = "([^"]*)";`));
  if (!match?.[1]) throw new Error(`const ${name} not found`);
  return match[1];
}

/**
 * Evaluates a data literal from the bundle. Only data is accepted: once string
 * contents and comments are removed, no call, arrow, template or keyword other
 * than the known identifiers may remain.
 */
function evalLiteral(literal: string, scope: Record<string, unknown>): unknown {
  const code = literal
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const allowed = new Set([...Object.keys(scope), "true", "false", "null", "undefined"]);
  const identifiers =
    code
      .replace(/\b[A-Za-z_$][\w$]*\s*:/g, "") // property keys
      .replace(/\.[A-Za-z_$][\w$]*/g, "") // member access (ModelType.VLM)
      .match(/\b[A-Za-z_$][\w$]*/g) ?? [];
  const unknown = identifiers.filter((id) => !allowed.has(id));
  if (/[()`=;]/.test(code.replace(/=>/g, "=")) || unknown.length > 0) {
    throw new Error(`refusing to evaluate non-data literal (${unknown.slice(0, 5).join(", ")})`);
  }
  return new Function(...Object.keys(scope), `"use strict"; return (${literal});`)(
    ...Object.values(scope),
  );
}

interface WebLlmModelRecord {
  model: string;
  model_id: string;
  model_lib: string;
  overrides?: { context_window_size?: number };
  vram_required_MB?: number;
  low_resource_required?: boolean;
  buffer_size_required_bytes?: number;
  required_features?: string[];
  model_type?: number;
}

// --- Hugging Face metadata ----------------------------------------------

interface RepoFacts {
  weights_bytes: number | null;
  param_bytes: number | null;
  bits_per_param: number | null;
  config_context_window: number | null;
}

interface TensorCache {
  metadata?: { ParamBytes?: number; BitsPerParam?: number };
  records?: { nbytes?: number }[];
}

async function jsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetchWithRetry(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** "https://huggingface.co/mlc-ai/X" (or ".../resolve/main/") → file base URL. */
function resolveBase(model: string): string {
  const trimmed = model.replace(/\/+$/, "");
  return /\/resolve\/[^/]+$/.test(trimmed) ? `${trimmed}/` : `${trimmed}/resolve/main/`;
}

async function repoFacts(model: string): Promise<RepoFacts> {
  const base = resolveBase(model);
  const cache =
    (await jsonOrNull<TensorCache>(`${base}tensor-cache.json`)) ??
    (await jsonOrNull<TensorCache>(`${base}ndarray-cache.json`));
  const config = await jsonOrNull<{ context_window_size?: number }>(`${base}mlc-chat-config.json`);
  const shards = cache?.records ?? [];
  const weights = shards.reduce((sum, r) => sum + (r.nbytes ?? 0), 0);
  return {
    weights_bytes: shards.length > 0 && weights > 0 ? weights : null,
    param_bytes: cache?.metadata?.ParamBytes ?? null,
    bits_per_param: cache?.metadata?.BitsPerParam ?? null,
    config_context_window:
      config?.context_window_size && config.context_window_size > 0
        ? config.context_window_size
        : null,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// --- main -----------------------------------------------------------------

const MODEL_TYPES = ["llm", "embedding", "vlm"] as const;

async function main() {
  const version = arg("version", "latest");
  const outPath = join(ROOT, arg("out", "src/data/browser-models.json"));

  const pkg = await resolvePackage(version);
  console.error(`${PACKAGE}@${pkg.version}: downloading ${pkg.dist.tarball}`);
  const bundle = readTarEntry(await downloadTarball(pkg), "package/lib/index.js");

  const modelVersion = stringConst(bundle, "modelVersion");
  const scope = {
    modelLibURLPrefix: stringConst(bundle, "modelLibURLPrefix"),
    modelVersion,
    ModelType: { LLM: 0, embedding: 1, VLM: 2 },
  };
  const appConfig = evalLiteral(literalAfter(bundle, "const prebuiltAppConfig = "), scope) as {
    model_list: WebLlmModelRecord[];
  };
  const functionCalling = new Set(
    evalLiteral(literalAfter(bundle, "const functionCallingModelIds = "), scope) as string[],
  );
  const list = appConfig.model_list;
  console.error(`${list.length} prebuilt models; reading Hugging Face metadata…`);

  const repos = [...new Set(list.map((m) => m.model))];
  const facts = new Map(
    await mapLimit(
      repos,
      FETCH_CONCURRENCY,
      async (repo) => [repo, await repoFacts(repo)] as const,
    ),
  );

  const models = list.map((m) => {
    const repo = facts.get(m.model) as RepoFacts;
    const type = MODEL_TYPES[m.model_type ?? 0];
    if (!type) throw new Error(`${m.model_id}: unknown model_type ${m.model_type}`);
    if (typeof m.vram_required_MB !== "number") {
      throw new Error(`${m.model_id}: no vram_required_MB`);
    }
    return {
      model_id: m.model_id,
      model: m.model,
      model_lib: m.model_lib,
      model_type: type,
      vram_required_mb: m.vram_required_MB,
      low_resource_required: m.low_resource_required === true,
      context_window: m.overrides?.context_window_size ?? repo.config_context_window,
      config_context_window: repo.config_context_window,
      required_features: m.required_features ?? [],
      buffer_size_required_bytes: m.buffer_size_required_bytes ?? null,
      function_calling: functionCalling.has(m.model_id),
      weights_bytes: repo.weights_bytes,
      param_bytes: repo.param_bytes,
      bits_per_param: repo.bits_per_param,
    };
  });

  const missing = models.filter((m) => m.weights_bytes === null).map((m) => m.model_id);
  if (missing.length > 0) {
    console.error(`no weight manifest for ${missing.length}: ${missing.join(", ")}`);
  }

  const catalog = {
    source: {
      package: PACKAGE,
      version: pkg.version,
      model_version: modelVersion,
      tarball: pkg.dist.tarball,
      generated_at: new Date().toISOString().slice(0, 10),
    },
    models,
  };
  await Bun.write(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
  // Same layout as `bun run lint` expects, so a rebuild only diffs real changes.
  Bun.spawnSync(["bunx", "biome", "format", "--write", outPath], { cwd: ROOT });
  console.error(`wrote ${models.length} models to ${outPath}`);
}

await main();
