import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import type { JapanVipContentImage, JapanVipImageRole } from "./japanVipContent.js";
import { ensureDir, nowIso } from "./util.js";

/**
 * Khổ ảnh trong bài viết Japan VIP.
 *
 * MÔ HÌNH: khai báo vài KHỔ dùng chung, rồi mỗi VAI TRÒ ảnh gán vào khổ. Bản
 * thiết kế đầu tiên cho mỗi vai trò một bộ tỉ lệ/kích thước/cách cắt riêng - tám
 * vai trò thành ra ~48 ô để điền và để bảo trì, trong khi feature với detail gần
 * như luôn cùng một khổ. Gom thành khổ dùng chung thì sửa một con số là cả nhóm
 * vai trò đi theo.
 *
 * `accept` là DANH SÁCH chứ không phải một khổ: ảnh packshot của hãng khi thì
 * ngang khi thì vuông, ép cứng một khổ là phải cắt hoặc phải chừa viền vô lý.
 * Khung render chọn khổ khớp ảnh thật nhất trong danh sách.
 */

export interface JapanVipImageFormatPreset {
  id: string;
  label: string;
  /** null = giữ nguyên tỉ lệ gốc của ảnh (sơ đồ, bản vẽ kích thước). */
  aspectRatio: number | null;
  /** Dung sai tỉ lệ, 0.12 = ±12%. Đây là phần "hoặc khổ hãng gần tương đương". */
  tolerance: number;
  minWidth: number;
  minHeight: number;
  /** contain = không bao giờ cắt. cover = được phép cắt cho đều khung. */
  fit: "contain" | "cover";
  /** Có được phép tràn hết chiều rộng bài viết hay không. */
  allowFullBleed: boolean;
}

export type JapanVipImageLayout = "full" | "solo" | "grid-2" | "grid-3";

export interface JapanVipRoleFormat {
  role: JapanVipImageRole;
  /** Khổ chấp nhận được, phần tử đầu là ưu tiên khi không đoán được từ ảnh thật. */
  accept: string[];
  layout: JapanVipImageLayout;
}

export interface JapanVipImageFormatConfig {
  version: 1;
  presets: JapanVipImageFormatPreset[];
  roles: JapanVipRoleFormat[];
  updatedAt: string;
}

const PRESETS: JapanVipImageFormatPreset[] = [
  { id: "hero-wide", label: "Hero rộng", aspectRatio: 16 / 9, tolerance: 0.18, minWidth: 1200, minHeight: 650, fit: "cover", allowFullBleed: true },
  { id: "content-landscape", label: "Ngang nội dung", aspectRatio: 4 / 3, tolerance: 0.15, minWidth: 800, minHeight: 600, fit: "contain", allowFullBleed: false },
  { id: "square", label: "Vuông", aspectRatio: 1, tolerance: 0.12, minWidth: 600, minHeight: 600, fit: "contain", allowFullBleed: false },
  { id: "portrait", label: "Dọc", aspectRatio: 3 / 4, tolerance: 0.15, minWidth: 600, minHeight: 800, fit: "contain", allowFullBleed: false },
  { id: "diagram-wide", label: "Sơ đồ rộng", aspectRatio: null, tolerance: 1, minWidth: 1000, minHeight: 0, fit: "contain", allowFullBleed: false },
  // Hai khổ dưới lấy từ ảnh THẬT của trang hãng Nhật, không phải từ lý thuyết:
  // Panasonic xuất ảnh tính năng ở 864×1222 (0,71) cho mobile và 1920×795 (2,42)
  // cho desktop. Không khai hai khổ này thì phần lớn ảnh hãng không khớp khổ nào,
  // và hệ quả thật là chúng không bao giờ đủ điều kiện tự duyệt.
  { id: "portrait-tall", label: "Dọc cao (5:7)", aspectRatio: 5 / 7, tolerance: 0.1, minWidth: 600, minHeight: 800, fit: "contain", allowFullBleed: false },
  { id: "banner-wide", label: "Siêu rộng (12:5)", aspectRatio: 12 / 5, tolerance: 0.12, minWidth: 1200, minHeight: 500, fit: "contain", allowFullBleed: false },
];

const ROLES: JapanVipRoleFormat[] = [
  { role: "hero", accept: ["hero-wide"], layout: "full" },
  { role: "main-packshot", accept: ["content-landscape", "square"], layout: "solo" },
  { role: "alternate-angle", accept: ["content-landscape"], layout: "grid-2" },
  // feature nhận thêm hai khổ "đời thực" ở trên: ảnh tính năng của hãng Nhật hầu
  // như luôn là bản dọc cao hoặc bản băng ngang, hiếm khi đúng 4:3.
  { role: "feature", accept: ["content-landscape", "portrait-tall", "banner-wide"], layout: "grid-2" },
  { role: "feature-small", accept: ["square", "content-landscape", "portrait-tall"], layout: "grid-3" },
  { role: "detail", accept: ["square"], layout: "grid-2" },
  { role: "dimensions", accept: ["diagram-wide"], layout: "solo" },
  { role: "maintenance", accept: ["content-landscape"], layout: "grid-2" },
];

export function defaultImageFormatConfig(): JapanVipImageFormatConfig {
  return { version: 1, presets: PRESETS.map((p) => ({ ...p })), roles: ROLES.map((r) => ({ ...r, accept: [...r.accept] })), updatedAt: nowIso() };
}

function filePath(): string { return path.join(paths.japanVipContentDir, "image-format.json"); }

/** Vá bản đã lưu bằng mặc định: thêm vai trò mới sau này không làm hỏng file cũ. */
function reconcile(stored: Partial<JapanVipImageFormatConfig>): JapanVipImageFormatConfig {
  const base = defaultImageFormatConfig();
  const presets = Array.isArray(stored.presets) && stored.presets.length ? stored.presets : base.presets;
  const presetIds = new Set(presets.map((preset) => preset.id));
  const storedRoles = new Map((Array.isArray(stored.roles) ? stored.roles : []).map((role) => [role.role, role]));
  const roles = base.roles.map((fallback) => {
    const found = storedRoles.get(fallback.role);
    if (!found) return fallback;
    // Khổ bị xóa khỏi danh sách preset thì vai trò trỏ vào hư không -> quay về mặc định.
    const accept = (Array.isArray(found.accept) ? found.accept : []).filter((id) => presetIds.has(id));
    return { role: fallback.role, accept: accept.length ? accept : fallback.accept, layout: found.layout ?? fallback.layout };
  });
  return { version: 1, presets, roles, updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : nowIso() };
}

export function readImageFormatConfig(): JapanVipImageFormatConfig {
  try {
    return reconcile(JSON.parse(fs.readFileSync(filePath(), "utf8")) as Partial<JapanVipImageFormatConfig>);
  } catch {
    return defaultImageFormatConfig();
  }
}

export function writeImageFormatConfig(config: JapanVipImageFormatConfig): JapanVipImageFormatConfig {
  const next = reconcile({ ...config, updatedAt: nowIso() });
  ensureDir(paths.japanVipContentDir);
  const file = filePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return next;
}

export function aspectOf(image: Pick<JapanVipContentImage, "width" | "height">): number | null {
  return image.width && image.height ? image.width / image.height : null;
}

function withinTolerance(aspect: number, preset: JapanVipImageFormatPreset): boolean {
  if (preset.aspectRatio === null) return true;
  return Math.abs(aspect - preset.aspectRatio) / preset.aspectRatio <= preset.tolerance;
}

export interface ResolvedFormat {
  preset: JapanVipImageFormatPreset;
  layout: JapanVipImageLayout;
  /** Ảnh thật có nằm trong dung sai của khổ đã chọn không. */
  matches: boolean;
  /** Lý do trượt, để hiện cho người dùng thay vì im lặng loại. */
  reason: string;
}

/**
 * Chọn khổ cho một ảnh: ưu tiên override của chính ảnh, sau đó tới khổ trong
 * danh sách `accept` khớp tỉ lệ thật nhất.
 *
 * Không đọc được kích thước thì lấy khổ ưu tiên nhưng ÉP `contain` - đoán sai
 * khổ mà lại cắt thì mất luôn phần chữ hoặc bảng điều khiển trong ảnh.
 */
export function resolveImageFormat(
  image: Pick<JapanVipContentImage, "width" | "height" | "role"> & { formatPresetId?: string | null },
  config: JapanVipImageFormatConfig
): ResolvedFormat {
  const roleFormat = config.roles.find((item) => item.role === image.role) ?? config.roles[0];
  const byId = new Map(config.presets.map((preset) => [preset.id, preset]));
  const override = image.formatPresetId ? byId.get(image.formatPresetId) : undefined;
  const candidates = roleFormat.accept.map((id) => byId.get(id)).filter((preset): preset is JapanVipImageFormatPreset => Boolean(preset));
  const fallback = override ?? candidates[0] ?? config.presets[0];
  const aspect = aspectOf(image);

  if (!aspect) {
    return { preset: { ...fallback, fit: "contain" }, layout: roleFormat.layout, matches: false, reason: "chưa đọc được kích thước ảnh" };
  }

  const matched = candidates.find((item) => withinTolerance(aspect, item));
  const preset = override ?? matched ?? fallback;
  const fits = withinTolerance(aspect, preset);
  const bigEnough = (image.width ?? 0) >= preset.minWidth && (image.height ?? 0) >= preset.minHeight;

  if (!fits && !override) {
    // KHÔNG khổ nào trong danh sách khớp ảnh này -> giữ nguyên tỉ lệ gốc.
    // Ép khung vào đây là hỏng thật: ảnh dọc 864×1222 nhét vào 4:3 thì ảnh teo
    // lại giữa hai mảng viền, còn banner 1280×336 ép vào 16:9 thì bị cắt cụt
    // mất chữ. Vẫn trả matches:false nên ảnh không được tự duyệt.
    return {
      preset: { ...preset, aspectRatio: null, fit: "contain" },
      layout: roleFormat.layout,
      matches: false,
      reason: `tỉ lệ ${aspect.toFixed(2)} không khớp khổ nào của vai trò, giữ tỉ lệ gốc`,
    };
  }

  const reason = fits
    ? bigEnough ? "" : `nhỏ hơn ${preset.minWidth}×${preset.minHeight}px của khổ ${preset.label}`
    : `tỉ lệ ${aspect.toFixed(2)} lệch khổ ${preset.label}`;

  return { preset, layout: roleFormat.layout, matches: fits && bigEnough, reason };
}

/**
 * LUẬT CỨNG, không cho cấu hình tắt - đây là những thứ làm hỏng bài viết chứ
 * không phải chuyện thẩm mỹ tuỳ khẩu vị.
 */
export function applyHardRules(resolved: ResolvedFormat, image: Pick<JapanVipContentImage, "width" | "height" | "role">): ResolvedFormat {
  const aspect = aspectOf(image);
  let { preset, layout } = resolved;

  // 1. Ảnh dọc không bao giờ tràn hết chiều ngang bài - nó sẽ cao bằng cả màn hình.
  if (aspect !== null && aspect < 1 && layout === "full") layout = "solo";
  if (!preset.allowFullBleed && layout === "full") layout = "solo";

  // 2. Sơ đồ, bản vẽ kích thước: cắt là mất số đo. Không bao giờ cover.
  if (image.role === "dimensions" || preset.aspectRatio === null) preset = { ...preset, fit: "contain" };

  // 3. Ảnh có chữ/bảng điều khiển hay bị cắt mất phần quan trọng khi cover mà
  //    tỉ lệ chỉ vừa đủ nằm trong dung sai. Chỉ cho cover khi khớp rất sát.
  if (preset.fit === "cover" && aspect !== null && preset.aspectRatio !== null) {
    const drift = Math.abs(aspect - preset.aspectRatio) / preset.aspectRatio;
    if (drift > 0.08) preset = { ...preset, fit: "contain" };
  }

  return { ...resolved, preset, layout };
}

/**
 * Loại bản trùng PC/mobile TRƯỚC KHI BỐ TRÍ.
 *
 * Trang hãng Nhật gần như luôn xuất hai bản của cùng một hình (`_pc` và `_sp`),
 * đưa cả hai vào bài là bạn đọc thấy đúng một hình hai lần. Chỉ lọc ở khâu bố
 * trí - kho ảnh giữ nguyên, người dùng vẫn chọn tay được bản mình muốn.
 */
const ROLE_PRIORITY: Partial<Record<JapanVipImageRole, number>> = { hero: 3, "main-packshot": 2, dimensions: 2 };

export function dedupeVariants<T extends Pick<JapanVipContentImage, "url" | "altText" | "width" | "height"> & { role?: JapanVipImageRole }>(images: T[]): T[] {
  // Khóa lấy từ TÊN FILE chứ không phải toàn bộ URL. Bản PC và bản mobile của
  // cùng một hình trên trang Panasonic nằm ở hai nhánh đường dẫn khác hẳn nhau
  // (…/c_gen007.coreimg.jpeg/… và …/c_gen007/mobileFile.coreimg.jpeg/…, kèm hai
  // dấu thời gian khác nhau), nên so cả URL thì không bao giờ trùng - đã thấy
  // np-tz500-main-pc và np-tz500-main-sp cùng lọt vào một bài.
  const key = (image: T): string => {
    const fileName = image.url.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() ?? image.url;
    const base = fileName
      .replace(/\.(jpg|jpeg|png|webp|avif|gif)$/i, "")
      .replace(/@\dx$/i, "")
      .replace(/([_-])(pc|sp|mobile|mo|tablet|retina)$/i, "")
      .replace(/[_-]\d{3,4}(x\d{3,4})?$/i, "")
      .toLocaleLowerCase("en");
    // Tên quá chung ("main", "img01") thì gom nhầm hai hình khác nhau còn tệ hơn
    // là để lọt một bản trùng - trường hợp đó bỏ qua, không gom.
    return base.length >= 6 ? `name:${base}` : `url:${image.url}`;
  };
  // VAI TRÒ THẮNG DIỆN TÍCH. Xếp thuần theo diện tích thì bản mobile to hơn sẽ
  // hất bản PC mà người dùng đã gán làm hero, và bài viết mất ảnh hero trong im
  // lặng - trong khi cổng kiểm tra vẫn báo "đã có hero" vì nó soi danh sách
  // chưa lọc. Vai trò là lựa chọn có chủ đích của con người, phải được giữ.
  const rank = (image: T): number => (ROLE_PRIORITY[image.role ?? "feature"] ?? 1);
  const best = new Map<string, T>();
  for (const image of images) {
    const id = key(image);
    const current = best.get(id);
    if (!current) { best.set(id, image); continue; }
    const area = (image.width ?? 0) * (image.height ?? 0);
    const currentArea = (current.width ?? 0) * (current.height ?? 0);
    const better = rank(image) !== rank(current) ? rank(image) > rank(current) : area > currentArea;
    if (better) best.set(id, image);
  }
  // Giữ đúng thứ tự xuất hiện ban đầu.
  const kept = new Set(best.values());
  return images.filter((image) => kept.has(image));
}
