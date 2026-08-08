import { nanoid } from "nanoid";
import { addTokenUsage } from "./db.js";
import { HttpError } from "./util.js";

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || "qwen3:14b";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string; size?: number }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export async function getOllamaStatus(): Promise<{
  running: boolean;
  model: string;
  installed: boolean;
  models: string[];
}> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { running: false, model: OLLAMA_TEXT_MODEL, installed: false, models: [] };
    const data = await response.json() as OllamaTagsResponse;
    const models = (data.models ?? []).map((item) => item.name || item.model || "").filter(Boolean);
    const wantedBase = OLLAMA_TEXT_MODEL.replace(/:latest$/, "");
    const installed = models.some((name) => name === OLLAMA_TEXT_MODEL || name.replace(/:latest$/, "") === wantedBase);
    return { running: true, model: OLLAMA_TEXT_MODEL, installed, models };
  } catch {
    return { running: false, model: OLLAMA_TEXT_MODEL, installed: false, models: [] };
  }
}

export async function generateOllamaText(input: {
  prompt: string;
  usageTag: string;
  projectId?: string | null;
  timeoutMs?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const status = await getOllamaStatus();
  if (!status.running) {
    throw new HttpError(503, "OLLAMA_NOT_RUNNING", "Ollama Local chưa chạy. Hãy mở ứng dụng Ollama hoặc chạy `ollama serve`.");
  }
  if (!status.installed) {
    throw new HttpError(503, "OLLAMA_MODEL_MISSING", `Chưa có model ${OLLAMA_TEXT_MODEL}. Hãy chạy \`ollama pull ${OLLAMA_TEXT_MODEL}\`.`);
  }
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_TEXT_MODEL,
        messages: [
          { role: "system", content: "Bạn là biên tập viên cao cấp của Japan VIP. Làm đúng định dạng được yêu cầu, không giải thích ngoài kết quả." },
          { role: "user", content: input.prompt },
        ],
        stream: false,
        think: false,
        keep_alive: "10m",
        options: { temperature: 0.35, num_ctx: 32768 },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 8 * 60_000),
    });
    const raw = await response.text();
    let data: OllamaChatResponse;
    try {
      data = JSON.parse(raw) as OllamaChatResponse;
    } catch {
      throw new Error(`Ollama trả dữ liệu không hợp lệ: ${raw.slice(0, 300)}`);
    }
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
    const text = data.message?.content?.trim() ?? "";
    if (!text) throw new Error("Ollama không trả về nội dung");
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    try {
      if (inputTokens > 0 || outputTokens > 0) {
        addTokenUsage(`${input.usageTag}_${nanoid(8)}`, input.projectId ?? null, inputTokens, outputTokens, 0, "ollama");
      }
    } catch {
      // Thống kê là phụ.
    }
    return { text, inputTokens, outputTokens, costUsd: 0 };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      500,
      "OLLAMA_AI_FAILED",
      `Gọi Ollama Local (${OLLAMA_TEXT_MODEL}) thất bại: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
