import { describe, expect, it } from "bun:test";
import {
  fetchModelFile,
  loadNemo,
  NEMO_MODELS,
  nemoSupports,
  type OrtRuntime,
  type OrtTensor,
  parseVocab,
  speechSpans,
  tokensToWords,
} from "../nemo.js";
import { FakeCacheStorage } from "./fake-cache-storage.js";

const RATE = 16_000;

/** Sound (a 200 Hz tone) and silence, in seconds. */
function audio(...parts: [kind: "sound" | "quiet", seconds: number][]): Float32Array {
  const total = parts.reduce((n, [, s]) => n + Math.round(s * RATE), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const [kind, seconds] of parts) {
    const n = Math.round(seconds * RATE);
    if (kind === "sound")
      for (let i = 0; i < n; i++) out[at + i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / RATE);
    at += n;
  }
  return out;
}

describe("nemoSupports", () => {
  it("knows each model's languages, region or not", () => {
    expect(nemoSupports("parakeet", "fr-CA")).toBe(true);
    expect(nemoSupports("parakeet", "ja")).toBe(false);
    expect(nemoSupports("canary", "es")).toBe(true);
    expect(nemoSupports("canary", "it")).toBe(false);
    expect(NEMO_MODELS.parakeet.languages).toHaveLength(25);
  });
});

describe("speechSpans", () => {
  it("cuts at every long enough pause and says where the sound is", () => {
    const spans = speechSpans(
      audio(
        ["quiet", 0.5],
        ["sound", 1],
        ["quiet", 0.6],
        ["sound", 1],
        ["quiet", 0.1],
        ["sound", 1],
      ),
      RATE,
      { maxSeconds: 20, minPause: 0.3 },
    );
    expect(spans).toHaveLength(2);
    const [a, b] = spans as [(typeof spans)[0], (typeof spans)[0]];
    expect(a.start).toBe(0);
    expect(a.speechStart).toBeCloseTo(0.5, 1);
    expect(a.speechEnd).toBeCloseTo(1.5, 1);
    expect(a.end).toBeCloseTo(1.8, 1);
    expect(b.start).toBe(a.end);
    expect(b.speechEnd).toBeCloseTo(4.2, 1);
    expect(b.end).toBeCloseTo(4.2, 1);
  });

  it("keeps spans under the limit, cutting at the quietest moment", () => {
    const spans = speechSpans(audio(["sound", 20], ["quiet", 0.2], ["sound", 20]), RATE, {
      maxSeconds: 30,
    });
    expect(spans).toHaveLength(2);
    expect(spans[0]?.end).toBeGreaterThanOrEqual(20);
    expect(spans[0]?.end).toBeLessThanOrEqual(20.2);
    for (const s of spans) expect(s.end - s.start).toBeLessThanOrEqual(30);
  });

  it("leaves silence out", () => {
    expect(speechSpans(new Float32Array(RATE * 3), RATE, { maxSeconds: 30 })).toEqual([]);
    expect(speechSpans(new Float32Array(0), RATE, { maxSeconds: 30 })).toEqual([]);
  });
});

describe("parseVocab", () => {
  it("reads `token id` lines, ▁ standing for a space", () => {
    expect(parseVocab("<unk> 0\n▁the 1\n▁ 2\ns 3\n")).toEqual(["<unk>", " the", " ", "s"]);
  });
});

describe("tokensToWords", () => {
  const t = (text: string, start: number) => ({ text, start, end: start + 1 });
  it("joins the pieces of each word and keeps their time", () => {
    expect(
      tokensToWords([t(" Bon", 0), t("jour", 1), t(",", 2), t(" de", 5), t(" ", 6), t("3", 7)]),
    ).toEqual([
      { text: "Bonjour,", start: 0, end: 3 },
      { text: "de", start: 5, end: 6 },
      { text: "3", start: 7, end: 8 },
    ]);
  });
});

describe("fetchModelFile", () => {
  it("downloads once, then reads from the cache, reporting bytes", async () => {
    const cache = new FakeCacheStorage();
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response("model-bytes", { headers: { "content-length": "11" } });
    }) as unknown as typeof fetch;
    const seen: number[] = [];
    const a = await fetchModelFile("https://x/m.onnx", {
      cache: cache.asCacheStorage(),
      fetch: fake,
      onBytes: (n) => seen.push(n),
    });
    const b = await fetchModelFile("https://x/m.onnx", {
      cache: cache.asCacheStorage(),
      fetch: fake,
    });
    expect(new TextDecoder().decode(a)).toBe("model-bytes");
    expect(new TextDecoder().decode(b)).toBe("model-bytes");
    expect(calls).toBe(1);
    expect(seen.at(-1)).toBe(11);
  });

  it("still answers when the cache is full, and fails on an HTTP error", async () => {
    const cache = new FakeCacheStorage();
    cache.failPuts = true;
    const ok = (async () => new Response("x")) as unknown as typeof fetch;
    expect(
      (await fetchModelFile("https://x/a", { cache: cache.asCacheStorage(), fetch: ok })).length,
    ).toBe(1);
    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchModelFile("https://x/b", { cache: null, fetch: missing })).rejects.toThrow(
      /404/,
    );
  });
});

// A runtime whose sessions are scripted: enough to drive the decoding loops.
class Tensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: unknown,
    readonly dims: readonly number[],
  ) {}
}

type Run = (feeds: Record<string, OrtTensor>) => Record<string, OrtTensor>;

function fakeRuntime(byFile: Record<string, Run>): OrtRuntime {
  return {
    Tensor: Tensor as unknown as OrtRuntime["Tensor"],
    InferenceSession: {
      async create(model: Uint8Array) {
        const run = byFile[new TextDecoder().decode(model)];
        if (!run) throw new Error("unknown model");
        return { run: async (feeds: Record<string, OrtTensor>) => run(feeds) };
      },
    },
  };
}

/** Files named after themselves, so the fake runtime knows which session is which. */
const files = (vocab: string) =>
  (async (url: string) => {
    const name = url.split("/").pop() as string;
    return new Response(name === "vocab.txt" ? vocab : name);
  }) as unknown as typeof fetch;

const frontEnd: Run = (feeds) => {
  const n = (feeds.waveforms as OrtTensor).dims[1] as number;
  const frames = Math.floor(n / 160);
  return {
    features: new Tensor("float32", new Float32Array(128 * frames), [1, 128, frames]),
    features_lens: new Tensor("int64", BigInt64Array.of(BigInt(frames)), [1]),
  };
};

describe("loadNemo with Parakeet", () => {
  it("times each word on the frames the transducer gives its tokens", async () => {
    // vocab: <unk>, ▁hel, lo, ▁world, <blk>; durations 0..4 follow the tokens.
    const vocab = "<unk> 0\n▁hel 1\nlo 2\n▁world 3\n<blk> 4\n";
    const script: Record<number, [token: number, step: number][]> = {
      0: [
        [1, 0],
        [2, 2],
      ],
      2: [[4, 3]],
      5: [[3, 1]],
    };
    const calls = new Map<number, number>();
    const encoder: Run = (feeds) => {
      const frames = Math.ceil(
        Number(
          (feeds.length as OrtTensor).data instanceof BigInt64Array
            ? ((feeds.length as OrtTensor).data as BigInt64Array)[0]
            : 0,
        ) / 8,
      );
      return {
        outputs: new Tensor("float32", new Float32Array(1024 * frames), [1, 1024, frames]),
        encoded_lengths: new Tensor("int64", BigInt64Array.of(BigInt(frames)), [1]),
      };
    };
    let frame = 0;
    const decoder: Run = () => {
      const n = calls.get(frame) ?? 0;
      calls.set(frame, n + 1);
      const [token, step] = script[frame]?.[n] ?? [4, 1];
      const logits = new Float32Array(5 + 5);
      logits[token] = 1;
      logits[5 + step] = 1;
      if (step > 0) frame += step;
      else if (token === 4) frame += 1;
      const state = new Tensor("float32", new Float32Array(1280), [2, 1, 640]);
      return {
        outputs: new Tensor("float32", logits, [1, 1, 1, 10]),
        output_states_1: state,
        output_states_2: state,
      };
    };
    const nemo = await loadNemo({
      runtime: fakeRuntime({
        "nemo128.onnx": frontEnd,
        "encoder-model.int8.onnx": encoder,
        "decoder_joint-model.int8.onnx": decoder,
      }),
      fetch: files(vocab),
      cache: null,
    });
    const progress: number[] = [];
    const t = await nemo.transcribe(audio(["sound", 1]), { onProgress: (r) => progress.push(r) });
    expect(t.text).toBe("hello world");
    expect(t.wordTimings).toBe("exact");
    expect(t.words.map((w) => [w.text, +w.start.toFixed(2), +w.end.toFixed(2)])).toEqual([
      ["hello", 0, 0.16],
      ["world", 0.4, 0.48],
    ]);
    expect(progress).toEqual([1]);
  });
});

describe("loadNemo with Canary", () => {
  const vocab = [
    "<unk> 0",
    "<|endoftext|> 1",
    "<|startoftranscript|> 2",
    "<|pnc|> 3",
    "<|noitn|> 4",
    "<|notimestamp|> 5",
    "<|nodiarize|> 6",
    "<|startofcontext|> 7",
    "<|emo:undefined|> 8",
    "<|fr|> 9",
    "▁ 10",
    "▁bon 11",
    "jour 12",
    "▁ 13",
  ].join("\n");

  it("writes each phrase from its prompt, and spreads the phrase's time over its words", async () => {
    const prompts: number[][] = [];
    const encoder: Run = () => ({
      encoder_embeddings: new Tensor("float32", new Float32Array(1024), [1, 1, 1024]),
      encoder_mask: new Tensor("int64", BigInt64Array.of(1n), [1, 1]),
    });
    const answer = [11, 12, 1];
    let step = 0;
    const decoder: Run = (feeds) => {
      const ids = Array.from(feeds.input_ids?.data as BigInt64Array, Number);
      if ((feeds.decoder_mems as OrtTensor).dims[2] === 0) {
        prompts.push(ids);
        step = 0;
      }
      const logits = new Float32Array(ids.length * 14);
      logits[(ids.length - 1) * 14 + (answer[step++] as number)] = 1;
      return {
        logits: new Tensor("float32", logits, [1, ids.length, 14]),
        decoder_hidden_states: new Tensor("float32", new Float32Array(6 * 1024), [6, 1, 1, 1024]),
      };
    };
    const nemo = await loadNemo({
      model: "canary",
      runtime: fakeRuntime({
        "nemo128.onnx": frontEnd,
        "encoder-model.int8.onnx": encoder,
        "decoder-model.int8.onnx": decoder,
      }),
      fetch: files(vocab),
      cache: null,
    });
    const t = await nemo.transcribe(audio(["sound", 1], ["quiet", 0.5], ["sound", 1]), {
      language: "fr",
    });
    // The last of the repeated space tokens opens the prompt, the language twice.
    expect(prompts[0]).toEqual([13, 7, 2, 8, 9, 9, 3, 4, 5, 6]);
    expect(prompts).toHaveLength(2);
    expect(t.text).toBe("bonjour bonjour");
    expect(t.language).toBe("fr");
    expect(t.wordTimings).toBe("estimated");
    expect(t.segments.map((s) => [s.text, +s.start.toFixed(1), +s.end.toFixed(1)])).toEqual([
      ["bonjour", 0, 1],
      ["bonjour", 1.5, 2.5],
    ]);
    await expect(nemo.transcribe(audio(["sound", 1]), { language: "ja" })).rejects.toThrow(/ja/);
  });
});
