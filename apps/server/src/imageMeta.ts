import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { HttpError, ensureDir, isKebabCase, nowIso, toKebabAscii } from "./util.js";

/**
 * Image project - tạo ảnh AI (Gemini nền + Remotion hoàn thiện).
 * Nguồn sự thật: image-projects/<id>/meta.json (shape ImageProject trong docs/API.md).
 */

export const IMAGE_KINDS = [
  "background",
  "3d",
  "character",
  "texture",
  "product",
  "concept",
] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const IMAGE_ASPECTS = ["9:16", "16:9", "1:1", "4:5"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

/** Khổ pixel đích theo tỉ lệ - GPT luôn trả ảnh vuông nên phải cắt/co về đây. */
export const IMAGE_ASPECT_SIZE: Record<ImageAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/**
 * Trần số ảnh sinh từ một ảnh mẫu trong MỘT lượt.
 * Mỗi ảnh tốn một lượt quota ảnh ChatGPT và 1-2 phút, nên gõ nhầm "50" là mất
 * cả tiếng chờ lẫn quota. Chặn ở tầng server, không tin mỗi validate phía web.
 */
export const MAX_ANGLE_COUNT = 8;

/**
 * Biên cho cỡ ảnh tuỳ chỉnh.
 *
 * GPT Image 2 luôn trả ảnh vuông cỡ ~1254px, nên xin cạnh LỚN HƠN mốc đó là
 * ffmpeg phóng to lên - ảnh sẽ mềm và bệt đi chứ không nét thêm. Vẫn cho phép
 * (có lúc cần đúng khổ để ghép vào video), nhưng UI phải cảnh báo.
 */
export const CUSTOM_SIZE_MIN = 64;
export const CUSTOM_SIZE_MAX = 4096;
/** Cạnh ảnh GPT trả về trong thực tế - mốc để cảnh báo phóng to. */
export const GPT_NATIVE_EDGE = 1254;

/**
 * File thuộc loạt ảnh sinh từ mẫu - gồm cả file tạm của bước cắt khổ.
 *
 * Đây là ALLOWLIST xóa: mọi chỗ dọn loạt ảnh (job trước khi chạy lại, route khi
 * đổi/xóa ảnh mẫu) đều phải lọc qua đúng regex này. Nới nó ra là xóa nhầm
 * product-ref/background/final/meta.json của người dùng.
 */
export const ANGLE_FILE_RE = /^angle-\d+\.png(?:\.fit\.tmp\.png)?$/;

export type ImageStatus = "draft" | "generating" | "done" | "error";

/** Bước của job "image-gen" - lưu trong cột sceneId của job */
export const IMAGE_GEN_STEPS = ["all", "background", "compose"] as const;
export type ImageGenStep = (typeof IMAGE_GEN_STEPS)[number];

export interface ImageStat {
  label: string;
  value: string;
}

/**
 * Vị trí khối chữ trong ảnh - lưới 3x3 (dọc-ngang).
 * "auto" = để Poster tự chọn theo tỉ lệ khung, đúng như trước khi có tùy chọn
 * này: ngang → giữa-trái, vuông → đáy-giữa, dọc → đáy-trái. Giữ "auto" làm mặc
 * định để project cũ render lại vẫn ra y hệt.
 */
export const IMAGE_TEXT_POSITIONS = [
  "auto",
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type ImageTextPosition = (typeof IMAGE_TEXT_POSITIONS)[number];

export interface ImageOverlay {
  title: string;
  subtitle: string;
  stats: ImageStat[];
  cta: string;
  showLogo: boolean;
  /** Vị trí khối chữ trong khung - xem IMAGE_TEXT_POSITIONS */
  position: ImageTextPosition;
}

export interface ImageProject {
  id: string;
  name: string;
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  status: ImageStatus;
  /** Model tạo nền (Gemini hoặc GPT Image 2 qua Codex CLI) - null = mặc định Nano Banana 2 */
  model: string | null;
  /** Style Design áp dụng khi generate (id trong assets/styles/styles.json) - null = style default */
  styleId: string | null;
  overlay: ImageOverlay;
  /** Tên file nền trong image-projects/<id>/ (vd "background.png") - null = chưa có */
  background: string | null;
  /** Tên file ảnh hoàn thiện (vd "final.png") - null = chưa compose */
  final: string | null;
  /**
   * Ảnh sản phẩm THẬT người dùng tải lên, làm mẫu cho GPT vẽ thêm góc.
   * Khác hẳn `background`: đây là ĐẦU VÀO, background là ĐẦU RA.
   * null = không có mẫu -> chạy y hệt đường sinh ảnh cũ.
   */
  productRef: string | null;
  /** Số ảnh muốn sinh từ ảnh mẫu. 1 = như cũ. Trần MAX_ANGLE_COUNT. */
  angleCount: number;
  /**
   * Cỡ px tuỳ chỉnh cho ảnh sinh từ mẫu. null = theo tỉ lệ đã chọn.
   * CHỈ áp cho đường sinh ảnh từ mẫu - KHÔNG đụng khung Remotion (compose dựng
   * theo tỉ lệ cố định, nới cỡ ở đó là vỡ bố cục chữ và logo).
   * Hai trường đi theo cặp: thiếu một cái thì coi như không đặt.
   */
  customWidth: number | null;
  customHeight: number | null;
  /**
   * File các ảnh đã sinh từ ảnh mẫu ("angle-1.png"...). TẤT CẢ đều là ảnh AI
   * DỰNG LẠI, không phải ảnh chụp thật - chỉ dùng cho video và bài viết,
   * không được đưa vào bộ ảnh gallery sản phẩm (chủ dự án chốt 01/09).
   */
  angles: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function imageDirOf(id: string): string {
  return path.join(paths.imageProjectsDir, id);
}

export function imageMetaPathOf(id: string): string {
  return path.join(imageDirOf(id), "meta.json");
}

export function imageProjectExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(imageMetaPathOf(id));
}

export function defaultOverlay(): ImageOverlay {
  return { title: "", subtitle: "", stats: [], cta: "", showLogo: true, position: "auto" };
}

/** Merge overlay partial (không tin dữ liệu ngoài) lên base - field thiếu/sai kiểu giữ base */
export function normOverlay(raw: unknown, base: ImageOverlay = defaultOverlay()): ImageOverlay {
  const out: ImageOverlay = { ...base, stats: [...base.stats] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.title === "string") out.title = o.title;
  if (typeof o.subtitle === "string") out.subtitle = o.subtitle;
  if (typeof o.cta === "string") out.cta = o.cta;
  if (typeof o.showLogo === "boolean") out.showLogo = o.showLogo;
  // Giá trị lạ (client cũ, meta.json sửa tay) → giữ base thay vì nhận bừa
  if (IMAGE_TEXT_POSITIONS.includes(o.position as ImageTextPosition)) {
    out.position = o.position as ImageTextPosition;
  }
  if (Array.isArray(o.stats)) {
    out.stats = o.stats
      .filter(
        (s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s),
      )
      .map((s) => ({
        label: typeof s.label === "string" ? s.label : "",
        value: typeof s.value === "string" ? s.value : String(s.value ?? ""),
      }));
  }
  return out;
}

function normStatus(s: unknown): ImageStatus {
  return s === "generating" || s === "done" || s === "error" ? s : "draft";
}

/** Chuẩn hóa meta đọc từ đĩa về đúng shape ImageProject (dữ liệu đĩa không tin kiểu) */
/**
 * Ép số ảnh về 1..MAX_ANGLE_COUNT khi ĐỌC TỪ ĐĨA. Chữ/âm/NaN -> 1, thập phân
 * làm tròn xuống (2.7 -> 2), lớn hơn trần -> trần.
 *
 * Cố ý KHÁC route: đọc meta.json phải luôn mở được project, còn API thì trả 400
 * (`parseAngleCount`). Chỉ meta.json sửa tay mới đi qua đây, và nó không phải
 * đường người dùng đặt số ảnh.
 */
export function clampAngleCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_ANGLE_COUNT);
}

/**
 * Tên file NẰM TRONG thư mục project. meta.json do agent ghi hoặc người dùng sửa
 * tay nên không tin được: clone chép file theo đúng tên này, lọt một cái
 * "../../.ssh/id_rsa" là server đọc/ghi ra ngoài thư mục đích. Chỉ nhận một
 * basename thuần, còn lại coi như không có file.
 */
export function normProjectFile(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  // Chặn dấu phân cách một cách ĐỘC LẬP HỆ ĐIỀU HÀNH, không dựa vào path.basename:
  // trên macOS/Linux `path.basename("..\\..\\x.png")` trả về NGUYÊN chuỗi (POSIX
  // không coi "\" là dấu phân cách), nên chỉ so với basename là để lọt. Cùng
  // meta.json đó chạy trên Windows (AIEV có chạy) thì "\" LÀ dấu phân cách và
  // path.join thoát ra ngoài thư mục project thật.
  if (/[\\/]/.test(raw)) return null;
  // Ký tự điều khiển/NUL: fs ném lỗi khó hiểu, và "a\0.png" có thể bị cắt ở tầng dưới.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (raw === "." || raw === "..") return null;
  // Chốt cuối: còn khác basename thì vẫn coi là có đường dẫn.
  if (raw !== path.basename(raw)) return null;
  return raw;
}

/** Một cạnh của cỡ tuỳ chỉnh: số nguyên trong biên, còn lại -> null (không đặt). */
export function normCustomSide(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < CUSTOM_SIZE_MIN || n > CUSTOM_SIZE_MAX) return null;
  return n;
}

/**
 * Cỡ đích cuối cùng cho ảnh sinh từ mẫu: cỡ tuỳ chỉnh nếu ĐỦ CẢ HAI cạnh,
 * không thì theo tỉ lệ. Thiếu một cạnh mà vẫn dùng là ra ảnh méo.
 */
export function targetSizeOf(meta: {
  aspect: ImageAspect;
  customWidth: number | null;
  customHeight: number | null;
}): { width: number; height: number } {
  if (meta.customWidth && meta.customHeight) {
    return { width: meta.customWidth, height: meta.customHeight };
  }
  return IMAGE_ASPECT_SIZE[meta.aspect];
}

function normImageMeta(id: string, raw: unknown, mtimeIso: string): ImageProject {
  const m = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    id,
    name: typeof m.name === "string" && m.name ? m.name : id,
    prompt: typeof m.prompt === "string" ? m.prompt : "",
    kind: IMAGE_KINDS.includes(m.kind as ImageKind) ? (m.kind as ImageKind) : "background",
    aspect: IMAGE_ASPECTS.includes(m.aspect as ImageAspect) ? (m.aspect as ImageAspect) : "9:16",
    status: normStatus(m.status),
    model: typeof m.model === "string" && m.model ? m.model : null,
    styleId: typeof m.styleId === "string" && m.styleId ? m.styleId : null,
    overlay: normOverlay(m.overlay),
    // background/final đi qua cùng bộ lọc tên file như productRef/angles: clone
    // và staging Remotion đều path.join theo đúng chuỗi này, nên meta sửa tay
    // "../../x.png" là đọc/ghi thoát khỏi thư mục project. Tên file hợp lệ
    // ("background.png", "final.png") vẫn qua nguyên vẹn.
    background: normProjectFile(m.background),
    final: normProjectFile(m.final),
    productRef: normProjectFile(m.productRef),
    angleCount: clampAngleCount(m.angleCount),
    customWidth: normCustomSide(m.customWidth),
    customHeight: normCustomSide(m.customHeight),
    angles: Array.isArray(m.angles)
      ? m.angles
          .map(normProjectFile)
          .filter((a): a is string => a !== null)
      : [],
    error: typeof m.error === "string" && m.error ? m.error : null,
    createdAt: typeof m.createdAt === "string" && m.createdAt ? m.createdAt : mtimeIso,
    updatedAt: typeof m.updatedAt === "string" && m.updatedAt ? m.updatedAt : mtimeIso,
  };
}

/** Đọc meta.json của image project - ném HttpError 400/404/500 như readMeta của video project */
export function readImageMeta(id: string): ImageProject {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_IMAGE_ID", `Image project id không hợp lệ: ${id}`);
  }
  const file = imageMetaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "IMAGE_NOT_FOUND", `Không tìm thấy image project "${id}"`);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return normImageMeta(id, raw, fs.statSync(file).mtime.toISOString());
  } catch {
    throw new HttpError(
      500,
      "META_INVALID",
      `meta.json của image project "${id}" không phải JSON hợp lệ`,
    );
  }
}

export function writeImageMeta(id: string, meta: ImageProject): void {
  meta.updatedAt = nowIso();
  ensureDir(imageDirOf(id));
  fs.writeFileSync(imageMetaPathOf(id), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

/** Sinh id từ name (bỏ dấu tiếng Việt, kebab-case), trùng thì thêm -2, -3… */
export function newImageProjectId(name: string): string {
  const base = toKebabAscii(name) || "image";
  let id = base;
  for (let n = 2; fs.existsSync(imageDirOf(id)); n++) id = `${base}-${n}`;
  return id;
}

/** Quét image-projects/<id>/meta.json → danh sách, mới cập nhật trước */
export function scanImageProjects(): ImageProject[] {
  if (!fs.existsSync(paths.imageProjectsDir)) return [];
  const out: ImageProject[] = [];
  for (const entry of fs.readdirSync(paths.imageProjectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = imageMetaPathOf(entry.name);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      out.push(normImageMeta(entry.name, raw, fs.statSync(file).mtime.toISOString()));
    } catch {
      /* meta hỏng → bỏ qua khỏi danh sách */
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}
