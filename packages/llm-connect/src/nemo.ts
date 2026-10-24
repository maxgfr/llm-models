// NVIDIA's NeMo speech models in the page, through onnxruntime-web (an optional
// peer dependency, imported on first use): no key, nothing leaves the device.
//
// - Parakeet TDT 0.6B v3 (the default): 25 European languages, which it finds
//   by itself. Its transducer places every token on the audio's frames, so the
//   words are timed exactly, and it keeps the fillers ("euh", "um").
// - Canary 180M Flash: English, German, Spanish and French, a third of the
//   download. Its timestamp tokens drift in the ONNX export, so the audio is cut
//   at its pauses and each phrase's time is spread over its words.
//
// The ONNX exports are istupakov's (onnx-asr); NeMo's mel front end is computed
// here (mel.ts). Files are downloaded once and kept in Cache Storage.
// Long audio is cut at its quietest moments. Inference is heavy: run `loadNemo`
// in a worker; `decodeAudio` needs the page.

import { SPEECH_SAMPLE_RATE, spokenLanguage } from "./audio.js";
import { nemoFeatures } from "./mel.js";
import {
  joinWords,
  type Transcript,
  type TranscriptPiece,
  toTranscript,
  wordsFromSegments,
} from "./transcript.js";

export { decodeAudio, SPEECH_SAMPLE_RATE, spokenLanguage } from "./audio.js";

export type NemoModel = "parakeet" | "canary";

export interface NemoModelInfo {
  name: string;
  /** Hugging Face repository of the ONNX export. */
  repo: string;
  encoder: string;
  decoder: string;
  /** Approximate download in MB, cached by the browser after the first use. */
  size: number;
  /** ISO 639-1 codes of the languages it transcribes. */
  languages: readonly string[];
  /** Whether each word gets its own time, or the time of its phrase spread over its words. */
  wordTimings: "exact" | "estimated";
}

export const NEMO_MODELS: Readonly<Record<NemoModel, NemoModelInfo>> = {
  parakeet: {
    name: "NVIDIA Parakeet TDT 0.6B v3",
    repo: "istupakov/parakeet-tdt-0.6b-v3-onnx",
    encoder: "encoder-model.int8.onnx",
    decoder: "decoder_joint-model.int8.onnx",
    size: 670,
    languages: [
      "bg",
      "cs",
      "da",
      "de",
      "el",
      "en",
      "es",
      "et",
      "fi",
      "fr",
      "hr",
      "hu",
      "it",
      "lt",
      "lv",
      "mt",
      "nl",
      "pl",
      "pt",
      "ro",
      "ru",
      "sk",
      "sl",
      "sv",
      "uk",
    ],
    wordTimings: "exact",
  },
  canary: {
    name: "NVIDIA Canary 180M Flash",
    repo: "istupakov/canary-180m-flash-onnx",
    encoder: "encoder-model.int8.onnx",
    decoder: "decoder-model.int8.onnx",
    size: 215,
    languages: ["de", "en", "es", "fr"],
    wordTimings: "estimated",
  },
};

const VOCAB = "vocab.txt";
const CACHE_NAME = "llm-connect-models";
/** Each encoder frame covers 80 ms (10 ms mel hops, subsampled 8 times). */
const FRAME_SECONDS = 0.08;

/** Whether the model transcribes this language (ISO 639-1; a region such as `fr-CA` is ignored). */
export function nemoSupports(model: NemoModel, language: string): boolean {
  const code = language.toLowerCase().split(/[-_]/)[0] ?? "";
  return NEMO_MODELS[model].languages.includes(code);
}

// The part of onnxruntime's API used here, so that onnxruntime-web and onnxruntime-node both fit.
export interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}

interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release?(): Promise<void>;
}

export interface OrtRuntime {
  InferenceSession: {
    create(model: Uint8Array, options?: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: unknown, dims: readonly number[]) => OrtTensor;
  env?: { wasm?: { wasmPaths?: unknown } };
}

export interface NemoProgress {
  /** 0–1 over every file of the model. */
  ratio: number;
  loaded: number;
  total: number;
}

export interface NemoOptions {
  model?: NemoModel;
  /** onnxruntime-web by default, imported on first use; onnxruntime-node fits too. */
  runtime?: OrtRuntime;
  /** onnxruntime's execution providers: `["wasm"]` by default (`["cpu"]` for onnxruntime-node). */
  executionProviders?: readonly string[];
  /** Where onnxruntime-web's .wasm files are, to serve them yourself rather than from a CDN. */
  wasmPaths?: string | { mjs: string; wasm: string };
  /** Base URL of the model's files, instead of Hugging Face (encoder, decoder, vocab.txt). */
  baseUrl?: string;
  /** Where the files are kept between visits; Cache Storage when the browser has it, `null` for nowhere. */
  cache?: CacheStorage | null;
  fetch?: typeof fetch;
  onProgress?: (progress: NemoProgress) => void;
}

export interface NemoTranscribeOptions {
  /**
   * ISO 639-1 code of the spoken language. Parakeet finds it by itself; Canary needs it, and
   * listens for the browser's language without one ({@link spokenLanguage}).
   */
  language?: string;
  /** 0–1 as the audio is transcribed. */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface NemoTranscriber {
  readonly model: NemoModel;
  /** Mono samples at {@link SPEECH_SAMPLE_RATE}, as `decodeAudio` returns them. */
  transcribe(samples: Float32Array, options?: NemoTranscribeOptions): Promise<Transcript>;
  dispose(): Promise<void>;
}

// --- Cutting the audio --------------------------------------------------------

/** A stretch of audio, in seconds, with the part of it that holds sound. */
export interface AudioSpan {
  start: number;
  end: number;
  /** Where the sound starts and ends inside it (the span itself when it is all sound). */
  speechStart: number;
  speechEnd: number;
}

const LEVEL_SECONDS = 0.02;

/** Loudness (RMS) of each 20 ms of the audio. */
function levels(samples: Float32Array, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * LEVEL_SECONDS));
  const out = new Float32Array(Math.ceil(samples.length / size));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) sum += (samples[i] as number) ** 2;
    out[f] = Math.sqrt(sum / Math.max(1, end - f * size));
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

/**
 * The audio cut into spans no longer than `maxSeconds`, at its quietest moment when a cut is
 * needed, and also at every pause of at least `minPause` seconds when one is given. Spans without
 * any sound are left out.
 */
export function speechSpans(
  samples: Float32Array,
  sampleRate: number,
  options: { maxSeconds: number; minPause?: number },
): AudioSpan[] {
  const lv = levels(samples, sampleRate);
  const total = lv.length;
  if (!total) return [];
  // Quiet: near the noise floor, or far below the speech.
  const floor = percentile(lv, 0.1);
  const loud = percentile(lv, 0.95);
  const quiet = Math.max(Math.min(floor * 3, loud * 0.3), loud * 0.05, 1e-4);
  const isQuiet = (f: number) => (lv[f] as number) < quiet;

  // Cut points, in frames: the middle of every long enough pause.
  const cuts = [0];
  if (options.minPause) {
    const need = Math.max(1, Math.round(options.minPause / LEVEL_SECONDS));
    let run = 0;
    for (let f = 0; f <= total; f++) {
      if (f < total && isQuiet(f)) {
        run++;
        continue;
      }
      if (run >= need && f - run > 0 && f < total) cuts.push(f - Math.ceil(run / 2));
      run = 0;
    }
  }
  cuts.push(total);

  // Spans too long are cut again at their quietest frame in the second half.
  const max = Math.max(1, Math.floor(options.maxSeconds / LEVEL_SECONDS));
  const bounds: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    let a = cuts[i] as number;
    const b = cuts[i + 1] as number;
    while (b - a > max) {
      let best = a + Math.floor(max / 2);
      for (let f = best; f < a + max; f++) if ((lv[f] as number) < (lv[best] as number)) best = f;
      bounds.push([a, best]);
      a = best;
    }
    bounds.push([a, b]);
  }

  const seconds = (f: number) => Math.min(samples.length / sampleRate, f * LEVEL_SECONDS);
  const spans: AudioSpan[] = [];
  for (const [a, b] of bounds) {
    let s = a;
    while (s < b && isQuiet(s)) s++;
    if (s === b) continue;
    let e = b;
    while (e > s && isQuiet(e - 1)) e--;
    spans.push({
      start: seconds(a),
      end: seconds(b),
      speechStart: seconds(s),
      speechEnd: seconds(e),
    });
  }
  return spans;
}

// --- Tokens -------------------------------------------------------------------

/** `vocab.txt`: one `token id` per line, `▁` standing for a space. */
export function parseVocab(text: string): string[] {
  const vocab: string[] = [];
  for (const line of text.split("\n")) {
    const i = line.lastIndexOf(" ");
    if (i <= 0 && !line.startsWith(" ")) continue;
    const id = Number(line.slice(i + 1));
    if (Number.isInteger(id)) vocab[id] = line.slice(0, i).replaceAll("▁", " ");
  }
  return vocab;
}

/** Timed tokens as words: a token starting with a space (or a lone space before it) starts a word. */
export function tokensToWords(tokens: readonly TranscriptPiece[]): TranscriptPiece[] {
  const words: TranscriptPiece[] = [];
  let space = true;
  for (const t of tokens) {
    const text = t.text.trim();
    space ||= t.text.startsWith(" ");
    if (!text) continue;
    const last = words[words.length - 1];
    if (last && !space) {
      last.text += text;
      last.end = Math.max(last.end, t.end);
    } else words.push({ text, start: t.start, end: t.end });
    space = /\s$/.test(t.text);
  }
  return words;
}

// --- Downloads ----------------------------------------------------------------

function defaultCache(): CacheStorage | null {
  return (globalThis as { caches?: CacheStorage }).caches ?? null;
}

async function readAll(
  response: Response,
  onBytes: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length, bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onBytes(loaded, Math.max(total, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  onBytes(loaded, loaded);
  return bytes;
}

/** A file from the cache, else downloaded and kept there (when the browser lets it). */
export async function fetchModelFile(
  url: string,
  options: {
    cache?: CacheStorage | null;
    fetch?: typeof fetch;
    onBytes?: (loaded: number, total: number) => void;
  } = {},
): Promise<Uint8Array> {
  const onBytes = options.onBytes ?? (() => {});
  const storage = options.cache === undefined ? defaultCache() : options.cache;
  const cache = storage ? await storage.open(CACHE_NAME).catch(() => null) : null;
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) return readAll(hit, onBytes);
  const response = await (options.fetch ?? fetch)(url);
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status}).`);
  const bytes = await readAll(response, onBytes);
  try {
    await cache?.put(
      url,
      new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: { "content-length": String(bytes.length) },
      }),
    );
  } catch {
    // Out of room: it is downloaded again next time.
  }
  return bytes;
}

// --- Inference ----------------------------------------------------------------

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

function argmax(values: Float32Array, from = 0, to = values.length): number {
  let best = from;
  for (let i = from + 1; i < to; i++)
    if ((values[i] as number) > (values[best] as number)) best = i;
  return best;
}

interface Sessions {
  ort: OrtRuntime;
  encoder: OrtSession;
  decoder: OrtSession;
  vocab: string[];
}

/** The encoder's input: 128-band mel features of mono 16 kHz samples. */
function features(s: Sessions, samples: Float32Array) {
  const { Tensor } = s.ort;
  const f = nemoFeatures(samples, SPEECH_SAMPLE_RATE, 128);
  return {
    audio_signal: new Tensor("float32", f.data, [1, 128, f.frames]),
    length: new Tensor("int64", BigInt64Array.of(BigInt(f.length)), [1]),
  };
}

/** Parakeet: greedy TDT decoding; each token gets the frames it covers. */
async function parakeetTokens(
  s: Sessions,
  samples: Float32Array,
  signal?: AbortSignal,
): Promise<TranscriptPiece[]> {
  const { Tensor } = s.ort;
  const enc = await s.encoder.run(features(s, samples));
  const out = enc.outputs as OrtTensor;
  const [, dim = 0, frames = 0] = out.dims;
  const data = out.data as Float32Array;
  const length = Math.min(
    frames,
    Number((enc.encoded_lengths?.data as BigInt64Array | undefined)?.[0] ?? frames),
  );
  const blank = s.vocab.length - 1;
  const zeros = () => new Tensor("float32", new Float32Array(2 * 640), [2, 1, 640]);
  let state1 = zeros();
  let state2 = zeros();
  const frame = new Float32Array(dim);
  const tokens: TranscriptPiece[] = [];
  let last = blank;
  let t = 0;
  let emitted = 0;
  while (t < length) {
    checkAbort(signal);
    for (let d = 0; d < dim; d++) frame[d] = data[d * frames + t] as number;
    const r = await s.decoder.run({
      encoder_outputs: new Tensor("float32", frame, [1, dim, 1]),
      targets: new Tensor("int32", Int32Array.of(last), [1, 1]),
      target_length: new Tensor("int32", Int32Array.of(1), [1]),
      input_states_1: state1,
      input_states_2: state2,
    });
    const logits = r.outputs?.data as Float32Array;
    const token = argmax(logits, 0, blank + 1);
    const step = argmax(logits, blank + 1) - blank - 1;
    if (token !== blank) {
      state1 = r.output_states_1 as OrtTensor;
      state2 = r.output_states_2 as OrtTensor;
      last = token;
      emitted++;
      tokens.push({
        text: s.vocab[token] ?? "",
        start: t * FRAME_SECONDS,
        end: (t + Math.max(1, step)) * FRAME_SECONDS,
      });
    }
    if (step > 0) {
      t += step;
      emitted = 0;
    } else if (token === blank || emitted >= 10) {
      t++;
      emitted = 0;
    }
  }
  return tokens;
}

/** Canary: greedy decoding of the transcription task, without timestamps. */
async function canaryText(
  s: Sessions,
  samples: Float32Array,
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  const { Tensor } = s.ort;
  const enc = await s.encoder.run(features(s, samples));
  // The tokenizer joins one vocabulary per language, so " " is there several times: the prompt
  // takes the last one, as NeMo's lookup table does.
  const id = (token: string) => {
    const i = s.vocab.lastIndexOf(token);
    if (i < 0) throw new Error(`Canary has no ${token} token.`);
    return i;
  };
  const tokens = [
    " ",
    "<|startofcontext|>",
    "<|startoftranscript|>",
    "<|emo:undefined|>",
    `<|${language}|>`,
    `<|${language}|>`,
    "<|pnc|>",
    "<|noitn|>",
    "<|notimestamp|>",
    "<|nodiarize|>",
  ].map(id);
  const prompt = tokens.length;
  const end = id("<|endoftext|>");
  let mems = new Tensor("float32", new Float32Array(0), [6, 1, 0, 1024]);
  while (tokens.length < 512) {
    checkAbort(signal);
    const ids = mems.dims[2] === 0 ? tokens : tokens.slice(-1);
    const r = await s.decoder.run({
      input_ids: new Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      encoder_embeddings: enc.encoder_embeddings as OrtTensor,
      encoder_mask: enc.encoder_mask as OrtTensor,
      decoder_mems: mems,
    });
    const logits = r.logits?.data as Float32Array;
    const vocab = s.vocab.length;
    const next = argmax(logits, logits.length - vocab) - (logits.length - vocab);
    mems = r.decoder_hidden_states as OrtTensor;
    if (next === end) break;
    tokens.push(next);
  }
  return tokens
    .slice(prompt)
    .map((t) => s.vocab[t] ?? "")
    .filter((t) => !t.startsWith("<|"))
    .join("")
    .trim();
}

async function importRuntime(): Promise<OrtRuntime> {
  try {
    return (await import(/* @vite-ignore */ "onnxruntime-web")) as unknown as OrtRuntime;
  } catch {
    throw new Error("Local transcription needs onnxruntime-web: install it.");
  }
}

/** Load a NeMo model (downloaded once, then from the browser's cache) and return a transcriber. */
export async function loadNemo(options: NemoOptions = {}): Promise<NemoTranscriber> {
  const model = options.model ?? "parakeet";
  const info = NEMO_MODELS[model];
  const ort = options.runtime ?? (await importRuntime());
  if (options.wasmPaths && ort.env?.wasm) ort.env.wasm.wasmPaths = options.wasmPaths;

  const base = options.baseUrl?.replace(/\/+$/, "");
  const hub = (repo: string, file: string) =>
    base ? `${base}/${file}` : `https://huggingface.co/${repo}/resolve/main/${file}`;
  const files = [hub(info.repo, info.encoder), hub(info.repo, info.decoder), hub(info.repo, VOCAB)];
  // Progress over every file: the expected size until a download says its own.
  const expected = info.size * 1e6;
  const totals = files.map((_, i) => (i === 0 ? expected * 0.8 : i === 1 ? expected * 0.2 : 1e5));
  const loaded = files.map(() => 0);
  const report = () => {
    const total = totals.reduce((a, b) => a + b, 0);
    const done = loaded.reduce((a, b) => a + b, 0);
    options.onProgress?.({ ratio: total ? Math.min(1, done / total) : 0, loaded: done, total });
  };
  const bytes = await Promise.all(
    files.map((url, i) =>
      fetchModelFile(url, {
        ...(options.cache !== undefined ? { cache: options.cache } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        onBytes: (n, total) => {
          loaded[i] = n;
          if (total) totals[i] = total;
          report();
        },
      }),
    ),
  );
  const session = (b: Uint8Array) =>
    ort.InferenceSession.create(b, {
      executionProviders: options.executionProviders ?? ["wasm"],
      graphOptimizationLevel: "all",
    });
  const sessions: Sessions = {
    ort,
    encoder: await session(bytes[0] as Uint8Array),
    decoder: await session(bytes[1] as Uint8Array),
    vocab: parseVocab(new TextDecoder().decode(bytes[2])),
  };

  return {
    model,
    async transcribe(samples, opts = {}) {
      const rate = SPEECH_SAMPLE_RATE;
      const duration = samples.length / rate;
      const cut = (span: AudioSpan) =>
        samples.subarray(Math.floor(span.start * rate), Math.ceil(span.end * rate));
      if (model === "parakeet") {
        const spans = speechSpans(samples, rate, { maxSeconds: 30 });
        const tokens: TranscriptPiece[] = [];
        for (const [i, span] of spans.entries()) {
          for (const t of await parakeetTokens(sessions, cut(span), opts.signal))
            tokens.push({ text: t.text, start: t.start + span.start, end: t.end + span.start });
          opts.onProgress?.((i + 1) / spans.length);
        }
        const words = tokensToWords(tokens);
        return toTranscript({
          text: joinWords(words.map((w) => w.text)),
          ...(opts.language ? { language: opts.language } : {}),
          duration,
          pieces: words,
        });
      }
      const language = (opts.language || spokenLanguage()).toLowerCase().split(/[-_]/)[0] ?? "";
      if (!nemoSupports("canary", language))
        throw new Error(`Canary does not transcribe "${language}": use Parakeet or Whisper.`);
      // Phrases between pauses: their time is exact, the words' is spread inside.
      const spans = speechSpans(samples, rate, { maxSeconds: 12, minPause: 0.25 });
      const pieces: TranscriptPiece[] = [];
      for (const [i, span] of spans.entries()) {
        const text = await canaryText(sessions, cut(span), language, opts.signal);
        if (text) pieces.push({ text, start: span.speechStart, end: span.speechEnd });
        opts.onProgress?.((i + 1) / spans.length);
      }
      // Not through toTranscript: phrases of one word would pass for exactly timed words.
      return {
        text: joinWords(pieces.map((p) => p.text)),
        language,
        duration,
        segments: pieces,
        words: wordsFromSegments(pieces),
        wordTimings: pieces.length ? "estimated" : "none",
      };
    },
    async dispose() {
      await Promise.all([sessions.encoder, sessions.decoder].map((x) => x.release?.()));
    },
  };
}
