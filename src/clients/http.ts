import { version } from "../../package.json";

export const FETCH_TIMEOUT_MS = 15_000;

const USER_AGENT = `llm-models/${version}`;

/**
 * Headers for a GET. User-Agent only outside a browser: a page cannot set it
 * in Chrome, and in Firefox it is not CORS-safelisted, so it would turn a
 * simple cross-origin GET into one that needs a preflight.
 */
function requestHeaders(): Record<string, string> {
  const isNode = typeof process !== "undefined" && process.versions?.node !== undefined;
  return isNode
    ? { "User-Agent": USER_AGENT, Accept: "application/json" }
    : { Accept: "application/json" };
}

/**
 * GET a JSON document. Gives up after 15s so a stalled API cannot hang the
 * CLI (or an MCP client) forever; `label` names the API in error messages.
 */
export async function fetchJson(url: string, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`${label} API timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
  if (!response.ok) {
    throw new Error(`${label} API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
