// describeError: HTTP answers by status and provider type, stream error events by type, an opaque
// failure (a CORS refusal hides a 401) as "key refused or network", and the key never echoed back.
import { describe, expect, it } from "bun:test";
import { APICallError, RetryError } from "ai";
import { describeError, maskedErrorStatus, scrubSecret } from "../errors.js";

const KEY = "test-key-not-a-real-secret";

function http(status: number, body: string) {
  return new APICallError({
    message: "call failed",
    url: "https://api.example.org/v1/chat/completions",
    requestBodyValues: {},
    statusCode: status,
    responseBody: body,
    isRetryable: status >= 500,
  });
}

describe("describeError", () => {
  it("reads OpenAI-style bodies", () => {
    expect(
      describeError(
        http(401, '{"error":{"message":"Incorrect API key","type":"invalid_request_error"}}'),
        KEY,
      ),
    ).toEqual({ code: "auth", message: "Incorrect API key", status: 401, retryable: false });
    expect(
      describeError(http(400, '{"error":{"message":"too long","code":"context_length_exceeded"}}'))
        .code,
    ).toBe("context-length");
    expect(
      describeError(http(429, '{"error":{"message":"quota","type":"insufficient_quota"}}')),
    ).toMatchObject({ code: "rate-limit", retryable: true });
    expect(describeError(http(503, ""))).toMatchObject({ code: "overloaded", retryable: true });
  });

  it("reads Anthropic-style bodies", () => {
    const cases: [number, string, string, boolean][] = [
      [429, "rate_limit_error", "rate-limit", true],
      [529, "overloaded_error", "overloaded", true],
      [500, "api_error", "server", true],
      [400, "invalid_request_error", "invalid-request", false],
      [404, "not_found_error", "not-found", false],
    ];
    for (const [status, type, code, retryable] of cases) {
      const body = JSON.stringify({ type: "error", error: { type, message: "x" } });
      expect(describeError(http(status, body))).toMatchObject({ code, retryable, status });
    }
    const tooLong =
      '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 1200000 tokens > 1000000 maximum"}}';
    expect(describeError(http(400, tooLong)).code).toBe("context-length");
  });

  it("reads Gemini-style bodies: a bad key is a 400", () => {
    const body =
      '[{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}]';
    expect(describeError(http(400, body), KEY)).toMatchObject({
      code: "auth",
      message: "API key not valid.",
    });
  });

  it("a fetch that rejects without an answer, directly or as a cause, is key refused or network", () => {
    expect(describeError(new TypeError("Failed to fetch")).code).toBe("auth-or-network");
    expect(describeError(new TypeError("Load failed"))).toMatchObject({
      code: "auth-or-network",
      retryable: true,
    });
    const wrapped = new Error("Cannot connect to API: Failed to fetch", {
      cause: new TypeError("Failed to fetch"),
    });
    expect(describeError(wrapped).code).toBe("auth-or-network");
  });

  it("a stream error event by its type, without a made-up status", () => {
    const e = describeError({ type: "overloaded_error", message: "Overloaded", statusCode: 529 });
    expect(e).toEqual({ code: "overloaded", message: "Overloaded", retryable: true });
  });

  it("reads a RetryError through its last attempt", () => {
    const last = http(429, '{"error":{"message":"slow down","type":"rate_limit_error"}}');
    const retry = new RetryError({
      message: "failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [last, last, last],
    });
    expect(describeError(retry)).toMatchObject({ code: "rate-limit", status: 429 });
  });

  it("scrubs the key and cuts long messages", () => {
    const e = describeError(http(401, `{"error":{"message":"bad key ${KEY}"}}`), KEY);
    expect(e.message).toBe("bad key ***");
    expect(describeError(new Error("x".repeat(2000))).message.length).toBeLessThanOrEqual(501);
    expect(scrubSecret("abc", "ab")).toBe("abc");
  });

  it("reads Z.ai's {code, msg} body", () => {
    expect(describeError(http(500, '{"code":500,"msg":"404 NOT_FOUND"}'))).toEqual({
      code: "server",
      message: "404 NOT_FOUND",
      status: 500,
      retryable: true,
    });
  });

  it("anything else is unknown", () => {
    expect(describeError("boom")).toEqual({ code: "unknown", message: "boom", retryable: false });
  });
});

describe("maskedErrorStatus", () => {
  it("tells an error body from a successful answer", () => {
    expect(maskedErrorStatus({ code: 500, msg: "404 NOT_FOUND" })).toBe(500);
    expect(maskedErrorStatus({ code: "429", message: "slow down" })).toBe(429);
    expect(maskedErrorStatus({ error: { code: 403, message: "denied" } })).toBe(403);
    expect(maskedErrorStatus({ type: "error", error: { type: "api_error" } })).toBe(502);
    expect(maskedErrorStatus({ success: false })).toBe(502);
    expect(maskedErrorStatus([{ error: { code: 400, message: "bad" } }])).toBe(400);
    expect(maskedErrorStatus({ type: "message", content: [] })).toBeNull();
    expect(maskedErrorStatus({ choices: [], error: null })).toBeNull();
    expect(maskedErrorStatus({ data: [{ id: "m" }] })).toBeNull();
    expect(maskedErrorStatus({ code: 0, msg: "ok" })).toBeNull();
    expect(maskedErrorStatus("text")).toBeNull();
  });
});
