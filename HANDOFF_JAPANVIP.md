# Handoff JapanVIP Content

Ngày bàn giao: 2026-08-08 (Asia/Ho_Chi_Minh)

## Mục tiêu

Mở rộng AIEV thành quy trình sản xuất nội dung sản phẩm cho JapanVIP: học cách trình bày từ bài tham khảo, nghiên cứu nguồn chính hãng, quản lý ảnh, tạo dàn ý/bài viết, Hermes phản biện và người dùng duyệt trước khi xuất bản.

## Repository và trạng thái triển khai

- Worktree phát triển: `/Users/tohongson/Claude Code/AIEV-japanvip`
- Bản đang chạy: `/Users/tohongson/AIEV`
- Nhánh: `feature/japanvip-ollama-provider`
- Nhánh triển khai: `japanvip/main`
- HEAD trước đợt sửa chọn lọc: `f0df6c9 docs(japanvip): add account handoff`
- Các commit quan trọng trước đó:
  - `b18ddaf`: xóa bài học AI đã lưu nhầm
  - `ef45aeb`: quy trình ảnh chính hãng
  - `aeaa8d1`: bộ chọn AI sticky
  - `6fb6527`: giao diện Content Project kiểu Enterprise
- Build `npm run build` đã đạt.
- Ứng dụng đang chạy bằng `npm start` tại `http://localhost:6868` và backend `http://localhost:6869`.
- Unified exec session hiện tại: `97531`.

## Tính năng đã hoàn thành

1. Content Project với các bước nghiên cứu, hình ảnh, dàn ý, bài viết, phản biện và duyệt.
2. Bộ chọn AI luôn hiển thị khi cuộn:
   - ChatGPT/Codex CLI
   - Claude Code
   - Ollama Local (`qwen3:14b`)
   - Ollama Cloud (`ollama/gpt-oss:120b`)
3. Thư viện AI học nội dung:
   - Lưu URL bài đối thủ, bài hay và bài JapanVIP.
   - Chỉ học bố cục/phong cách/SEO; không dùng làm nguồn xác nhận claim.
   - Hiển thị “Bài học có thể áp dụng”.
4. Hermes phản biện và chấm 7 tiêu chí; người dùng chủ động duyệt bài học trước khi lưu.
5. Có nút xóa phản hồi/bài học lưu nhầm và chặn lưu trùng.
6. Quy trình ảnh chính hãng:
   - Phát hiện ảnh từ URL hãng.
   - Duyệt/loại, vai trò, caption, alt, mục nội dung và nhóm tính năng.
   - Ảnh nhỏ `feature-small` cùng nhóm được yêu cầu gom thành bảng HTML.
7. Ollama Cloud qua 9Router:
   - Endpoint: `http://127.0.0.1:20128/v1`
   - Key riêng được lưu trong `.env` bằng `OLLAMA_CLOUD_API_KEY`; tuyệt đối không hiển thị/commit key.
   - Key trên giao diện 9Router được người dùng đặt tên `Japnvip`.
   - Model mặc định: `ollama/gpt-oss:120b`.
   - UI đã xác nhận: `Ollama Cloud: Sẵn sàng · ollama/gpt-oss:120b`.

## Benchmark Ollama Cloud

- `ollama/gpt-oss:120b`: hoạt động, khoảng 2,8 giây ở bài thử ngắn, giữ đúng dữ kiện và tiếng Việt tự nhiên. Đây là model được chọn.
- `ollama/qwen3.5`: 403, yêu cầu subscription.
- `ollama/kimi-k2.5`: đã retired 2026-07-31.
- `ollama/glm-5`: đã retired 2026-07-15.
- `ollama/minimax-m2.5`: đã retired 2026-07-31.
- `ollama/glm-4.7-flash`: 404 model not found.
- `ollama/minimax-m3`: gọi được nhưng phản hồi bị 9Router bọc sai định dạng.
- GPT-OSS 120B tiêu khoảng 2.000 token ngay cả prompt ngắn; chỉ nên dùng cho dàn ý, phân tích và sửa đoạn vừa/dài.

## Vai trò AI hiện thống nhất

- ChatGPT/Codex: điều phối, kiểm chứng fact, viết/chỉnh bài chính và đóng gói cuối.
- Ollama Cloud GPT-OSS 120B: dàn ý, phân tích bài tham khảo, sửa đoạn hoặc reviewer dự phòng.
- Ollama Local: kiểm tra rẻ, lặp từ, SEO và tác vụ nhẹ.
- Hermes: giám khảo độc lập; hiện mặc định Nous Portal model `tencent/hy3:free`.
- Không đổi model Hermes giữa các vòng chấm của cùng một bài để giữ thang điểm nhất quán.

## Trạng thái dữ liệu hiện tại

- Người dùng đã xóa Content Project thử nghiệm NX-AA18; danh sách Content Project đang trống.
- Thư viện AI học nội dung vẫn còn 3 bài tham khảo và hiển thị bài học bình thường.
- Người dùng dự định tạo bài mới từ URL sản phẩm chính hãng.
- Không tự xuất bản. Chỉ lưu CMS draft; chuyển `PUBLISHED` khi người dùng duyệt rõ bài cụ thể.

## Việc ưu tiên tiếp theo

1. Khi người dùng cung cấp URL chính hãng, tạo Content Project mới và khóa exact model/suffix/điện áp trước khi viết.
2. **Sửa có chọn lọc theo phản biện đã hoàn thành trong đợt tiếp quản này**:
   - Chọn CTA/văn phong/claim/đoạn lặp/SEO và nhập yêu cầu riêng cho vòng sửa.
   - AI chỉ trả tối đa 8 cặp đoạn cũ/mới; không ghi đè bài ngay.
   - Giao diện xem trước hai cột, cho phép bỏ chọn từng thay đổi rồi mới áp dụng.
   - Backend giới hạn tổng phạm vi thay thế 45%, yêu cầu đoạn cũ khớp duy nhất và dùng fingerprint để chặn ghi đè nếu bài đã đổi.
   - Endpoint viết lại toàn bài cũ đã bị tắt với HTTP 410.
3. Khi có bài mới, kiểm tra ảnh chính hãng đúng model, ảnh nhỏ gom nhóm và trải nghiệm desktop/mobile.
4. Có thể bổ sung model selector cho Ollama Cloud sau này, nhưng chỉ hiển thị các model đã smoke-test; không tin hoàn toàn danh sách `/v1/models` vì có model retired/không truy cập được.

## File tích hợp chính

- `apps/server/src/ollamaCloudText.ts`
- `apps/server/src/japanVipAi.ts`
- `apps/server/src/routes/japanVipContent.ts`
- `apps/server/src/routes/japanVipLearning.ts`
- `apps/server/src/japanVipContent.ts`
- `apps/server/src/hermesCritic.ts`
- `apps/web/src/app/japanvip-content/[id]/page.tsx`
- `apps/web/src/app/japanvip-content/learning/page.tsx`
- `apps/web/src/lib/api.ts`
- `docs/API.md`

## Quy tắc tiếp quản

- Đọc skill Graphify và query graph trước mọi thay đổi codebase; graph hiện nằm ở `/Users/tohongson/AIEV/graphify-out/graph.json`.
- Dùng skill `publish-japanvip-product-content` cho quy trình bài sản phẩm.
- Dùng `apply_patch` để sửa file; giữ thay đổi người dùng ngoài phạm vi.
- Build và smoke-test trước triển khai.
- Luồng triển khai hiện dùng fast-forward từ `feature/japanvip-ollama-provider` sang `japanvip/main`, rồi build/restart `/Users/tohongson/AIEV`.
- Không đưa `.env`, API key, token hoặc nội dung clipboard vào log/Git/chat.
