// What a failed provider call means. Every message here comes from the provider
// or the network and is untrusted text: show it as text. It is cut to a
// readable length and scrubbed of the API key in case a server echoed it back.
// No import of `ai`: AI SDK errors are recognised by their marker symbols.

export type LlmErrorCode =
  /** The key was refused (401, 403, or Gemini's 400 "API key not valid"). */
  | "auth"
  /**
   * The request failed without a readable answer: offline, DNS, a CORS refusal, or an error the
   * provider sent without CORS headers (some answer a bad key this way). A web page cannot tell
   * these apart: show it as "key refused or network".
   */
  | "auth-or-network"
  | "rate-limit"
  /** Anthropic `overloaded_error`, HTTP 529 or 503. */
  | "overloaded"
  | "context-length"
  | "invalid-request"
  | "not-found"
  | "server"
  | "unknown";

export interface LlmError {
  code: LlmErrorCode;
  /** The provider's message, untrusted and possibly empty. Never contains the API key. */
  message: string;
  /** HTTP status, when the provider answered with one. */
  status?: number;
  /** Whether the same request may succeed later (rate limit, overload, server, network). */
  retryable: boolean;
}

const MAX_MESSAGE = 500;

/** The error `type` or `code` a provider names in its body. */
const TYPE_CODES: Readonly<Record<string, LlmErrorCode>> = {
  authentication_error: "auth",
  permission_error: "auth",
  rate_limit_error: "rate-limit",
  overloaded_error: "overloaded",
  api_error: "server",
  not_found_error: "not-found",
  invalid_request_error: "invalid-request",
  request_too_large: "invalid-request",
  context_length_exceeded: "context-length",
  insufficient_quota: "rate-limit",
};

const CONTEXT_LENGTH =
  /prompt is too long|context[ _-]?length|context window|maximum context|too many (input )?tokens|input is too long|exceeds the model'?s? (maximum|context)/i;

const BAD_KEY = /api key not valid|invalid api key|incorrect api key|invalid x-api-key/i;

/** fetch rejects with one of these messages when there is no readable answer (offline, CORS, DNS). */
const NETWORK =
  /failed to fetch|fetch failed|networkerror|network error|load failed|cannot connect|network connection/i;

const RETRYABLE: ReadonlySet<LlmErrorCode> = new Set([
  "auth-or-network",
  "rate-limit",
  "overloaded",
  "server",
]);

/** `message` without `secret` (when it is at least 4 characters), cut to 500 characters. */
export function scrubSecret(message: string, secret?: string | null): string {
  let out = message;
  if (secret && secret.length >= 4) out = out.split(secret).join("***");
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}…` : out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Whether `error` carries an AI SDK error marker (`AISDKError.hasMarker`), across SDK copies. */
function hasMarker(error: unknown, name: string): boolean {
  if (!isRecord(error)) return false;
  return (error as Record<symbol, unknown>)[Symbol.for(`vercel.ai.error.${name}`)] === true;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/**
 * The provider's error object: `{error: {type, message}}`, `{type, message}`, `[{error}]`, or
 * `{code, msg}` (Z.ai).
 */
function errorObject(data: unknown): { type?: string; code?: string; message?: string } {
  const root = Array.isArray(data) ? data[0] : data;
  if (!isRecord(root)) return {};
  const inner = isRecord(root.error) ? root.error : root;
  const message =
    str(inner.message) ??
    str(inner.msg) ??
    str(root.message) ??
    str(root.msg) ??
    (typeof root.error === "string" ? root.error : undefined);
  return { type: str(inner.type) ?? str(inner.status), code: str(inner.code), message };
}

/** Keys a provider's successful answer carries (Anthropic, OpenAI, Gemini, model lists). */
const SUCCESS_KEYS = ["choices", "content", "candidates", "output", "data", "models"];

function httpStatus(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 400 && n <= 599 ? n : undefined;
}

/**
 * The HTTP status an error body sent with a 2xx status stands for, or null when the body is not
 * an error. Some gateways answer this way, e.g. Z.ai's `{"code":500,"msg":"404 NOT_FOUND"}` with
 * HTTP 200: an `error` member, `type: "error"`, `success: false`, or a 4xx/5xx `code` with a
 * message, on a body that carries nothing a successful answer does. The status is that code
 * when it is one, 502 otherwise.
 */
export function maskedErrorStatus(body: unknown): number | null {
  const root = Array.isArray(body) && body.length === 1 ? body[0] : body;
  if (!isRecord(root) || Array.isArray(root)) return null;
  if (SUCCESS_KEYS.some((key) => root[key] !== undefined)) return null;
  const inner = isRecord(root.error) ? root.error : undefined;
  const hasMessage = str(root.msg) !== undefined || str(root.message) !== undefined;
  const isError =
    inner !== undefined ||
    str(root.error) !== undefined ||
    root.type === "error" ||
    root.success === false ||
    (httpStatus(root.code) !== undefined && hasMessage);
  if (!isError) return null;
  return httpStatus(root.code) ?? httpStatus(inner?.code) ?? 502;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string" || !body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function codeForStatus(
  status: number,
  detail: { type?: string; code?: string; message: string },
): LlmErrorCode {
  const named =
    (detail.code && TYPE_CODES[detail.code]) ||
    (detail.type && TYPE_CODES[detail.type]) ||
    undefined;
  if (named === "context-length" || CONTEXT_LENGTH.test(detail.message)) {
    if (status === 400 || status === 413 || status === 422 || named === "context-length")
      return "context-length";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return named === "overloaded" ? "overloaded" : "rate-limit";
  if (status === 529 || status === 503 || named === "overloaded") return "overloaded";
  if (status === 404) return "not-found";
  if (status >= 500) return "server";
  if (status === 400 || status === 413 || status === 422) {
    // Gemini answers a bad key with 400 INVALID_ARGUMENT, "API key not valid".
    return named === "auth" || BAD_KEY.test(detail.message) ? "auth" : "invalid-request";
  }
  return named ?? "unknown";
}

function make(
  code: LlmErrorCode,
  message: string,
  apiKey: string | null | undefined,
  status?: number,
): LlmError {
  return {
    code,
    message: scrubSecret(message, apiKey),
    ...(status === undefined ? {} : { status }),
    retryable: RETRYABLE.has(code),
  };
}

/** Whether an error or one of its causes is fetch failing without an answer. */
function isNetworkFailure(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 5 && e instanceof Error; depth++) {
    if (NETWORK.test(e.message)) return true;
    e = e.cause;
  }
  return false;
}

/**
 * What any failure of a provider call means: an HTTP answer (`APICallError`) by its status and
 * the provider's error type, an error event inside a stream by its type, and a fetch that
 * rejected without an answer as `auth-or-network` (a key refused without CORS headers looks
 * exactly like being offline to a web page). A `RetryError` is read through its last attempt.
 * Pass the key so that a server echoing it back never shows it.
 */
export function describeError(error: unknown, apiKey?: string | null): LlmError {
  if (hasMarker(error, "AI_RetryError") && isRecord(error) && error.lastError !== undefined)
    return describeError(error.lastError, apiKey);
  if (isRecord(error)) {
    const apiCall = hasMarker(error, "AI_APICallError");
    const body = apiCall ? parseBody(error.responseBody) : undefined;
    const fromData = errorObject(error.data ?? body);
    const type = str(error.type) ?? fromData.type;
    const code = str(error.code) ?? fromData.code;
    const status = typeof error.statusCode === "number" ? error.statusCode : undefined;
    const message = fromData.message ?? str(error.message) ?? "";
    // Only an HTTP answer has a status of its own; a stream error's is inferred from its type.
    if (status !== undefined)
      return make(
        codeForStatus(status, { type, code, message }),
        message,
        apiKey,
        apiCall ? status : undefined,
      );
    const named = (type && TYPE_CODES[type]) || (code && TYPE_CODES[code]) || undefined;
    if (named) return make(named, message, apiKey);
  }
  if (isNetworkFailure(error))
    return make("auth-or-network", error instanceof Error ? error.message : "", apiKey);
  return make("unknown", error instanceof Error ? error.message : String(error), apiKey);
}
