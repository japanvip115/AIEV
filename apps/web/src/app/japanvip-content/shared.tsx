"use client";

/**
 * Phần dùng chung của ba trang Japan VIP Content (danh sách, chi tiết, thư viện học).
 *
 * VÌ SAO CÓ FILE NÀY: bảng trạng thái được chép hai bản, nhãn AI chép hai bản, và
 * riêng bốn dòng <option> của ô chọn AI thì chép BA bản (hai lần trong trang chi
 * tiết, một lần trong trang học). Thêm một provider là phải nhớ sửa đủ ba chỗ -
 * kiểu trùng lặp này luôn lệch nhau sau vài tháng.
 */

import type { BadgeTone } from "@/components/Badge";
import type {
  JapanVipAiProvider,
  JapanVipContentProject,
  JapanVipContentStatus,
} from "@/lib/api";

export const STATUS: Record<
  JapanVipContentStatus,
  { label: string; tone: BadgeTone }
> = {
  draft: { label: "Nháp", tone: "muted" },
  researching: { label: "Đang nghiên cứu", tone: "running" },
  writing: { label: "Đang viết", tone: "running" },
  review: { label: "Chờ duyệt", tone: "running" },
  approved: { label: "Đã duyệt", tone: "success" },
};

/** Tên ngắn để chèn vào câu ("ChatGPT tạo dàn ý"). */
export const AI_LABEL: Record<JapanVipAiProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  ollama: "Ollama Local",
  "ollama-cloud": "Ollama Cloud",
};

/** Nhãn đầy đủ cho ô chọn - có kèm tên model để người dùng biết đang gọi cái gì. */
const AI_OPTIONS: Array<{ value: JapanVipAiProvider; label: string }> = [
  { value: "codex", label: "ChatGPT (Codex CLI)" },
  { value: "claude", label: "Claude Code" },
  { value: "ollama", label: "Ollama Local (qwen3:14b)" },
  { value: "ollama-cloud", label: "Ollama Cloud (GPT-OSS 120B)" },
];

export function AiProviderSelect({
  id,
  value,
  onChange,
  disabled = false,
  className = "input",
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: JapanVipAiProvider;
  onChange: (next: JapanVipAiProvider) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as JapanVipAiProvider)}
    >
      {AI_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Những trường người dùng gõ tay trong màn hình biên tập - tức là những trường
 * có thể đang "bẩn" (đã sửa nhưng chưa bấm Lưu).
 */
export const EDITABLE_KEYS = [
  "name",
  "productModel",
  "primaryUrl",
  "targetKeyword",
  "audience",
  "status",
  "facts",
  "selectedReferenceIds",
  "outline",
  "article",
  "notes",
] as const satisfies ReadonlyArray<keyof JapanVipContentProject>;

export type EditableKey = (typeof EDITABLE_KEYS)[number];

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return false;
}

/**
 * Còn thay đổi chưa lưu hay không.
 *
 * Bản cũ so `JSON.stringify(project) !== JSON.stringify(draft)` trong một useMemo
 * phụ thuộc vào cả hai object - tức là MỖI PHÍM GÕ trong ô bài viết đều serialize
 * lại toàn bộ project (kèm nguyên văn mọi nguồn đã bóc, thường vài trăm KB) HAI
 * lần. Chỉ 11 trường là sửa được bằng tay, so đúng 11 trường đó là đủ và rẻ.
 */
export function isDirty(
  project: JapanVipContentProject | null,
  draft: JapanVipContentProject | null
): boolean {
  if (!project || !draft) return false;
  return EDITABLE_KEYS.some((key) => !sameValue(project[key], draft[key]));
}

/**
 * Trộn bản mới từ server vào bản nháp đang mở, GIỮ LẠI những gì người dùng đang
 * gõ dở.
 *
 * VÌ SAO: mọi thao tác gọi API (bóc nguồn, sửa caption ảnh, chấm điểm…) đều trả
 * về nguyên project và bản cũ gán thẳng nó vào cả `project` lẫn `draft`. Nghĩa là
 * đang viết dở bài, rê chuột ra khỏi ô caption của một tấm ảnh là bài viết chưa
 * lưu bị nuốt mất, không một tiếng động. Ở đây trường nào người dùng đã sửa mà
 * chưa lưu thì giữ nguyên của người dùng; trường nào chưa động tới thì lấy của
 * server.
 *
 * `overwrite` dành cho các thao tác mà server ĐANG CỐ Ý viết đè: sinh dàn ý, viết
 * bài, áp dụng bản sửa chọn lọc. Không có nó thì bấm "viết bài" xong lại thấy bài
 * cũ - đúng cái bẫy ngược lại.
 */
export function mergeServerProject(
  server: JapanVipContentProject,
  project: JapanVipContentProject | null,
  draft: JapanVipContentProject | null,
  overwrite: readonly EditableKey[] = []
): JapanVipContentProject {
  if (!project || !draft) return server;
  const next = { ...server };
  for (const key of EDITABLE_KEYS) {
    if (overwrite.includes(key)) continue;
    const edited = !sameValue(project[key], draft[key]);
    if (edited) (next[key] as JapanVipContentProject[typeof key]) = draft[key];
  }
  return next;
}
