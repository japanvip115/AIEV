import { generateText } from "./aiText.js";
import { generateCodexText } from "./codexText.js";
import { HttpError } from "./util.js";
import { generateOllamaText } from "./ollamaText.js";
import { generateOllamaCloudText } from "./ollamaCloudText.js";

export type JapanVipAiProvider = "codex" | "claude" | "ollama" | "ollama-cloud";

export function parseJapanVipAiProvider(value: unknown, fallback: JapanVipAiProvider = "codex"): JapanVipAiProvider {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "codex" || value === "claude" || value === "ollama" || value === "ollama-cloud") return value;
  throw new HttpError(400, "INVALID_AI_PROVIDER", "Nhà cung cấp AI phải là ChatGPT, Claude, Ollama Local hoặc Ollama Cloud");
}

export function generateJapanVipText(
  provider: JapanVipAiProvider,
  input: { prompt: string; usageTag: string; projectId?: string | null; timeoutMs?: number },
) {
  if (provider === "claude") return generateText(input);
  if (provider === "ollama") return generateOllamaText(input);
  if (provider === "ollama-cloud") return generateOllamaCloudText(input);
  return generateCodexText(input);
}
