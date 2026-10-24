import { describe, expect, it } from "bun:test";
import {
  joinWords,
  looksLikeWords,
  segmentsFromWords,
  toTranscript,
  toWebVtt,
  wordsFromSegments,
} from "../transcript.js";
import { fromAsrOutput } from "../whisper.js";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("joinWords", () => {
  it("leaves no space before closing punctuation or after opening", () => {
    expect(joinWords(["Hello", ",", "world", "!", "(", "yes", ")"])).toBe("Hello, world! (yes)");
  });
});

describe("segmentsFromWords", () => {
  it("cuts after a sentence and before a long pause", () => {
    const segments = segmentsFromWords([
      w("Open", 0, 0.3),
      w("settings.", 0.3, 0.8),
      w("Then", 1, 1.2),
      w("click", 1.2, 1.5),
      w("save", 3.2, 3.6),
    ]);
    expect(segments).toEqual([
      w("Open settings.", 0, 0.8),
      w("Then click", 1, 1.5),
      w("save", 3.2, 3.6),
    ]);
  });
});

describe("wordsFromSegments", () => {
  it("spreads a segment over its words by length", () => {
    const words = wordsFromSegments([w("a bbb", 0, 6)]);
    expect(words.map((x) => x.text)).toEqual(["a", "bbb"]);
    expect(words[0]?.end).toBeCloseTo(2);
    expect(words[1]?.start).toBeCloseTo(2);
    expect(words[1]?.end).toBeCloseTo(6);
  });
});

describe("toTranscript", () => {
  it("takes single-token pieces as exact words", () => {
    expect(looksLikeWords([w(" Hi", 0, 1), w(" there.", 1, 2)])).toBe(true);
    const t = toTranscript({ pieces: [w(" Hi", 0, 1), w(" there.", 1, 2)], language: "en" });
    expect(t).toEqual({
      text: "Hi there.",
      language: "en",
      segments: [w("Hi there.", 0, 2)],
      words: [w("Hi", 0, 1), w("there.", 1, 2)],
      wordTimings: "exact",
    });
  });

  it("estimates words inside segments", () => {
    const t = toTranscript({
      text: "One two. Three",
      pieces: [w("One two.", 0, 2), w("Three", 2, 3)],
    });
    expect(t.segments).toHaveLength(2);
    expect(t.words.map((x) => x.text)).toEqual(["One", "two.", "Three"]);
    expect(t.wordTimings).toBe("estimated");
  });

  it("keeps untimed text as one segment over the known duration", () => {
    const t = toTranscript({ text: "Just text", duration: 4, pieces: [] });
    expect(t.segments).toEqual([w("Just text", 0, 4)]);
    expect(t.wordTimings).toBe("estimated");
    expect(toTranscript({ text: "x", pieces: [] }).wordTimings).toBe("none");
    expect(toTranscript({ text: "", pieces: [] }).segments).toEqual([]);
  });

  it("drops empty pieces and clamps bad times", () => {
    const t = toTranscript({ pieces: [w(" ", 0, 1), w("ok", -1, Number.NaN)] });
    expect(t.words).toEqual([w("ok", 0, 0)]);
  });
});

describe("toWebVtt", () => {
  it("writes one cue per segment", () => {
    expect(toWebVtt({ segments: [w("Hello", 1.5, 62.25)] })).toBe(
      "WEBVTT\n\n00:00:01.500 --> 00:01:02.250\nHello\n",
    );
  });
});

describe("fromAsrOutput", () => {
  it("reads transformers.js word chunks, an open end lasting to the audio's end", () => {
    const t = fromAsrOutput(
      {
        text: " Hello world",
        chunks: [
          { text: " Hello", timestamp: [0, 0.4] },
          { text: " world", timestamp: [0.4, null] },
        ],
      },
      2,
    );
    expect(t.words).toEqual([w("Hello", 0, 0.4), w("world", 0.4, 2)]);
    expect(t.duration).toBe(2);
    expect(t.wordTimings).toBe("exact");
  });
});
