// The one shape every transcription takes, whatever produced it (a provider's
// transcription model or Whisper in the page): the text, its segments (about a
// sentence each) and its words, every piece timed in seconds. Providers answer
// with words, with segments or with neither; the missing level is derived here.

/** A timed piece of a transcript, in seconds from the start of the audio. */
export interface TranscriptPiece {
  text: string;
  start: number;
  end: number;
}

/**
 * How the word timings were obtained: `exact` from the model, `estimated` by spreading each
 * segment's time over its words in proportion to their length, `none` when there was no timing
 * at all (the whole text is then one segment over the known duration, or from 0 to 0).
 */
export type WordTimings = "exact" | "estimated" | "none";

export interface Transcript {
  text: string;
  /** ISO 639-1 code of the spoken language, when the model reported it. */
  language?: string;
  /** Length of the audio in seconds, when known. */
  duration?: number;
  segments: TranscriptPiece[];
  words: TranscriptPiece[];
  wordTimings: WordTimings;
}

/** A segment ends after one of these, or before a pause longer than {@link SEGMENT_GAP}. */
const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;
const SEGMENT_GAP = 1;
const SEGMENT_MAX_SECONDS = 12;
const SEGMENT_MAX_WORDS = 24;

const tokens = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/** Words joined back into text, without a space before closing punctuation. */
export function joinWords(words: readonly string[]): string {
  return words
    .join(" ")
    .replace(/\s+([,.;:!?…)\]}%»”’])/g, "$1")
    .replace(/([([{«“‘])\s+/g, "$1")
    .trim();
}

function piece(text: string, start: number, end: number): TranscriptPiece {
  const s = Number.isFinite(start) ? Math.max(0, start) : 0;
  const e = Number.isFinite(end) ? Math.max(s, end) : s;
  return { text, start: s, end: e };
}

/** Words grouped into segments: at the end of a sentence, before a pause, or when one grows long. */
export function segmentsFromWords(words: readonly TranscriptPiece[]): TranscriptPiece[] {
  const segments: TranscriptPiece[] = [];
  let current: TranscriptPiece[] = [];
  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (first && last)
      segments.push(piece(joinWords(current.map((w) => w.text)), first.start, last.end));
    current = [];
  };
  for (const [i, word] of words.entries()) {
    current.push(word);
    const next = words[i + 1];
    const first = current[0] as TranscriptPiece;
    if (
      !next ||
      SENTENCE_END.test(word.text) ||
      next.start - word.end > SEGMENT_GAP ||
      word.end - first.start >= SEGMENT_MAX_SECONDS ||
      current.length >= SEGMENT_MAX_WORDS
    )
      flush();
  }
  return segments;
}

/** Each segment's time spread over its words, in proportion to their length. */
export function wordsFromSegments(segments: readonly TranscriptPiece[]): TranscriptPiece[] {
  const words: TranscriptPiece[] = [];
  for (const segment of segments) {
    const parts = tokens(segment.text);
    const weight = parts.reduce((sum, w) => sum + w.length + 1, 0);
    const span = segment.end - segment.start;
    let t = segment.start;
    for (const w of parts) {
      const d = weight ? (span * (w.length + 1)) / weight : 0;
      words.push(piece(w, t, t + d));
      t += d;
    }
  }
  return words;
}

/** Whether timed pieces are words rather than segments: almost all hold a single token. */
export function looksLikeWords(pieces: readonly TranscriptPiece[]): boolean {
  if (!pieces.length) return false;
  const single = pieces.filter((p) => tokens(p.text).length <= 1).length;
  return single / pieces.length >= 0.8;
}

export interface TranscriptInput {
  text?: string;
  language?: string;
  duration?: number;
  /** Timed pieces as the model returned them: words or segments, see {@link looksLikeWords}. */
  pieces: readonly TranscriptPiece[];
}

/** A transcript with both levels filled, whatever the model returned. */
export function toTranscript(input: TranscriptInput): Transcript {
  const pieces = input.pieces
    .map((p) => piece(p.text.trim(), p.start, p.end))
    .filter((p) => p.text);
  const meta = {
    ...(input.language ? { language: input.language } : {}),
    ...(input.duration !== undefined && Number.isFinite(input.duration)
      ? { duration: input.duration }
      : {}),
  };
  if (pieces.length && looksLikeWords(pieces)) {
    const words = pieces.flatMap((p) => {
      const parts = tokens(p.text);
      return parts.length === 1 ? [p] : wordsFromSegments([p]);
    });
    return {
      text: input.text?.trim() || joinWords(words.map((w) => w.text)),
      ...meta,
      segments: segmentsFromWords(words),
      words,
      wordTimings: "exact",
    };
  }
  if (pieces.length) {
    return {
      text: input.text?.trim() || joinWords(pieces.map((p) => p.text)),
      ...meta,
      segments: pieces,
      words: wordsFromSegments(pieces),
      wordTimings: "estimated",
    };
  }
  const text = input.text?.trim() ?? "";
  if (!text) return { text, ...meta, segments: [], words: [], wordTimings: "none" };
  const whole = piece(text, 0, meta.duration ?? 0);
  return {
    text,
    ...meta,
    segments: [whole],
    words: wordsFromSegments([whole]),
    wordTimings: meta.duration ? "estimated" : "none",
  };
}

/** Subtitles in WebVTT, one cue per segment. */
export function toWebVtt(transcript: Pick<Transcript, "segments">): string {
  const stamp = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor(ms / 60_000) % 60;
    const sec = Math.floor(ms / 1000) % 60;
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`;
  };
  const cues = transcript.segments.map((s) => `${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}`);
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
