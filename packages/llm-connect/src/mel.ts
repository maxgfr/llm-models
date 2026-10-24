// NeMo's log-mel front end in plain TypeScript, as the FastConformer models
// (Parakeet, Canary) expect it: pre-emphasis 0.97, a 512-point STFT every 10 ms
// over a 25 ms symmetric Hann window, 128 Slaney mel bands, log with a 2^-24
// guard, then each band normalized over the audio. The same computation as
// onnx-asr's `nemo128` graph, which onnxruntime-web's WebGPU build cannot run
// (it casts through doubles).

const N_FFT = 512;
const WIN_LENGTH = 400;
const HOP = 160;
const PREEMPH = 0.97;
const LOG_GUARD = 2 ** -24;
const BINS = N_FFT / 2 + 1;

/** Slaney-style mel filters, `bins × mels`, as torchaudio's `melscale_fbanks(norm="slaney")`. */
export function melFilters(mels: number, sampleRate: number): Float32Array {
  const toMel = (f: number) =>
    f < 1000 ? (3 * f) / 200 : 15 + (27 * Math.log(f / 1000 + 1.1920929e-7)) / Math.log(6.4);
  const toHz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * 6.4 ** ((m - 15) / 27));
  const top = toMel(sampleRate / 2);
  const points = Array.from({ length: mels + 2 }, (_, i) => toHz((top * i) / (mels + 1)));
  const out = new Float32Array(BINS * mels);
  for (let b = 0; b < BINS; b++) {
    const f = ((sampleRate / 2) * b) / (BINS - 1);
    for (let m = 0; m < mels; m++) {
      const lo = points[m] as number;
      const mid = points[m + 1] as number;
      const hi = points[m + 2] as number;
      const up = (f - lo) / (mid - lo);
      const down = (hi - f) / (hi - mid);
      out[b * mels + m] = Math.max(0, Math.min(up, down)) * (2 / (hi - lo));
    }
  }
  return out;
}

/** In-place radix-2 FFT of `re + i·im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = (re[b] as number) * cr - (im[b] as number) * ci;
        const ti = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

const filterCache = new Map<string, Float32Array>();

/**
 * Normalized log-mel features of mono samples: `mels × frames`, band after band (the layout of
 * a `[1, mels, frames]` tensor), and the number of frames that hold audio.
 */
export function nemoFeatures(
  samples: Float32Array,
  sampleRate = 16_000,
  mels = 128,
): { data: Float32Array; frames: number; length: number } {
  const key = `${mels}:${sampleRate}`;
  let filters = filterCache.get(key);
  if (!filters) {
    filters = melFilters(mels, sampleRate);
    filterCache.set(key, filters);
  }
  const n = samples.length;
  // NeMo counts every frame the centred STFT gives as audio.
  const frames = Math.floor(n / HOP) + 1;
  const length = frames;
  // Pre-emphasis, centred by N_FFT / 2 zeros on each side.
  const padded = new Float32Array(n + N_FFT);
  for (let i = 0; i < n; i++)
    padded[i + N_FFT / 2] =
      (samples[i] as number) - (i > 0 ? PREEMPH * (samples[i - 1] as number) : 0);
  const window = new Float64Array(N_FFT);
  const offset = (N_FFT - WIN_LENGTH) / 2;
  for (let i = 0; i < WIN_LENGTH; i++)
    window[offset + i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN_LENGTH - 1));

  const data = new Float32Array(mels * frames);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const power = new Float64Array(BINS);
  for (let t = 0; t < frames; t++) {
    const start = t * HOP;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = (padded[start + i] as number) * (window[i] as number);
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BINS; b++) power[b] = (re[b] as number) ** 2 + (im[b] as number) ** 2;
    for (let m = 0; m < mels; m++) {
      let sum = 0;
      for (let b = 0; b < BINS; b++)
        sum += (power[b] as number) * (filters[b * mels + m] as number);
      data[m * frames + t] = Math.log(sum + LOG_GUARD);
    }
  }
  // Each band to zero mean and unit variance over the frames that hold audio; the rest is zero.
  for (let m = 0; m < mels; m++) {
    const row = data.subarray(m * frames, (m + 1) * frames);
    let mean = 0;
    for (let t = 0; t < length; t++) mean += row[t] as number;
    mean /= Math.max(1, length);
    let variance = 0;
    for (let t = 0; t < length; t++) variance += ((row[t] as number) - mean) ** 2;
    variance /= Math.max(1, length - 1);
    const scale = 1 / (Math.sqrt(variance) + 1e-5);
    for (let t = 0; t < frames; t++) row[t] = t < length ? ((row[t] as number) - mean) * scale : 0;
  }
  return { data, frames, length };
}
