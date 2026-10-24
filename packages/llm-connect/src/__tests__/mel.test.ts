import { describe, expect, it } from "bun:test";
import { melFilters, nemoFeatures } from "../mel.js";

describe("melFilters", () => {
  it("lays 128 triangles over the 257 bins, each one somewhere", () => {
    const f = melFilters(128, 16_000);
    expect(f.length).toBe(257 * 128);
    for (let m = 0; m < 128; m++) {
      let sum = 0;
      for (let b = 0; b < 257; b++) sum += f[b * 128 + m] as number;
      expect(sum).toBeGreaterThan(0);
    }
  });
});

describe("nemoFeatures", () => {
  it("gives a frame every 10 ms, each band normalized over the audio", () => {
    const samples = Float32Array.from(
      { length: 16_000 },
      (_, i) => 0.3 * Math.sin(i / 5) + 0.01 * Math.sin(i * 1.7),
    );
    const f = nemoFeatures(samples);
    expect(f.frames).toBe(101);
    expect(f.length).toBe(101);
    expect(f.data.length).toBe(128 * 101);
    const row = f.data.subarray(10 * 101, 11 * 101);
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    const variance = row.reduce((a, b) => a + (b - mean) ** 2, 0) / (row.length - 1);
    expect(Math.abs(mean)).toBeLessThan(1e-4);
    expect(variance).toBeCloseTo(1, 2);
  });
});
