import { nanoid } from "nanoid";
import { addTokenUsage } from "./db.js";
import { HttpError } from "./util.js";

const OLLAMA_CLOUD_URL = (process.env.OLLAMA_CLOUD_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_CLOUD_API_KEY || "";
export const OLLAMA_CLOUD_MODEL = process.env.OLLAMA_CLOUD_MODEL || "ollama/gpt-oss:120b";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(OLLAMA_CLOUD_API_KEY ? { authorization: `Bearer ${OLLAMA_CLOUD_API_KEY}` } : {}),
  };
}

export async function getOllamaCloudStatus(): Promise<{
  configured: boolean;
  running: boolean;
  model: string;
  available: boolean;
  models: string[];
  error?: string;
}> {
  if (!OLLAMA_CLOUD_API_KEY) {
    return { configured: false, running: false, model: OLLAMA_CLOUD_MODEL, available: false, models: [], error: "Chưa cấu hình API key" };
  }
  try {
    const response = await fetch(`${OLLAMA_CLOUD_URL}/models`, { headers: headers(), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((item) => item.id ?? "").filter((id) => id.startsWith("ollama/"));
    return { configured: true, running: true, model: OLLAMA_CLOUD_MODEL, available: models.includes(OLLAMA_CLOUD_MODEL), models };
  } catch (error) {
    return { configured: true, running: false, model: OLLAMA_CLOUD_MODEL, available: false, models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function generateOllamaCloudText(input: {
  prompt: string;
  usageTag: string;
  projectId?: string | null;
  timeoutMs?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  if (!OLLAMA_CLOUD_API_KEY) throw new HttpError(503, "OLLAMA_CLOUD_NOT_CONFIGURED", "Ollama Cloud chưa được cấu hình API key trong 9Router.");
  try {
    const response = await fetch(`${OLLAMA_CLOUD_URL}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: OLLAMA_CLOUD_MODEL,
        messages: [
          { role: "system", content: "Bạn là biên tập viên cao cấp của Japan VIP. Chỉ dùng dữ kiện được cung cấp, giữ đúng định dạng và không giải thích ngoài kết quả." },
          { role: "user", content: input.prompt },
        ],
        stream: false,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 8 * 60_000),
    });
    const raw = await response.text();
    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(raw) as ChatCompletionResponse;
    } catch {
      throw new Error(`9Router trả dữ liệu không hợp lệ: ${raw.slice(0, 240)}`);
    }
    const errorMessage = typeof data.error === "string" ? data.error : data.error?.message;
    if (!response.ok || errorMessage) throw new Error(errorMessage || `HTTP ${response.status}`);
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Ollama Cloud không trả về nội dung");
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    try {
      if (inputTokens > 0 || outputTokens > 0) addTokenUsage(`${input.usageTag}_${nanoid(8)}`, input.projectId ?? null, inputTokens, outputTokens, 0, "ollama-cloud");
    } catch {
      // Thống kê là phụ, không được làm hỏng tác vụ chính.
    }
    return { text, inputTokens, outputTokens, costUsd: 0 };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "OLLAMA_CLOUD_AI_FAILED", `Gọi Ollama Cloud (${OLLAMA_CLOUD_MODEL}) thất bại: ${error instanceof Error ? error.message : String(error)}`);
  }
}
