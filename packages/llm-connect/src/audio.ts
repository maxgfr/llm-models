// Audio as the models in the page hear it: mono samples at 16 kHz.

/** Sample rate the speech models in the page listen at. */
export const SPEECH_SAMPLE_RATE = 16_000;

/**
 * The language a model in the page listens for when the app does not say: the browser's (also known in a
 * worker), as an ISO 639-1 code; English without one. Whisper in transformers.js does not detect the
 * language, and decodes in English when none is given, which translates any other speech.
 */
export function spokenLanguage(): string {
  const nav = (globalThis as { navigator?: { language?: string } }).navigator;
  const code = (nav?.language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(code) ? code : "en";
}

type OfflineCtx = new (
  channels: number,
  length: number,
  sampleRate: number,
) => {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  destination: AudioNode;
  startRendering(): Promise<AudioBuffer>;
};

/**
 * Any audio or video file the browser can decode, as mono samples at 16 kHz. Runs on the
 * page (OfflineAudioContext); transfer the result to the worker that runs the model.
 */
export async function decodeAudio(
  input: Blob | ArrayBuffer,
  sampleRate = SPEECH_SAMPLE_RATE,
): Promise<Float32Array> {
  const Ctx = (globalThis as { OfflineAudioContext?: OfflineCtx }).OfflineAudioContext;
  if (!Ctx) throw new Error("This browser cannot decode audio here (no OfflineAudioContext).");
  const data = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const decoded = await new Ctx(1, 1, sampleRate).decodeAudioData(data);
  const length = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const ctx = new Ctx(1, length, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}
