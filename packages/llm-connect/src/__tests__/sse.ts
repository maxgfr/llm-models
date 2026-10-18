// Recorded provider streams (fixtures/sse, copied byte for byte from Aparté's spec/sse), served by
// a fake fetch that records every request.
import type { FetchLike } from "../fetch.js";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const DIR = new URL("./fixtures/sse/", import.meta.url);

export function fixtureText(name: string): Promise<string> {
  return Bun.file(new URL(name, DIR)).text();
}

/** A fetch answering every call with `body`, and the calls it saw. */
export function serve(body: string, status = 200, contentType = "text/event-stream") {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const raw = init?.body;
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {},
    });
    return new Response(body, { status, headers: { "content-type": contentType } });
  };
  return { fetch, calls };
}

export async function serveFixture(name: string, status = 200) {
  const contentType = name.endsWith(".json") ? "application/json" : "text/event-stream";
  return serve(await fixtureText(name), status, contentType);
}
