/**
 * Rút ra MODEL THẬT của một lượt gọi Claude Agent SDK.
 *
 * DÙNG ĐỂ LÀM GÌ: bảng "Chi phí AI theo model" trên Dashboard cần biết lượt chạy
 * vừa rồi tiêu token của model nào. Tên model người dùng CHỌN không trả lời được
 * câu đó: bỏ trống thì SDK tự chọn mặc định, và một lượt chạy có thể chạm nhiều
 * model (model chính + model phụ cho việc vặt). Message `result` của SDK có sẵn
 * `modelUsage` - khóa là id model thật, giá trị là token của riêng model đó.
 *
 * Chọn model TIÊU NHIỀU TOKEN NHẤT làm đại diện cho cả lượt: tiền của lượt chạy
 * (`total_cost_usd`) là một con số gộp, không tách ngược ra từng model được, nên
 * phải gán trọn vào một dòng. Gán cho model làm phần việc nặng là gần đúng nhất;
 * gán cho model đầu tiên trong object thì phụ thuộc thứ tự khóa, tức là hên xui.
 */

/** Đúng phần `modelUsage` mà file này cần - không copy cả kiểu của SDK. */
export interface ModelUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /**
   * Id model chuẩn mà chính SDK dùng để tra bảng giá (vd "claude-opus-4-7").
   * Ưu tiên hơn khóa của object: khóa có thể là alias hoặc id riêng của nhà cung
   * cấp (Bedrock, Vertex…), tra `MODEL_PRICES` sẽ trượt.
   */
  canonicalModel?: string;
}

/** null = message không có `modelUsage` (bản SDK cũ) → nơi gọi tự có phương án dự phòng. */
export function pickMainModel(
  modelUsage: Record<string, ModelUsageLike> | undefined | null,
): string | null {
  if (!modelUsage) return null;
  let best: string | null = null;
  let bestTokens = -1;
  for (const [model, u] of Object.entries(modelUsage)) {
    const tokens =
      (u?.inputTokens ?? 0) +
      (u?.outputTokens ?? 0) +
      (u?.cacheReadInputTokens ?? 0) +
      (u?.cacheCreationInputTokens ?? 0);
    if (tokens > bestTokens) {
      best = u?.canonicalModel || model;
      bestTokens = tokens;
    }
  }
  return best;
}
