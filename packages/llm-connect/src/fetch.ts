// The fetch every built-in provider is created with. It removes what would
// fail a browser's CORS preflight or identify the app, and lets the app route
// every request through its own wrapper (logging, a proxy, a network policy).

import { maskedErrorStatus } from "./errors.js";
import { isAnthropicHost, type ProviderKind } from "./provider-kind.js";

/** The fetch signature the AI SDK packages call. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const ANTHROPIC_BROWSER_HEADER = "anthropic-dangerous-direct-browser-access";

/**
 * Request headers each protocol's own API defines, besides `content-type` and `accept`. With
 * `strictHeaders` nothing else leaves: no custom header, no attribution header.
 */
const ALLOWED_HEADERS: Readonly<Record<ProviderKind, readonly string[]>> = {
  anthropic: ["x-api-key", "anthropic-version", "anthropic-beta", ANTHROPIC_BROWSER_HEADER],
  openai: ["authorization"],
  google: ["x-goog-api-key"],
  mistral: ["authorization"],
  "openai-compatible": ["authorization"],
};

/** The beta the SDK adds when it replays a `fallback` block, refused next to `fallbacks: "default"`. */
const FALLBACK_LIST_BETA = "server-side-fallback-2026-06-01";

export interface GuardedFetchOptions {
  /** The fetch to call in the end; `globalThis.fetch` (looked up on each call) by default. */
  fetch?: FetchLike;
  /**
   * Send only the headers the protocol's API defines (plus `content-type` and `accept`): custom
   * `headers` from the settings are dropped. Default false.
   */
  strictHeaders?: boolean;
}

function urlOf(input: string | URL | Request): string {
  return typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
}

/** Keeps a single fallback beta next to `fallbacks: "default"` (Anthropic refuses both). */
function anthropicBetas(body: unknown, headers: Record<string, string>): void {
  const beta = headers["anthropic-beta"];
  if (beta === undefined || typeof body !== "string" || !body.includes('"fallbacks"')) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  if ((parsed as { fallbacks?: unknown } | null)?.fallbacks !== "default") return;
  const kept = beta.split(",").filter((b) => b.trim() !== FALLBACK_LIST_BETA);
  if (kept.length > 0) headers["anthropic-beta"] = kept.join(",");
  else delete headers["anthropic-beta"];
}

/**
 * The response with the HTTP status its body stands for, when a server answered an error with a
 * 2xx status and a JSON body (see `maskedErrorStatus`), so that the SDK reports the provider's
 * message rather than a parse error or a stream that ends without a finish.
 */
async function unmaskError(res: Response): Promise<Response> {
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return res;
  let text: string;
  let status: number | null;
  try {
    text = await res.clone().text();
    status = maskedErrorStatus(JSON.parse(text));
  } catch {
    return res;
  }
  if (status === null) return res;
  return new Response(text, { status, headers: res.headers });
}

/**
 * A fetch for one protocol. It always removes the `user-agent` header the AI SDK adds (no
 * provider's CORS preflight allows it, and Firefox sends it), and sends Anthropic's
 * direct-browser header to Anthropic's own host only. With `strictHeaders`, every header the
 * protocol does not define is dropped too. An error a gateway sends with a 2xx status and a JSON
 * body gets back the HTTP status it stands for.
 */
export function guardedFetch(kind: string, options: GuardedFetchOptions = {}): FetchLike {
  const own = ALLOWED_HEADERS[kind as ProviderKind];
  const allowed =
    options.strictHeaders && own ? new Set(["content-type", "accept", ...own]) : undefined;
  return (input, init) => {
    const url = urlOf(input);
    const source =
      init?.headers ??
      (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    const kept: Record<string, string> = {};
    new Headers(source).forEach((value, name) => {
      if (name === "user-agent") return;
      if (allowed && !allowed.has(name)) return;
      if (name === ANTHROPIC_BROWSER_HEADER && !isAnthropicHost(url)) return;
      kept[name] = value;
    });
    if (kind === "anthropic") anthropicBetas(init?.body, kept);
    const base = options.fetch ?? globalThis.fetch;
    return base(input instanceof URL || typeof input === "string" ? url : input, {
      ...init,
      headers: kept,
    }).then(unmaskError);
  };
}
