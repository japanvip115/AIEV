import { extractJson } from "./aiText.js";
import { askHermesCritic } from "./hermesCritic.js";
import { generateOllamaCloudText, OLLAMA_CLOUD_MODEL } from "./ollamaCloudText.js";
import { HttpError } from "./util.js";

export interface JapanVipCriticEvaluator {
  provider: "ollama-cloud" | "hermes";
  model: string;
  fallback: boolean;
}

export async function runJapanVipCritic<T extends Record<string, unknown>>(input: {
  prompt: string;
  usageTag: string;
  isValid: (parsed: T) => boolean;
}): Promise<{ parsed: T; evaluator: JapanVipCriticEvaluator }> {
  let cloudError = "";
  try {
    const response = await generateOllamaCloudText({
      prompt: input.prompt,
      usageTag: input.usageTag,
      timeoutMs: 8 * 60_000,
      jsonMode: true,
    });
    const parsed = extractJson<T>(response.text);
    if (!parsed || !input.isValid(parsed)) throw new Error("GPT-OSS 120B không trả về JSON chấm điểm hợp lệ");
    return { parsed, evaluator: { provider: "ollama-cloud", model: OLLAMA_CLOUD_MODEL, fallback: false } };
  } catch (error) {
    cloudError = error instanceof Error ? error.message : String(error);
  }

  try {
    const text = await askHermesCritic(input.prompt);
    const parsed = extractJson<T>(text);
    if (!parsed || !input.isValid(parsed)) throw new Error("Hermes không trả về JSON chấm điểm hợp lệ");
    return {
      parsed,
      evaluator: { provider: "hermes", model: process.env.HERMES_CRITIC_MODEL || "tencent/hy3:free", fallback: true },
    };
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, "JAPANVIP_CRITIC_FAILED", `Ollama Cloud thất bại (${cloudError}); Hermes dự phòng cũng thất bại (${fallbackError})`);
  }
}
