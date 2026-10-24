// Whisper in the page, through transformers.js (an optional peer dependency,
// imported on first use): no key, nothing leaves the device. WebGPU when the
// browser has it, WebAssembly otherwise. The `_timestamped` exports of
// onnx-community carry the alignment heads that word timings need.
//
// Inference is heavy: run `loadWhisper` in a worker. `decodeAudio` needs an
// OfflineAudioContext, which workers lack: call it on the page and transfer
// the samples.

import { type Transcript, type TranscriptPiece, toTranscript } from "./transcript.js";

export type WhisperPreset = "fast" | "balanced" | "accurate";

export interface WhisperPresetInfo {
  model: string;
  /** Approximate download, in MB, cached by the browser after the first use. */
  size: number;
  /** Runs at a usable speed without WebGPU. */
  wasm: boolean;
}

export const WHISPER_PRESETS: Readonly<Record<WhisperPreset, WhisperPresetInfo>> = {
  fast: { model: "onnx-community/whisper-base_timestamped", size: 80, wasm: true },
  balanced: { model: "onnx-community/whisper-small_timestamped", size: 250, wasm: true },
  accurate: { model: "onnx-community/whisper-large-v3-turbo_timestamped", size: 600, wasm: false },
};

/** Sample rate Whisper listens at. */
export const WHISPER_SAMPLE_RATE = 16_000;

export type WhisperDevice = "webgpu" | "wasm";

interface GpuAdapter {
  features: { has(name: string): boolean };
}

async function gpuAdapter(): Promise<GpuAdapter | null> {
  const gpu = (
    globalThis.navigator as { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } } | undefined
  )?.gpu;
  if (!gpu) return null;
  try {
    return await gpu.requestAdapter();
  } catch {
    return null;
  }
}

/** Whether the browser exposes WebGPU with an adapter. */
export async function hasWebGpu(): Promise<boolean> {
  return !!(await gpuAdapter());
}

/** The preset to offer by default: the accurate one on WebGPU, the fast one otherwise. */
export async function recommendedWhisperPreset(): Promise<WhisperPreset> {
  return (await hasWebGpu()) ? "accurate" : "fast";
}

export interface WhisperProgress {
  /** 0–1 over every file of the model. */
  ratio: number;
  loaded: number;
  total: number;
}

export interface WhisperOptions {
  preset?: WhisperPreset;
  /** A Hugging Face model id, instead of a preset's. */
  model?: string;
  /** Where to run; WebGPU when available by default. */
  device?: WhisperDevice;
  /** Base URL of onnxruntime-web's .wasm files, to serve them yourself rather than from a CDN. */
  wasmPaths?: string;
  onProgress?: (progress: WhisperProgress) => void;
}

export interface WhisperTranscribeOptions {
  /**
   * ISO 639-1 code of the spoken language. Whisper in the page does not detect it: without one,
   * the browser's language is used ({@link spokenLanguage}). Pass it when you know it.
   */
  language?: string;
  /** Word timings (default) or segment timings only, which is faster. */
  words?: boolean;
}

export interface Whisper {
  readonly model: string;
  readonly device: WhisperDevice;
  /** Mono samples at {@link WHISPER_SAMPLE_RATE}, as {@link decodeAudio} returns them. */
  transcribe(samples: Float32Array, options?: WhisperTranscribeOptions): Promise<Transcript>;
  dispose(): Promise<void>;
}

interface AsrChunk {
  text: string;
  timestamp: [number | null, number | null];
}

interface AsrOutput {
  text: string;
  chunks?: AsrChunk[];
}

type Asr = ((audio: Float32Array, options: Record<string, unknown>) => Promise<AsrOutput>) & {
  dispose?: () => Promise<void>;
};

interface TransformersModule {
  pipeline(task: string, model: string, options: Record<string, unknown>): Promise<Asr>;
  env: { backends: { onnx: { wasm?: { wasmPaths?: string } } } };
}

/**
 * The language Whisper listens for when the app does not say: the browser's (also known in a
 * worker), as an ISO 639-1 code; English without one. transformers.js does not detect the language,
 * and decodes in English when none is given, which translates any other speech.
 */
export function spokenLanguage(): string {
  const nav = (globalThis as { navigator?: { language?: string } }).navigator;
  const code = (nav?.language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(code) ? code : "en";
}

/** The pipeline's output as a transcript; a chunk without an end lasts until the audio's end. */
export function fromAsrOutput(output: AsrOutput, duration: number): Transcript {
  const pieces: TranscriptPiece[] = (output.chunks ?? []).map((c) => {
    const start = c.timestamp[0] ?? 0;
    return { text: c.text, start, end: c.timestamp[1] ?? Math.max(start, duration) };
  });
  return toTranscript({ text: output.text, duration, pieces });
}

/** Load Whisper (downloaded once, then from the browser's cache) and return a transcriber. */
export async function loadWhisper(options: WhisperOptions = {}): Promise<Whisper> {
  const preset = WHISPER_PRESETS[options.preset ?? "fast"];
  const model = options.model ?? preset.model;
  const device: WhisperDevice = options.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
  let transformers: TransformersModule;
  try {
    transformers = (await import(
      /* @vite-ignore */ "@huggingface/transformers"
    )) as unknown as TransformersModule;
  } catch {
    throw new Error("Local transcription needs @huggingface/transformers: install it.");
  }
  const wasm = transformers.env.backends.onnx.wasm;
  if (options.wasmPaths && wasm) wasm.wasmPaths = options.wasmPaths;
  // The encoder dominates quality, the merged decoder size: the split transformers.js suggests,
  // with a full-precision encoder on GPUs without 16-bit floats.
  const fp16 = device === "webgpu" && !!(await gpuAdapter())?.features.has("shader-f16");
  const asr = await transformers.pipeline("automatic-speech-recognition", model, {
    device,
    dtype:
      device === "webgpu"
        ? {
            encoder_model: fp16 && /large/.test(model) ? "fp16" : "fp32",
            decoder_model_merged: "q4",
          }
        : "q8",
    progress_callback: (info: { status: string; loaded?: number; total?: number }) => {
      if (info.status !== "progress_total" || !options.onProgress) return;
      const loaded = info.loaded ?? 0;
      const total = info.total ?? 0;
      options.onProgress({ ratio: total ? loaded / total : 0, loaded, total });
    },
  });
  return {
    model,
    device,
    async transcribe(samples, opts = {}) {
      const output = await asr(samples, {
        return_timestamps: opts.words === false ? true : "word",
        chunk_length_s: 30,
        stride_length_s: 5,
        task: "transcribe",
        language: opts.language || spokenLanguage(),
      });
      return fromAsrOutput(output, samples.length / WHISPER_SAMPLE_RATE);
    },
    async dispose() {
      await asr.dispose?.();
    },
  };
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
 * Any audio or video file the browser can decode, as mono samples at Whisper's rate. Runs on the
 * page (OfflineAudioContext); transfer the result to the worker that runs Whisper.
 */
export async function decodeAudio(
  input: Blob | ArrayBuffer,
  sampleRate = WHISPER_SAMPLE_RATE,
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
