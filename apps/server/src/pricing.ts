/**
 * Đơn giá token theo model - USD trên MỘT TRIỆU token.
 *
 * DÙNG ĐỂ LÀM GÌ: bảng "Chi phí AI theo model" trên Dashboard cần tách riêng
 * tiền của token VÀO và token RA. Bảng `token_usage` chỉ lưu MỘT con số
 * `costUsd` gộp cả hai (Agent SDK trả về `total_cost_usd`), nên không tách
 * ngược ra được từ dữ liệu - phải suy ra bằng tỉ lệ.
 *
 * BẢNG GIÁ NÀY LÀ TỈ LỆ, KHÔNG PHẢI SỐ TIỀN - đọc kỹ chỗ này:
 * `routes/usage.ts` dùng đơn giá ở đây để tính TRỌNG SỐ giữa chiều vào và chiều
 * ra, rồi chia đúng số tiền THẬT theo trọng số đó. Nên $vào + $ra luôn bằng
 * `costUsd`.
 *
 * KHÔNG được quay lại cách nhân thẳng token × đơn giá để ra tiền. Đã thử và
 * hỏng: prompt cache đọc lại chỉ tính khoảng 10% giá vào, nên số nhân ra cao
 * gấp mấy lần tiền thật - bảng hiện $2.055 cạnh $402 trong cùng một hàng và
 * người dùng báo ngay là sai. Giá niêm yết trả lời được câu "chiều nào tốn hơn",
 * nhưng không trả lời được câu "hết bao nhiêu tiền".
 *
 * Giá Claude lấy từ bảng model chính thức (skill `claude-api`, bản 2026-06-24),
 * KHÔNG phải nhớ ra. Có model mới thì cập nhật ở đây, đừng đoán.
 */

/** USD/1 triệu token. */
export interface ModelPrice {
  inPerM: number;
  outPerM: number;
}

/**
 * Khóa là id model đúng như lúc ghi vào `chat_sessions.model`.
 * Model không có trong bảng này thì API trả `price: null` và UI để trống ô $,
 * chứ KHÔNG bịa một con số gần đúng.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // ----- Anthropic -----
  // Mọi id trong danh sách chọn model của UI (routes/providers.ts CLAUDE_MODELS)
  // đều phải có mặt ở đây, kể cả model cũ: thiếu một dòng là bảng Dashboard bỏ
  // trống ô $ của đúng model đó.
  "claude-fable-5": { inPerM: 10, outPerM: 50 },
  "claude-mythos-5": { inPerM: 10, outPerM: 50 },
  "claude-opus-5": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-7": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-6": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-5": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-1": { inPerM: 15, outPerM: 75 },
  "claude-opus-4-0": { inPerM: 15, outPerM: 75 },
  // Sonnet 5 đang có giá giới thiệu 2/10 tới hết 31/08/2026; để giá NIÊM YẾT
  // ở đây vì đây là bảng giá chuẩn, còn số tiền thật vẫn lấy từ costUsd.
  "claude-sonnet-5": { inPerM: 3, outPerM: 15 },
  "claude-sonnet-4-6": { inPerM: 3, outPerM: 15 },
  "claude-sonnet-4-5": { inPerM: 3, outPerM: 15 },
  "claude-sonnet-4-0": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
  "claude-3-haiku-20240307": { inPerM: 0.25, outPerM: 1.25 },

  // ----- Google Gemini (văn bản) -----
  // Đây CŨNG là nguồn để stt.ts và translate.ts tính costUsd (qua `priceFor`),
  // nên hai nơi bằng nhau theo cấu tạo. KHÔNG hardcode lại đơn giá ở file khác:
  // lệch một chữ số là cột tổng và cột $vào/$ra đá nhau.
  "gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-2.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-2.5-pro": { inPerM: 1.25, outPerM: 10 },

  // ----- Google Gemini (tạo ảnh) -----
  // outPerM = 60 là đúng hằng số gemini.ts dùng để tính costUsd của một ảnh.
  // Trước đây chỗ này ghi 2.5 (giá model văn bản) nên bảng dồn gần hết tiền ảnh
  // sang cột $vào - sai chiều, dù cột tổng vẫn đúng.
  "gemini-3.1-flash-image": { inPerM: 0.3, outPerM: 60 },
  "gemini-3.1-flash-lite-image": { inPerM: 0.3, outPerM: 60 },
  "gemini-3-pro-image": { inPerM: 0.3, outPerM: 60 },

  // ----- Chạy trên máy / gói thuê bao: KHÔNG tính tiền theo token -----
  // Ghi 0 chứ không bỏ trống: bỏ trống thì UI hiện "-" và đếm dòng đó vào phần
  // "chưa phân bổ được", làm người đọc tưởng hệ thống không biết giá. Ở đây
  // biết rất rõ: bằng 0.
  "codex-cli-gpt-image-2": { inPerM: 0, outPerM: 0 },
};

/**
 * Đơn giá mặc định theo NHÀ CUNG CẤP - dùng khi dòng token_usage không gắn với
 * phiên chat nào nên không biết model (bóc lời, dịch, tạo ảnh… chạy ngoài phiên).
 * Riêng Claude cố ý KHÔNG có mặc định: khoảng giá của nó quá rộng (1 → 50
 * USD/1M) nên đoán bừa là sai hẳn một bậc, thà để trống.
 */
export const PROVIDER_FALLBACK_PRICES: Record<string, ModelPrice> = {
  gemini: { inPerM: 0.3, outPerM: 2.5 },
  // Ollama chạy trên máy và Ollama Cloud/Codex CLI đi theo gói thuê bao: token
  // không quy ra tiền, mọi dòng đều costUsd = 0. Đơn giá 0 cho cả hai chiều để
  // bảng hiện $0.00 thay vì "-" (xem ghi chú ở MODEL_PRICES).
  ollama: { inPerM: 0, outPerM: 0 },
  "ollama-cloud": { inPerM: 0, outPerM: 0 },
  openai: { inPerM: 0, outPerM: 0 },
};

/** Đơn giá của một dòng usage; null = không biết, UI phải để trống ô $. */
export function priceFor(
  model: string | null,
  provider: string | null,
): ModelPrice | null {
  if (model && MODEL_PRICES[model]) return MODEL_PRICES[model];
  if (provider && PROVIDER_FALLBACK_PRICES[provider]) {
    return PROVIDER_FALLBACK_PRICES[provider];
  }
  return null;
}
