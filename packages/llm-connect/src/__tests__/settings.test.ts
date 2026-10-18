import { afterEach, describe, expect, it } from "bun:test";
import { browserLanguage, languageName, RESPONSE_LANGUAGES, toLanguageCode } from "../language.js";
import { ENDPOINT_PRESETS, endpointProblem, isConfigured, validateEndpoint } from "../settings.js";

describe("endpoints", () => {
  it("accepts https anywhere and http on this machine only", () => {
    for (const url of [
      "https://api.example.com/v1",
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://127.4.5.6/v1",
      "http://[::1]:8080/v1",
      "http://ollama.localhost/v1",
    ])
      expect(endpointProblem(url)).toBeNull();
    for (const url of [
      "http://192.168.1.10/v1",
      "http://10.0.0.2:11434/v1",
      "http://example.com/v1",
      "http://localhost.example.com/v1",
      "http://127.0.0.1.nip.io/v1",
    ])
      expect(endpointProblem(url)).toBe("insecure-endpoint");
    for (const url of ["localhost:11434", "ftp://example.com", "", "not a url"])
      expect(endpointProblem(url)).toBe("invalid-endpoint");
  });

  it("refuses credentials in the URL, which fetch would refuse too", () => {
    expect(endpointProblem("https://user:pass@api.example.com/v1")).toBe("invalid-endpoint");
    expect(endpointProblem("http://user@localhost:11434/v1")).toBe("invalid-endpoint");
  });

  it("has presets for the local servers", () => {
    expect(Object.values(ENDPOINT_PRESETS).map((p) => [p.id, p.endpoint])).toEqual([
      ["ollama", "http://localhost:11434/v1"],
      ["lmstudio", "http://localhost:1234/v1"],
      ["jan", "http://localhost:1337/v1"],
    ]);
    for (const preset of Object.values(ENDPOINT_PRESETS))
      expect(endpointProblem(preset.endpoint)).toBeNull();
  });

  it("normalizes a valid endpoint and refuses the others", () => {
    expect(validateEndpoint(" https://api.example.com/v1/ ")).toBe("https://api.example.com/v1");
    expect(validateEndpoint("http://192.168.1.10/v1")).toBeNull();
    expect(validateEndpoint("localhost:11434")).toBeNull();
  });
});

describe("isConfigured", () => {
  it("needs a key for a provider, and a model name for a custom endpoint", () => {
    expect(isConfigured({ apiKey: "sk", model: "gpt-5" })).toBe(true);
    expect(isConfigured({ apiKey: " ", model: "gpt-5" })).toBe(false);
    expect(isConfigured({ customEndpoint: "http://localhost:11434/v1" })).toBe(false);
    expect(
      isConfigured({ customEndpoint: "http://localhost:11434/v1", customModel: "llama3.2" }),
    ).toBe(true);
    expect(isConfigured({ apiKey: "sk", customEndpoint: "https://x.dev/v1" })).toBe(false);
    expect(isConfigured(null)).toBe(false);
  });
});

describe("response languages", () => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it("lists 16 languages with a unique code", () => {
    expect(RESPONSE_LANGUAGES).toHaveLength(16);
    expect(new Set(RESPONSE_LANGUAGES.map((l) => l.code)).size).toBe(16);
    expect(RESPONSE_LANGUAGES.find((l) => l.code === "fr")).toEqual({
      code: "fr",
      name: "French",
      label: "Français",
    });
  });

  it("reads codes, regional codes and the names older settings stored", () => {
    expect(toLanguageCode("French")).toBe("fr");
    expect(toLanguageCode("fr")).toBe("fr");
    expect(toLanguageCode("pt-BR")).toBe("pt");
    expect(toLanguageCode("Deutsch")).toBe("de");
    expect(toLanguageCode("Klingon")).toBe("en");
    expect(toLanguageCode(undefined)).toBe("en");
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("German")).toBe("German");
    expect(languageName("")).toBe("English");
  });

  it("starts from the browser's first known language", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "xx", languages: ["xx-YY", "es-MX", "fr"] },
      configurable: true,
    });
    expect(browserLanguage()).toBe("es");
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    expect(browserLanguage()).toBe("en");
  });
});
