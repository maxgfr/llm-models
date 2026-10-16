import { describe, expect, it } from "bun:test";
import { getConfigPath, getProfile, listProfiles, loadConfig } from "../config";

describe("loadConfig", () => {
  it("returns an object", () => {
    const config = loadConfig();
    expect(typeof config).toBe("object");
    expect(config).not.toBeNull();
  });
});

describe("getProfile", () => {
  it("returns builtin chatbot profile", () => {
    const profile = getProfile("chatbot");
    expect(profile).toBeDefined();
    expect(profile?.input).toBe("10K");
    expect(profile?.output).toBe("1K");
  });

  it("returns builtin code-gen profile", () => {
    const profile = getProfile("code-gen");
    expect(profile).toBeDefined();
    expect(profile?.input).toBe("5K");
    expect(profile?.output).toBe("10K");
  });

  it("returns builtin rag profile", () => {
    const profile = getProfile("rag");
    expect(profile).toBeDefined();
    expect(profile?.input).toBe("100K");
    expect(profile?.output).toBe("5K");
  });

  it("returns builtin summarization profile", () => {
    const profile = getProfile("summarization");
    expect(profile).toBeDefined();
    expect(profile?.input).toBe("50K");
    expect(profile?.output).toBe("2K");
  });

  it("returns builtin translation profile", () => {
    const profile = getProfile("translation");
    expect(profile).toBeDefined();
    expect(profile?.input).toBe("5K");
    expect(profile?.output).toBe("5K");
  });

  it("returns undefined for unknown profile", () => {
    const profile = getProfile("nonexistent-profile");
    expect(profile).toBeUndefined();
  });
});

describe("listProfiles", () => {
  it("returns all builtin profiles", () => {
    const profiles = listProfiles();
    expect(Object.keys(profiles)).toContain("chatbot");
    expect(Object.keys(profiles)).toContain("code-gen");
    expect(Object.keys(profiles)).toContain("rag");
    expect(Object.keys(profiles)).toContain("summarization");
    expect(Object.keys(profiles)).toContain("translation");
  });

  it("each profile has input and output", () => {
    const profiles = listProfiles();
    for (const profile of Object.values(profiles)) {
      expect(typeof profile.input).toBe("string");
      expect(typeof profile.output).toBe("string");
    }
  });
});

describe("getConfigPath", () => {
  it("returns a string path", () => {
    const path = getConfigPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });
});
