import { describeError, maskedErrorStatus, scrubSecret } from "./errors.js";
import { loadModel } from "./model.js";
import { anthropicBaseUrl, isAnthropicHost } from "./provider-kind.js";
import { endpointProblem, type LlmSettings } from "./settings.js";

/**
 * Why a connection failed: the key was refused, the browser blocked the call,
 * another status, no answer in time, incomplete settings, or a custom endpoint
 * in plain http to another machine (not called, so the key never leaves in clear).
 *
 * `cors` is a request that failed without a readable answer: offline, DNS, a
 * CORS refusal, or a key refused by a server that answers errors without CORS
 * headers. A web page cannot tell these apart: show it as "key refused or network".
 */
export type ConnectionFailureReason = "auth" | "cors" | "http" | "timeout" | "config" | "insecure";

export type ConnectionResult =
  | {
      ok: true;
      /** Models the server lists (`models` and `auto` modes, when it answers with a list). */
      modelCount?: number;
      /** Their ids. */
      models?: string[];
    }
  | {
      ok: false;
      reason: ConnectionFailureReason;
      /** HTTP status for `auth` and `http`. */
      status?: number;
      message?: string;
    };

export interface TestConnectionOptions {
  /**
   * `models` (default): `GET {base}/models` with the provider's auth headers. Free, but some
   * providers refuse it from a browser while generation works.
   * `generate`: a one-line generation through the AI SDK, as the app will call it. It spends
   * a few tokens of the user's quota, so it only runs when asked for.
   * `auto`: `models` first; the generation only when the server has no model list to give
   * (404, 405, 501, the request blocked by the browser, or no API URL). Choosing it opts in
   * to that cost.
   */
  mode?: "models" | "generate" | "auto";
  signal?: AbortSignal;
  /** Milliseconds; defaults to 5 s for a custom endpoint and 10 s for a provider when listing models, none for a generation. */
  timeoutMs?: number;
  /** The fetch every request of the test goes through, the listing and the generation. */
  fetch?: typeof fetch;
}

export interface ListModelsOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const ENDPOINT_TIMEOUT_MS = 5000;
const PROVIDER_TIMEOUT_MS = 10000;

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Auth headers of a provider's own API: Anthropic and Google do not use bearer tokens, and
 * Anthropic's direct-browser opt-in goes to Anthropic's own host only.
 */
function authHeaders(npm: string | undefined, key: string, url: string): Record<string, string> {
  const apiKey = key.trim();
  if (!apiKey) return {};
  if (npm === "@ai-sdk/anthropic")
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(isAnthropicHost(url) && { "anthropic-dangerous-direct-browser-access": "true" }),
    };
  if (npm === "@ai-sdk/google") return { "x-goog-api-key": apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

function isAbort(error: unknown, name: "AbortError" | "TimeoutError"): boolean {
  return error instanceof Error && error.name === name;
}

/** Model ids from an OpenAI-style `{data: [{id}]}` or a Gemini `{models: [{name: "models/<id>"}]}` list. */
function modelIds(data: unknown): string[] {
  const body = data as { data?: unknown; models?: unknown } | null;
  if (Array.isArray(body?.data))
    return body.data
      .map((entry) => (entry as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === "string");
  if (Array.isArray(body?.models))
    return body.models
      .map((entry) => (entry as { name?: unknown })?.name)
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.replace(/^models\//, ""));
  return [];
}

function statusFailure(status: number, message?: string): ConnectionResult {
  return {
    ok: false,
    reason: status === 401 || status === 403 ? "auth" : "http",
    status,
    ...(message ? { message } : {}),
  };
}

/** A signal aborting with the first of `signals`; AbortSignal.any where the browser has it. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined) {
  const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  if (signal && timeout) return anySignal([signal, timeout]);
  return signal ?? timeout;
}

async function getModels(
  url: string,
  headers: Record<string, string>,
  options: ListModelsOptions,
  apiKey: string,
): Promise<ConnectionResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const res = await doFetch(url, {
      headers,
      signal: timeoutSignal(options.signal, options.timeoutMs),
    });
    if (!res.ok) return statusFailure(res.status);
    // Some servers answer without a list: reachable is enough
    const data = await res.json().catch(() => null);
    // A gateway may answer an error with a 2xx status (Z.ai: {"code":500,"msg":"404 NOT_FOUND"})
    const masked = maskedErrorStatus(data);
    if (masked !== null) {
      const { message } = describeError({ statusCode: masked, data }, apiKey.trim());
      return statusFailure(masked, message || undefined);
    }
    const models = modelIds(data);
    return { ok: true, modelCount: models.length, models };
  } catch (error) {
    // The caller's own abort is not a connection verdict
    if (options.signal?.aborted) throw error;
    if (isAbort(error, "TimeoutError") || isAbort(error, "AbortError"))
      return { ok: false, reason: "timeout" };
    // fetch rejects without a status on a network error or a CORS block
    return {
      ok: false,
      reason: "cors",
      ...(error instanceof Error ? { message: scrubSecret(error.message, apiKey.trim()) } : {}),
    };
  }
}

/** `GET {endpoint}/models` on an OpenAI-compatible server (Ollama, LM Studio…), with its model ids. */
export function listEndpointModels(
  endpoint: string,
  apiKey = "",
  options: ListModelsOptions = {},
): Promise<ConnectionResult> {
  const url = `${trimBase(endpoint)}/models`;
  return getModels(
    url,
    authHeaders(undefined, apiKey, url),
    { timeoutMs: ENDPOINT_TIMEOUT_MS, ...options },
    apiKey,
  );
}

/** Whether an error thrown by the AI SDK looks like a blocked request rather than an answer. */
function isNetworkError(error: unknown): boolean {
  const messages: string[] = [];
  for (let e: unknown = error; e instanceof Error && messages.length < 4; e = e.cause)
    messages.push(e.message);
  return messages.some((message) =>
    /failed to fetch|fetch failed|networkerror|load failed|cannot connect to api/i.test(message),
  );
}

async function generate(
  settings: LlmSettings,
  options: TestConnectionOptions,
): Promise<ConnectionResult> {
  try {
    const [{ generateText }, model] = await Promise.all([
      import("ai"),
      loadModel(settings, options.fetch ? { fetch: options.fetch } : {}),
    ]);
    await generateText({
      model,
      prompt: "Reply with OK.",
      // OpenAI's Responses API refuses fewer than 16 output tokens
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: timeoutSignal(options.signal, options.timeoutMs),
    });
    return { ok: true };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (isAbort(error, "TimeoutError") || isAbort(error, "AbortError"))
      return { ok: false, reason: "timeout" };
    const message = scrubSecret(
      error instanceof Error ? error.message : String(error),
      settings.apiKey?.trim(),
    );
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === "number") return statusFailure(status, message);
    if (isNetworkError(error)) return { ok: false, reason: "cors", message };
    return { ok: false, reason: "config", message };
  }
}

/** Statuses that say the server has no model list, rather than refusing the key. */
const NO_LIST_STATUSES = new Set([404, 405, 501]);

/** Whether a failed listing leaves the connection unknown, so `auto` may try a generation. */
function listingUnavailable(result: ConnectionResult): boolean {
  if (result.ok) return false;
  if (result.reason === "cors") return true;
  return (
    result.reason === "http" && result.status !== undefined && NO_LIST_STATUSES.has(result.status)
  );
}

/** The model list the settings point to, or null when there is no URL to list. */
async function listModels(
  settings: LlmSettings,
  options: TestConnectionOptions,
): Promise<ConnectionResult | null> {
  if (settings.customEndpoint) {
    return listEndpointModels(settings.customEndpoint, settings.apiKey, {
      signal: options.signal,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? ENDPOINT_TIMEOUT_MS,
    });
  }
  const api = trimBase(settings.providerApi ?? "");
  const base = api && settings.providerNpm === "@ai-sdk/anthropic" ? anthropicBaseUrl(api) : api;
  if (!base) return null;
  const url = `${base}/models`;
  return getModels(
    url,
    authHeaders(settings.providerNpm, settings.apiKey, url),
    {
      signal: options.signal,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? PROVIDER_TIMEOUT_MS,
    },
    settings.apiKey,
  );
}

/**
 * Check that the settings reach a model. Never throws on a failed connection
 * (only when `signal` aborts): the result says why it failed.
 *
 * Free by default: it lists the models and never runs a generation unless
 * `mode` is `generate`, or `auto` and the server has no model list to give.
 */
export async function testConnection(
  settings: LlmSettings,
  options: TestConnectionOptions = {},
): Promise<ConnectionResult> {
  if (settings.customEndpoint) {
    const problem = endpointProblem(settings.customEndpoint);
    if (problem === "insecure-endpoint")
      return {
        ok: false,
        reason: "insecure",
        message: "Plain http is only allowed to this machine: use https",
      };
    if (problem) return { ok: false, reason: "config", message: "Invalid endpoint URL" };
  }
  if (options.mode === "generate") return generate(settings, options);

  const listed = await listModels(settings, options);
  if (options.mode === "auto" && (!listed || listingUnavailable(listed)))
    return generate(settings, options);
  return listed ?? { ok: false, reason: "config", message: "No API URL for this provider" };
}
