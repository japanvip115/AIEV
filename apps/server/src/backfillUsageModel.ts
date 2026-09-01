import { backfillTokenUsageModel } from "./db.js";
import { OLLAMA_TEXT_MODEL } from "./ollamaText.js";
import { OLLAMA_CLOUD_MODEL } from "./ollamaCloudText.js";
import { CODEX_TEXT_MODEL } from "./codexText.js";

/**
 * Điền model cho các dòng `token_usage` ghi TRƯỚC khi bảng có cột `model`.
 *
 * Các dòng cũ để NULL nên bảng "Chi phí AI theo model" hiện "(không rõ model)"
 * mãi mãi cho tới khi chúng rơi ra khỏi cửa sổ 30 ngày. Với ba nhà cung cấp
 * dưới đây, model tại thời điểm ghi là MỘT hằng số duy nhất lấy từ cấu hình,
 * nên điền lại chính giá trị đó là tái dựng đúng chứ không phải đoán.
 *
 * KHÔNG đụng tới dòng `claude`: model của Claude thay đổi theo từng lượt gọi
 * (do người dùng chọn hoặc SDK tự chọn), không có hằng số nào để suy ra. Dòng
 * claude cũ nào còn phiên chat thì vẫn tra được model qua JOIN sang
 * `chat_sessions`; phiên đã xóa thì đành để "(không rõ model)".
 */
export function backfillUsageModels(): void {
  const filled =
    backfillTokenUsageModel("ollama", OLLAMA_TEXT_MODEL) +
    backfillTokenUsageModel("ollama-cloud", OLLAMA_CLOUD_MODEL) +
    backfillTokenUsageModel("openai", CODEX_TEXT_MODEL);
  if (filled > 0) console.log(`[usage] đã điền model cho ${filled} dòng token_usage cũ`);
}
