// guardedFetch: what crosses a browser's CORS preflight. The SDK's user-agent never leaves,
// Anthropic's direct-browser header goes to Anthropic's own host only, and strict mode keeps only
// the headers the protocol's API defines.
import { describe, expect, it } from "bun:test";
import { type FetchLike, guardedFetch } from "../fetch.js";

function recorder() {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (input, init) => {
    seen.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response("");
  };
  return { fetch, seen };
}

const HEADERS = {
  "user-agent": "ai-sdk/7",
  "x-api-key": "k",
  "anthropic-dangerous-direct-browser-access": "true",
  "x-title": "app",
  "content-type": "application/json",
};

describe("guardedFetch", () => {
  it("always drops the user-agent, and keeps custom headers by default", async () => {
    const { fetch, seen } = recorder();
    await guardedFetch("openai-compatible", { fetch })("https://api.groq.com/openai/v1/models", {
      headers: { ...HEADERS, authorization: "Bearer k" },
    });
    expect(Object.keys(seen[0].headers).sort()).toEqual([
      "authorization",
      "content-type",
      "x-api-key",
      "x-title",
    ]);
  });

  it("keeps only the protocol's own headers when strict", async () => {
    const { fetch, seen } = recorder();
    const strict = { fetch, strictHeaders: true };
    await guardedFetch("anthropic", strict)("https://api.anthropic.com/v1/messages", {
      headers: HEADERS,
    });
    await guardedFetch("anthropic", strict)("https://proxy.example.org/v1/messages", {
      headers: HEADERS,
    });
    await guardedFetch("openai-compatible", strict)("https://api.groq.com/openai/v1/models", {
      headers: { ...HEADERS, authorization: "Bearer k" },
    });
    await guardedFetch("google", strict)(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: { ...HEADERS, "x-goog-api-key": "g" },
      },
    );
    expect(seen.map((s) => Object.keys(s.headers).sort())).toEqual([
      ["anthropic-dangerous-direct-browser-access", "content-type", "x-api-key"],
      ["content-type", "x-api-key"],
      ["authorization", "content-type"],
      ["content-type", "x-goog-api-key"],
    ]);
  });

  it("sends Anthropic's direct-browser header to Anthropic's host only, strict or not", async () => {
    const { fetch, seen } = recorder();
    await guardedFetch("anthropic", { fetch })("https://api.minimax.io/anthropic/v1/messages", {
      headers: HEADERS,
    });
    expect(seen[0].headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
  });

  it("keeps a single fallback beta next to fallbacks: default", async () => {
    const { fetch, seen } = recorder();
    const send = guardedFetch("anthropic", { fetch });
    const betas = "server-side-fallback-2026-07-01,server-side-fallback-2026-06-01";
    await send("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "anthropic-beta": betas },
      body: JSON.stringify({ fallbacks: "default" }),
    });
    await send("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "anthropic-beta": "server-side-fallback-2026-06-01" },
      body: JSON.stringify({ fallbacks: [{ model: "claude-opus-4-8" }] }),
    });
    expect(seen[0].headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(seen[1].headers["anthropic-beta"]).toBe("server-side-fallback-2026-06-01");
  });

  it("calls globalThis.fetch at request time when no fetch is given", async () => {
    const real = globalThis.fetch;
    const { fetch, seen } = recorder();
    const send = guardedFetch("openai");
    globalThis.fetch = fetch as typeof globalThis.fetch;
    try {
      await send("https://api.openai.com/v1/models", { headers: { "user-agent": "x" } });
    } finally {
      globalThis.fetch = real;
    }
    expect(seen).toEqual([{ url: "https://api.openai.com/v1/models", headers: {} }]);
  });

  it("gives an error sent with HTTP 200 the status it stands for", async () => {
    const answer = (body: string, type = "application/json") => {
      const fetch: FetchLike = async () =>
        new Response(body, { status: 200, headers: { "content-type": type } });
      return guardedFetch("anthropic", { fetch })("https://api.z.ai/api/anthropic/v1/messages");
    };
    const zai = await answer('{"code":500,"msg":"404 NOT_FOUND"}');
    expect(zai.status).toBe(500);
    expect(await zai.text()).toBe('{"code":500,"msg":"404 NOT_FOUND"}');
    expect((await answer('{"error":{"message":"bad"}}')).status).toBe(502);
    const message = await answer('{"type":"message","content":[]}');
    expect([message.status, await message.text()]).toEqual([
      200,
      '{"type":"message","content":[]}',
    ]);
    expect((await answer('{"code":500,"msg":"x"}', "text/event-stream")).status).toBe(200);
  });

  it("reads the headers of a Request", async () => {
    const { fetch, seen } = recorder();
    await guardedFetch("openai", { fetch, strictHeaders: true })(
      new Request("https://api.openai.com/v1/models", {
        headers: { authorization: "Bearer k", "x-other": "1" },
      }),
    );
    expect(seen[0].headers).toEqual({ authorization: "Bearer k" });
  });
});
