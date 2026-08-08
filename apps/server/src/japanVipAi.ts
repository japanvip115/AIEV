import { generateText } from "./aiText.js";
import { generateCodexText } from "./codexText.js";
import { HttpError } from "./util.js";

export type JapanVipAiProvider = "codex" | "claude";

export function parseJapanVipAiProvider(value: unknown, fallback: JapanVipAiProvider = "codex"): JapanVipAiProvider {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "codex" || value === "claude") return value;
  throw new HttpError(400, "INVALID_AI_PROVIDER", "Nhà cung cấp AI phải là ChatGPT hoặc Claude");
}

export function generateJapanVipText(
  provider: JapanVipAiProvider,
  input: { prompt: string; usageTag: string; projectId?: string | null; timeoutMs?: number },
) {
  return provider === "claude" ? generateText(input) : generateCodexText(input);
}
