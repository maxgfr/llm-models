// Whether a media provider takes a key, without generating anything (and so
// without cost): one free GET per provider, the key always in a header.

import { fetchOf, MEDIA_PROVIDER_INFO, type MediaOptions, type MediaProviderId } from "./media.js";
import { OPENROUTER_API } from "./video-openrouter.js";

/** A key check that generates nothing: one free request per provider. */
const KEY_CHECKS: Record<
  MediaProviderId,
  (key: string) => { url: string; headers: Record<string, string> }
> = {
  openrouter: (key) => ({
    url: `${OPENROUTER_API}/key`,
    headers: { authorization: `Bearer ${key}` },
  }),
  gateway: (key) => ({
    url: "https://ai-gateway.vercel.sh/v1/credits",
    headers: { authorization: `Bearer ${key}` },
  }),
  fal: (key) => ({
    url: "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fveo3",
    headers: { authorization: `Key ${key}` },
  }),
  openai: (key) => ({
    url: "https://api.openai.com/v1/models",
    headers: { authorization: `Bearer ${key}` },
  }),
  google: (key) => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: { "x-goog-api-key": key },
  }),
  xai: (key) => ({
    url: "https://api.x.ai/v1/api-key",
    headers: { authorization: `Bearer ${key}` },
  }),
  replicate: (key) => ({
    url: "https://api.replicate.com/v1/account",
    headers: { authorization: `Bearer ${key}` },
  }),
  elevenlabs: (key) => ({
    url: "https://api.elevenlabs.io/v1/user",
    headers: { "xi-api-key": key },
  }),
};

export interface MediaKeyReport {
  /** true: the key works; false: refused, unreachable, or a provider this check does not know. */
  ok: boolean;
  message: string;
}

/** Whether the provider takes the key, without generating anything (and so without cost). */
export async function testMediaKey(
  settings: { provider: string; apiKey: string },
  options: MediaOptions = {},
): Promise<MediaKeyReport> {
  const provider = settings.provider as MediaProviderId;
  if (!Object.hasOwn(KEY_CHECKS, provider))
    return { ok: false, message: `No key check for the provider "${settings.provider}".` };
  const name = MEDIA_PROVIDER_INFO[provider].name;
  const check = KEY_CHECKS[provider](settings.apiKey);
  let res: Response;
  try {
    res = await fetchOf(options)(check.url, {
      headers: check.headers,
      signal: options.abortSignal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, message: `${name} could not be reached. Check the network and try again.` };
  }
  if (res.ok) return { ok: true, message: `${name} accepts the key.` };
  if (res.status === 401 || res.status === 403 || (provider === "google" && res.status === 400))
    return { ok: false, message: `${name} refused the key.` };
  return { ok: false, message: `${name} answered HTTP ${res.status}. Try again in a moment.` };
}
