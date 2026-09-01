# Báo cáo: bảng "Chi phí AI theo model" hiện đúng model

Ngày 2026-08-10. Phạm vi: `apps/server` (backend). Web UI không phải sửa dòng nào.

## Vấn đề

Bảng "Chi phí AI theo model" trên Dashboard chỉ biết model qua `chat_sessions.model`,
tức là **chỉ những lượt chạy trong một phiên chat mới có tên model**. Mọi thứ khác —
bóc lời, dịch, tạo ảnh, sinh skill, Ollama, Codex CLI — ghi vào `token_usage` không kèm
model, nên hiện "không rõ" và không tra được đơn giá.

Số liệu thật lúc bắt đầu: 5 dòng thì **4 dòng không có model**, trong đó một dòng Claude
$0.2349 nằm luôn ở phần "chưa phân bổ được".

Hai lỗi phụ tìm thấy khi làm:

- `MODEL_PRICES` để giá model **tạo ảnh** là 0.3/2.5 (giá model văn bản), trong khi
  `gemini.ts` tính tiền ảnh theo $60/1M token ra. Cột tổng vẫn đúng nhưng tiền bị dồn
  gần hết sang cột "$vào" — sai chiều.
- `translate.ts` và `stt.ts` hardcode 0.3/2.5 cho **mọi** model. Dịch bằng
  `gemini-2.5-pro` (1.25/10) bị ghi thiếu tiền khoảng 4 lần.

## Đã làm

**1. `token_usage` có cột `model`** (`db.ts`)

- Migration `ALTER TABLE token_usage ADD COLUMN model TEXT`, dòng cũ để `NULL`.
- `addTokenUsage(...)` thêm tham số `model` (mặc định `null`).
- `usageByModel` đọc `COALESCE(u.model, s.model)`: ưu tiên model thật của lượt gọi,
  không có thì rơi về đường JOIN cũ.

**2. Mọi nơi gọi AI đều ghi model thật**

| Nơi gọi | Model ghi vào |
|---|---|
| `agent.ts` (phiên chat) | `modelUsage` của SDK, không có thì `session.model` |
| `aiText.ts` | `modelUsage`, không có thì model được yêu cầu |
| `routes/skills.ts` | `modelUsage` (chỗ này không truyền model, SDK tự chọn) |
| `gemini.ts` (ảnh) | model ảnh đã resolve |
| `translate.ts` | model dịch đã resolve |
| `stt.ts` | model bóc lời đã resolve |
| `ollamaText.ts` / `ollamaCloudText.ts` / `codexText.ts` | model của từng dịch vụ |

File mới `claudeModel.ts`: rút model thật từ `modelUsage` của Agent SDK. Lấy model
**tiêu nhiều token nhất** làm đại diện, vì `total_cost_usd` là một con số gộp không
tách ngược ra từng model được; ưu tiên `canonicalModel` (id SDK dùng để tra giá) hơn
khóa của object, vì khóa có thể là alias.

**3. Bảng giá đầy đủ hơn** (`pricing.ts`)

- Thêm mọi model Claude còn thiếu (Opus 4.5/4.1/4.0, Sonnet 4.5/4.0, Haiku 3) — danh sách
  chọn model của UI giờ **không còn id nào thiếu giá**.
- Thêm model Gemini văn bản: `gemini-2.5-flash` (0.3/2.5), `gemini-2.5-flash-lite`
  (0.1/0.4), `gemini-2.5-pro` (1.25/10).
- Sửa giá model ảnh: outPerM 2.5 → **60**, đúng hằng số `gemini.ts` dùng để tính tiền.
- Ollama / Ollama Cloud / Codex CLI: đơn giá 0 cho cả hai chiều, để bảng hiện `$0.00`
  thay vì `-` (hệ thống biết rõ là 0, không phải không biết).

**4. `translate.ts` và `stt.ts` lấy giá từ `pricing.ts`** thay vì hardcode. Tiền ghi vào DB
và tiền hiển thị trên Dashboard giờ cùng một nguồn, không thể lệch nhau.

## Lỗi tìm được nhờ chạy thử

`GROUP BY provider, model` chết ngay khi `token_usage` có thêm cột `model`: cả hai bảng
đều có cột tên `model` nên SQLite báo `ambiguous column name`. Đã đổi thành
`GROUP BY COALESCE(u.provider,'claude'), COALESCE(u.model, s.model)`. Nếu không chạy thử
trên bản sao DB thì lỗi này sẽ nổ ngay lần mở Dashboard đầu tiên.

## Kiểm chứng

- `npm run typecheck` sạch cả 3 workspace; `npm run build -w apps/server` sạch;
  `check-design-system.mjs` sạch.
- Chạy thử query mới trên **bản sao** `app.sqlite` với 5 dòng giả lập: mỗi dòng hiện đúng
  model, và `$vào + $ra` luôn bằng cột tổng. Dòng ảnh giờ dồn tiền về cột `$ra` như đúng
  bản chất.
- Server đã khởi động lại, `GET /api/usage/by-model` trả 200, migration chạy êm trên DB thật.

## Còn lại / lưu ý

- **Dòng cũ vẫn "không rõ" mãi mãi.** Chúng được ghi trước khi có cột `model` và không có
  chỗ nào lưu lại model đã dùng. Cố ý KHÔNG đoán ngược (ví dụ suy "img_*" ra model ảnh mặc
  định) vì người dùng có thể đã chọn model khác — đoán sai còn tệ hơn để trống. Từ giờ mọi
  dòng mới đều có model.
- **Sự cố trong lúc làm:** chạy `npm run build -w apps/server` trong khi `node dist/index.js`
  đang chạy đã làm backend (cổng 6869) tắt. Đã khởi động lại và xác nhận trả 200. Lần sau
  build thì dừng server trước, hoặc dùng `npm run dev` (tsx watch).
- Chưa commit — toàn bộ thay đổi còn ở working tree.
