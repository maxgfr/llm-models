import type { BrowserSupport } from "../types";

/**
 * Base URLs of the providers whose models.dev entry documents no `api`, so the
 * browser probe (and any client) knows where to call them. Each one answered a
 * live CORS preflight at `<base><chat path>` on 2026-10-14; the comment cites
 * the provider's own API reference.
 */
export const DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  // https://platform.openai.com/docs/api-reference
  openai: "https://api.openai.com/v1",
  // https://docs.anthropic.com/en/api/overview
  anthropic: "https://api.anthropic.com/v1",
  // https://ai.google.dev/api
  google: "https://generativelanguage.googleapis.com/v1beta",
  // https://docs.mistral.ai/api/
  mistral: "https://api.mistral.ai/v1",
  // https://console.groq.com/docs/openai
  groq: "https://api.groq.com/openai/v1",
  // https://docs.x.ai/docs/api-reference
  xai: "https://api.x.ai/v1",
  // https://deepinfra.com/docs/openai_api
  deepinfra: "https://api.deepinfra.com/v1/openai",
  // https://inference-docs.cerebras.ai/api-reference/chat-completions
  cerebras: "https://api.cerebras.ai/v1",
  // https://docs.together.ai/docs/openai-api-compatibility
  togetherai: "https://api.together.xyz/v1",
  // https://docs.cohere.com/reference/chat
  cohere: "https://api.cohere.com/v2",
  // https://docs.perplexity.ai/api-reference/chat-completions-post
  perplexity: "https://api.perplexity.ai",
};

/**
 * Headers a provider insists on before it lets a browser read its answer.
 *
 * Anthropic: its SDK sends `anthropic-dangerous-direct-browser-access: true`
 * when built with `dangerouslyAllowBrowser`
 * (https://github.com/anthropics/anthropic-sdk-typescript). Observed on
 * 2026-10-14: POST /v1/messages from an Origin gets no
 * Access-Control-Allow-Origin without the header and `*` with it, and
 * Chromium 156, Firefox 157 and WebKit 27.2 all block the call without it.
 * The preflight cannot show this (it allows the header either way), hence the table.
 */
export const BROWSER_REQUIRED_HEADERS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    anthropic: { "anthropic-dangerous-direct-browser-access": "true" },
  };

/** The origin the probe announces when none is given. */
export const DEFAULT_PROBE_ORIGIN = "https://example.com";

const DEFAULT_TIMEOUT_MS = 10_000;

/** A provider as the probe needs it: a models.dev / `ProviderInfo` entry, or a bare id. */
export type BrowserProbeTarget = string | { id: string; api?: string | null; npm?: string | null };

export interface BrowserProbeOptions {
  /** Origin of the page that would make the call. Default: https://example.com */
  origin?: string;
  /** fetch implementation (tests, proxies). Default: globalThis.fetch */
  fetch?: typeof fetch;
  /** Per-request timeout, milliseconds. Default: 10000 */
  timeoutMs?: number;
  /** Clock for `checked_at`. */
  now?: () => Date;
}

/** The request a browser client really sends: the chat endpoint and its non-safelisted headers. */
interface WireProtocol {
  path: string;
  headers: readonly string[];
}

const OPENAI_COMPATIBLE: WireProtocol = {
  path: "/chat/completions",
  headers: ["authorization", "content-type"],
};
const ANTHROPIC: WireProtocol = {
  path: "/messages",
  headers: ["anthropic-version", "content-type", "x-api-key"],
};
const GOOGLE: WireProtocol = {
  path: "/models/gemini-2.5-flash:generateContent",
  headers: ["content-type", "x-goog-api-key"],
};
const COHERE: WireProtocol = { path: "/chat", headers: ["authorization", "content-type"] };

function normalizeTarget(target: BrowserProbeTarget): {
  id: string;
  api?: string | null;
  npm?: string | null;
} {
  return typeof target === "string" ? { id: target } : target;
}

/** Which wire protocol a provider speaks, from its AI SDK package (or its id). */
function wireProtocol(target: { id: string; npm?: string | null }): WireProtocol {
  if (target.npm === "@ai-sdk/anthropic" || target.id === "anthropic") return ANTHROPIC;
  if (target.npm === "@ai-sdk/google" || target.id === "google") return GOOGLE;
  if (target.npm === "@ai-sdk/cohere" || target.id === "cohere") return COHERE;
  return OPENAI_COMPATIBLE;
}

/** The provider's documented `api`, else the known default; null when neither exists. */
export function providerBaseUrl(target: BrowserProbeTarget): string | null {
  const { id, api } = normalizeTarget(target);
  return api || DEFAULT_BASE_URLS[id] || null;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** A comma-separated header value as lower-cased tokens. */
function headerList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function originAllowed(response: Response, origin: string): string | null {
  const allow = response.headers.get("access-control-allow-origin")?.trim();
  if (!allow) return "no Access-Control-Allow-Origin";
  if (allow !== "*" && allow !== origin) return `Access-Control-Allow-Origin is ${allow}`;
  return null;
}

/**
 * Why a browser would refuse this preflight answer; empty when it passes.
 * POST is a CORS-safelisted method, so Access-Control-Allow-Methods is not
 * checked. A `*` in Access-Control-Allow-Headers counts for every header,
 * Authorization included: the Fetch standard excludes Authorization from the
 * wildcard, but on 2026-10-14 Chromium 156, Firefox 157 and WebKit 27.2 all
 * let a page call api.x.ai (which answers `*`) with an Authorization header.
 */
function preflightProblems(response: Response, origin: string, requested: string[]): string[] {
  const problems: string[] = [];
  if (response.status < 200 || response.status > 299) problems.push(`status ${response.status}`);
  const originProblem = originAllowed(response, origin);
  if (originProblem) problems.push(originProblem);
  const allowed = new Set(headerList(response.headers.get("access-control-allow-headers")));
  const missing = requested.filter((header) => !allowed.has(header) && !allowed.has("*"));
  if (missing.length > 0) problems.push(`Access-Control-Allow-Headers lacks ${missing.join(", ")}`);
  return problems;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // already consumed or closed
  }
}

/**
 * Whether a web page on `origin` can call the provider's API directly. Sends
 * the CORS preflight a browser would send before an authenticated JSON POST to
 * the provider's chat endpoint (no API key involved) and checks the answer the
 * way a browser does: a 2xx status, Access-Control-Allow-Origin matching the
 * origin, and Access-Control-Allow-Headers covering every header the call
 * needs. When the preflight is refused, a simple GET to `<base>/models` records
 * whether the API sends CORS headers at all; the verdict stays "not callable".
 *
 * Meant for build steps, servers and CLIs: a browser does not let a page send
 * a preflight itself, nor set the Origin header.
 */
export async function probeBrowserSupport(
  provider: BrowserProbeTarget,
  options: BrowserProbeOptions = {},
): Promise<BrowserSupport> {
  const target = normalizeTarget(provider);
  const origin = options.origin ?? DEFAULT_PROBE_ORIGIN;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const required = BROWSER_REQUIRED_HEADERS[target.id];
  const checkedAt = (options.now?.() ?? new Date()).toISOString();

  const verdict = (fields: Omit<BrowserSupport, "origin" | "checked_at">): BrowserSupport => ({
    ...fields,
    ...(required ? { required_headers: { ...required } } : {}),
    origin,
    checked_at: checkedAt,
  });

  const base = providerBaseUrl(target);
  if (!base) {
    return verdict({ callable: false, evidence: "none", reason: "no known base URL" });
  }
  // models.dev writes per-account endpoints as templates: "https://${ACCOUNT_ID}.example.com/v1".
  if (base.includes("${")) {
    return verdict({
      callable: false,
      evidence: "none",
      reason: `base URL depends on the account: ${base}`,
    });
  }

  const protocol = wireProtocol(target);
  const url = joinUrl(base, protocol.path);
  const requested = [
    ...new Set([...protocol.headers, ...Object.keys(required ?? {})].map((h) => h.toLowerCase())),
  ].sort();

  let preflight: Response;
  try {
    preflight = await doFetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": requested.join(","),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return verdict({
      callable: false,
      url,
      evidence: "none",
      reason: `preflight failed: ${errorMessage(err)}`,
    });
  }
  await discardBody(preflight);

  const problems = preflightProblems(preflight, origin, requested);
  if (problems.length === 0) return verdict({ callable: true, url, evidence: "preflight" });

  const refused = `preflight refused: ${problems.join("; ")}`;
  const getUrl = joinUrl(base, "/models");
  let get: string;
  try {
    const response = await doFetch(getUrl, {
      headers: { Origin: origin },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await discardBody(response);
    get =
      originAllowed(response, origin) === null
        ? `a simple GET ${getUrl} is readable from ${origin}, so CORS is set up but not for this call`
        : `a simple GET ${getUrl} sends no CORS headers either`;
  } catch (err) {
    get = `a simple GET ${getUrl} failed: ${errorMessage(err)}`;
  }
  return verdict({ callable: false, url, evidence: "get", reason: `${refused}; ${get}` });
}

export interface ProbeManyOptions extends BrowserProbeOptions {
  /** Probes in flight at once. Default: 8 */
  concurrency?: number;
}

/** `probeBrowserSupport` over many providers, a few at a time, keyed by provider id. */
export async function probeBrowserSupportAll(
  providers: { id: string; api?: string | null; npm?: string | null }[],
  options: ProbeManyOptions = {},
): Promise<Record<string, BrowserSupport>> {
  const results: Record<string, BrowserSupport> = {};
  const queue = [...providers];
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 8) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      results[next.id] = await probeBrowserSupport(next, options);
    }
  });
  await Promise.all(workers);
  return results;
}
