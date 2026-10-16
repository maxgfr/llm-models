/** A language the model can answer in. */
export interface ResponseLanguage {
  /** ISO 639-1 code, what settings store. */
  code: string;
  /** English name, what a prompt asks for. */
  name: string;
  /** Name in the language itself, what a menu shows. */
  label: string;
}

export const RESPONSE_LANGUAGES: readonly ResponseLanguage[] = [
  { code: "en", name: "English", label: "English" },
  { code: "fr", name: "French", label: "Français" },
  { code: "es", name: "Spanish", label: "Español" },
  { code: "de", name: "German", label: "Deutsch" },
  { code: "it", name: "Italian", label: "Italiano" },
  { code: "pt", name: "Portuguese", label: "Português" },
  { code: "nl", name: "Dutch", label: "Nederlands" },
  { code: "ru", name: "Russian", label: "Русский" },
  { code: "zh", name: "Chinese", label: "中文" },
  { code: "ja", name: "Japanese", label: "日本語" },
  { code: "ko", name: "Korean", label: "한국어" },
  { code: "ar", name: "Arabic", label: "العربية" },
  { code: "hi", name: "Hindi", label: "हिन्दी" },
  { code: "tr", name: "Turkish", label: "Türkçe" },
  { code: "pl", name: "Polish", label: "Polski" },
  { code: "sv", name: "Swedish", label: "Svenska" },
];

export const DEFAULT_LANGUAGE = "en";

function find(value: string | null | undefined): ResponseLanguage | undefined {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return undefined;
  const base = wanted.split(/[-_]/)[0];
  return RESPONSE_LANGUAGES.find(
    (language) =>
      language.code === base ||
      language.name.toLowerCase() === wanted ||
      language.label.toLowerCase() === wanted,
  );
}

/**
 * The code of a language given as a code ("fr", "fr-CA") or a name ("French",
 * "Français"), as older settings stored it; English when unknown.
 */
export function toLanguageCode(value: string | null | undefined): string {
  return find(value)?.code ?? DEFAULT_LANGUAGE;
}

/** The English name of a language given as a code or a name, for a prompt; English when unknown. */
export function languageName(value: string | null | undefined): string {
  return find(value)?.name ?? "English";
}

/** The browser's language when the list has it, else English. */
export function browserLanguage(): string {
  try {
    const languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language];
    for (const language of languages) {
      const match = find(language);
      if (match) return match.code;
    }
  } catch {
    // No navigator (server rendering)
  }
  return DEFAULT_LANGUAGE;
}
