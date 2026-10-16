import { register as registerAnthropic } from "./anthropic.js";
import { register as registerGoogle } from "./google.js";
import { register as registerMistral } from "./mistral.js";
import { register as registerOpenAI } from "./openai.js";
import { register as registerOpenAICompatible } from "./openai-compatible.js";

/** Register the five built-in providers at once (and bundle every SDK). */
export function register(): void {
  registerOpenAI();
  registerAnthropic();
  registerGoogle();
  registerMistral();
  registerOpenAICompatible();
}
