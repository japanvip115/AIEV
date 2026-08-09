import type { JapanVipContentImage, JapanVipImageRole } from "./japanVipContent.js";

/**
 * Khổ ảnh trong bài viết Japan VIP - MỘT quy tắc cố định, không cấu hình.
 *
 *   1. Ảnh hero / lifestyle trên cùng : 1200×650 trở xuống, tràn khổ
 *   2. Ảnh mô tả sản phẩm và tính năng: 650×650 trở xuống
 *   3. Ảnh tính năng nhỏ             : 300×300, gom 4 ảnh một hàng, kèm chú thích
 *
 * "Trở xuống" nghĩa là KHUNG TỐI ĐA chứ không phải tỉ lệ bắt buộc: ảnh giữ nguyên
 * tỉ lệ gốc, thu lại cho vừa khung, không bao giờ bị phóng to hay bị cắt.
 *
 * Bản trước làm cái này thành bảng cấu hình sửa được, với tỉ lệ và dung sai cho
 * từng vai trò. Ảnh hãng Nhật ra đủ mọi tỉ lệ (0,71 · 1,33 · 2,42 · 3,81) nên
 * cách đó hoặc phải cắt ảnh, hoặc phải chừa viền, hoặc phải đẻ thêm khổ cho mỗi
 * tỉ lệ mới gặp. Ba con số cố định vừa đủ và không có gì để lệch về sau.
 */

export interface ImageBox {
  id: "hero" | "content" | "feature-small";
  label: string;
  maxWidth: number;
  maxHeight: number;
}

export type JapanVipImageLayout = "full" | "solo" | "grid-2" | "grid-4";

const HERO: ImageBox = { id: "hero", label: "Hero / lifestyle", maxWidth: 1200, maxHeight: 650 };
const CONTENT: ImageBox = { id: "content", label: "Mô tả & tính năng", maxWidth: 650, maxHeight: 650 };
const SMALL: ImageBox = { id: "feature-small", label: "Tính năng nhỏ", maxWidth: 300, maxHeight: 300 };

const BY_ROLE: Record<JapanVipImageRole, { box: ImageBox; layout: JapanVipImageLayout }> = {
  hero: { box: HERO, layout: "full" },
  "main-packshot": { box: CONTENT, layout: "solo" },
  "alternate-angle": { box: CONTENT, layout: "grid-2" },
  feature: { box: CONTENT, layout: "grid-2" },
  "feature-small": { box: SMALL, layout: "grid-4" },
  detail: { box: CONTENT, layout: "grid-2" },
  dimensions: { box: CONTENT, layout: "solo" },
  maintenance: { box: CONTENT, layout: "grid-2" },
};

/**
 * Nguồn phải đạt ít nhất chừng này so với khung thì ảnh mới còn nét. Dưới mức đó
 * ảnh vẫn dùng được nhưng không được TỰ duyệt, phải qua mắt người.
 * 0,9 chứ không phải 1,0 vì ảnh hãng hay lệch vài pixel (864×648 cho khung 650).
 */
const MIN_SOURCE_RATIO = 0.9;

export interface ResolvedFormat {
  box: ImageBox;
  layout: JapanVipImageLayout;
  /** Chiều rộng hiển thị sau khi thu cho vừa khung VÀ không phóng to. */
  displayWidth: number | null;
  /** Nguồn có đủ lớn cho khung không - điều kiện để được tự duyệt. */
  matches: boolean;
  reason: string;
}

export function resolveImageFormat(image: Pick<JapanVipContentImage, "width" | "height" | "role">): ResolvedFormat {
  const { box, layout: baseLayout } = BY_ROLE[image.role] ?? BY_ROLE.feature;
  // Ảnh dọc mà tràn hết chiều ngang bài thì cao bằng cả màn hình.
  const portrait = Boolean(image.width && image.height && image.width < image.height);
  const layout: JapanVipImageLayout = portrait && baseLayout === "full" ? "solo" : baseLayout;

  if (!image.width || !image.height) {
    return { box, layout, displayWidth: null, matches: false, reason: "chưa đọc được kích thước ảnh" };
  }

  const scale = Math.min(box.maxWidth / image.width, box.maxHeight / image.height, 1);
  // Đủ lớn theo CHIỀU BỊ KHUNG BÓ, không phải cả hai chiều: ảnh dọc 864×1222 vào
  // khung 650×650 bị bó bởi chiều cao, còn chiều rộng 864 thì dư sức.
  const bigEnough =
    scale >= 1 ||
    image.width >= Math.round(box.maxWidth * MIN_SOURCE_RATIO) ||
    image.height >= Math.round(box.maxHeight * MIN_SOURCE_RATIO);

  return {
    box,
    layout,
    displayWidth: Math.round(image.width * scale),
    matches: bigEnough,
    reason: bigEnough ? "" : `nguồn ${image.width}×${image.height} nhỏ hơn khung ${box.maxWidth}×${box.maxHeight}`,
  };
}

const ROLE_PRIORITY: Partial<Record<JapanVipImageRole, number>> = { hero: 3, "main-packshot": 2, dimensions: 2 };

/**
 * Loại bản trùng PC/mobile TRƯỚC KHI BỐ TRÍ.
 *
 * Khóa lấy từ TÊN FILE chứ không phải toàn bộ URL: bản PC và bản mobile của cùng
 * một hình trên trang Panasonic nằm ở hai nhánh đường dẫn khác hẳn nhau, so cả
 * URL thì không bao giờ trùng - đã thấy np-tz500-main-pc và -main-sp cùng lên
 * một bài.
 */
export function dedupeVariants<T extends Pick<JapanVipContentImage, "url" | "altText" | "width" | "height"> & { role?: JapanVipImageRole }>(images: T[]): T[] {
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

  // VAI TRÒ THẮNG DIỆN TÍCH: xếp thuần theo diện tích thì bản mobile to hơn hất
  // bản PC đã được gán làm hero, bài mất ảnh hero trong im lặng còn cổng kiểm
  // tra vẫn báo "đã có hero" vì nó soi danh sách chưa lọc.
  const rank = (image: T): number => ROLE_PRIORITY[image.role ?? "feature"] ?? 1;
  const best = new Map<string, T>();
  for (const image of images) {
    const id = key(image);
    const current = best.get(id);
    if (!current) { best.set(id, image); continue; }
    const area = (image.width ?? 0) * (image.height ?? 0);
    const currentArea = (current.width ?? 0) * (current.height ?? 0);
    if (rank(image) !== rank(current) ? rank(image) > rank(current) : area > currentArea) best.set(id, image);
  }
  const kept = new Set(best.values());
  return images.filter((image) => kept.has(image));
}
