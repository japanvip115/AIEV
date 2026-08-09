import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import type { JapanVipContentProject, JapanVipHermesCriterion } from "./japanVipContent.js";
import {
  emptyStyleAnalysis,
  readJapanVipLearningLibrary,
  writeJapanVipLearningLibrary,
  type JapanVipLearningReview,
  type JapanVipReferenceArticle,
} from "./japanVipLearning.js";
import {
  dedupeVariants,
  resolveImageFormat,
  type JapanVipImageLayout,
  type ResolvedFormat,
} from "./japanVipImageFormat.js";
import { HttpError, nowIso, toKebabAscii } from "./util.js";

const MIN_REVIEW_SCORE = 85;
const MIN_ACCURACY_SCORE = 80;

function latestReview(project: JapanVipContentProject) {
  const review = project.hermesReviews[0];
  if (!review) throw new HttpError(409, "JAPANVIP_REVIEW_REQUIRED", "Cần chấm bài trước khi duyệt làm mẫu hoặc tạo gói đăng");
  const accuracy = review.criteria.find((criterion) => criterion.key === "factual" || criterion.key === "accuracy")?.score ?? 0;
  if (review.totalScore < MIN_REVIEW_SCORE || accuracy < MIN_ACCURACY_SCORE) {
    throw new HttpError(409, "JAPANVIP_REVIEW_GATE_FAILED", `Bài cần đạt tối thiểu ${MIN_REVIEW_SCORE}/100 và độ chính xác ${MIN_ACCURACY_SCORE}/100`);
  }
  return { review, accuracy };
}

function assertApprovedBase(project: JapanVipContentProject) {
  if (project.status !== "approved") throw new HttpError(409, "JAPANVIP_PROJECT_NOT_APPROVED", "Cần đánh dấu bài đã duyệt trước");
  if (!project.productModel.trim()) throw new HttpError(409, "JAPANVIP_MODEL_REQUIRED", "Chưa khóa model chính xác của sản phẩm");
  if (project.article.trim().length < 500) throw new HttpError(409, "JAPANVIP_ARTICLE_REQUIRED", "Bài viết chưa đủ nội dung để làm mẫu hoặc đóng gói");
  return latestReview(project);
}

function criterion(reviewCriteria: JapanVipHermesCriterion[], key: string, fallback = 0) {
  return reviewCriteria.find((item) => item.key === key)?.score ?? fallback;
}

function learningReview(project: JapanVipContentProject): JapanVipLearningReview {
  const { review, accuracy } = assertApprovedBase(project);
  const criteria = [
    { key: "accuracy", label: "Độ chính xác và an toàn claim", score: accuracy, maxScore: 100, feedback: review.criteria.find((item) => item.key === "factual" || item.key === "accuracy")?.feedback ?? "" },
    { key: "depth", label: "Chiều sâu và bằng chứng", score: criterion(review.criteria, "evidence", review.totalScore), maxScore: 100, feedback: review.criteria.find((item) => item.key === "evidence")?.feedback ?? "" },
    { key: "naturalness", label: "Tiếng Việt tự nhiên", score: criterion(review.criteria, "naturalness", review.totalScore), maxScore: 100, feedback: review.criteria.find((item) => item.key === "naturalness")?.feedback ?? "" },
    { key: "structure", label: "Cấu trúc và trải nghiệm đọc", score: criterion(review.criteria, "structure", review.totalScore), maxScore: 100, feedback: review.criteria.find((item) => item.key === "structure")?.feedback ?? "" },
    { key: "seo", label: "Ý định tìm kiếm", score: criterion(review.criteria, "seo", review.totalScore), maxScore: 100, feedback: review.criteria.find((item) => item.key === "seo")?.feedback ?? "" },
    { key: "conversion", label: "CTA và chuyển đổi", score: criterion(review.criteria, "conversion", review.totalScore), maxScore: 100, feedback: review.criteria.find((item) => item.key === "conversion")?.feedback ?? "" },
  ];
  const totalScore = Math.round(criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length);
  return {
    totalScore,
    accuracyScore: accuracy,
    verdict: totalScore >= 90 ? "excellent" : "good",
    summary: review.summary,
    strengths: review.strengths,
    issues: review.issues,
    criteria,
    evaluator: review.evaluator,
    createdAt: review.createdAt,
  };
}

export function approveJapanVipProjectAsLearning(project: JapanVipContentProject): string {
  const review = learningReview(project);
  const library = readJapanVipLearningLibrary();
  const existing = library.articles.find((article) => article.sourceProjectId === project.id);
  if (!existing && library.articles.length >= 100) throw new HttpError(400, "REFERENCE_LIMIT", "Thư viện nhận tối đa 100 bài tham khảo");
  const latest = project.hermesReviews[0];
  const analysis = emptyStyleAnalysis();
  analysis.summary = latest.summary;
  analysis.structure = latest.criteria.filter((item) => item.key === "structure").map((item) => item.feedback).filter(Boolean);
  analysis.persuasionPatterns = latest.criteria.filter((item) => item.key === "conversion").map((item) => item.feedback).filter(Boolean);
  analysis.seoPatterns = latest.criteria.filter((item) => item.key === "seo").map((item) => item.feedback).filter(Boolean);
  analysis.strengths = latest.strengths;
  analysis.weaknesses = latest.issues;
  analysis.reusableLessons = project.feedback.filter((item) => item.savedAsRule).map((item) => item.note).slice(0, 20);
  analysis.avoidCopying = ["Không sao chép câu chữ, số liệu hoặc claim của bài mẫu sang sản phẩm khác"];
  const now = nowIso();
  const base: JapanVipReferenceArticle = {
    id: existing?.id ?? nanoid(10),
    sourceProjectId: project.id,
    kind: "japanvip",
    url: `/japanvip-content/${project.id}`,
    canonicalUrl: null,
    title: project.name,
    siteName: "Japan VIP Content nội bộ",
    tags: [project.productModel, project.targetKeyword].map((item) => item.trim()).filter(Boolean).slice(0, 12),
    text: project.article.slice(0, 60_000),
    analysis,
    hermesReview: review,
    approvalStatus: "approved",
    approvedAt: now,
    approvedVariant: "original",
    active: true,
    fetchedAt: project.updatedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existing) library.articles[library.articles.indexOf(existing)] = base;
  else library.articles.unshift(base);
  writeJapanVipLearningLibrary(library);
  return base.id;
}

export function deactivateJapanVipProjectLearning(referenceId: string): void {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === referenceId);
  if (!article) return;
  article.active = false;
  article.approvalStatus = "pending";
  article.approvedAt = null;
  article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
}

export function publicationFingerprint(project: JapanVipContentProject): string {
  const payload = {
    name: project.name,
    productModel: project.productModel,
    primaryUrl: project.primaryUrl,
    targetKeyword: project.targetKeyword,
    facts: project.facts,
    article: project.article,
    sources: project.sources.map((source) => [source.canonicalUrl ?? source.url, source.title]),
    images: project.images.filter((image) => image.status === "approved").map((image) => [image.url, image.role, image.altText, image.caption, image.intendedSection, image.featureGroup]),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function publicationBlockers(project: JapanVipContentProject): string[] {
  const blockers: string[] = [];
  if (!project.sources.length) blockers.push("chưa có nguồn chính thức");
  const unresolved = project.article.match(/\[CẦN KIỂM CHỨNG\]/gi)?.length ?? 0;
  if (unresolved) blockers.push(`còn ${unresolved} nhãn [CẦN KIỂM CHỨNG]`);
  const approvedImages = project.images.filter((image) => image.status === "approved");
  if (approvedImages.length < 5) blockers.push(`chỉ có ${approvedImages.length}/5 ảnh đã duyệt`);
  if (!approvedImages.some((image) => image.role === "hero")) blockers.push("chưa có ảnh hero đã duyệt");
  const duplicateUrls = approvedImages.filter((image, index) => approvedImages.findIndex((item) => item.url === image.url) !== index);
  if (duplicateUrls.length) blockers.push("có URL ảnh bị lặp");
  return blockers;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? escapeHtml(url.href) : "";
  } catch {
    return "";
  }
}

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, label: string, url: string) => {
    const safe = safeHttpUrl(url.replace(/&amp;/g, "&"));
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  return html;
}

function markdownTable(lines: string[]): string {
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inlineMarkdown(cell.trim()));
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return `<div class="jv-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** URL chuẩn hóa để tra ngược ảnh AI chèn trong Markdown về đúng ảnh trong kho. */
function imageKey(url: string): string {
  return url.trim().replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

function markdownToHtml(
  markdown: string,
  byUrl: Map<string, ArticleImage> = new Map(),
  used?: Set<string>
): string {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      // CMS và trang preview đã có H1 từ metadata project; bỏ H1 trong Markdown
      // để không lặp tiêu đề và giữ fragment đúng hợp đồng CMS.
      if (heading[1].length === 1) { index += 1; continue; }
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      const items = quote.filter((item) => /^[-*]\s+/.test(item));
      const title = quote.find((item) => item.trim() && !/^[-*]\s+/.test(item));
      out.push(`<aside class="jv-callout">${title ? `<p>${inlineMarkdown(title)}</p>` : ""}${items.length ? `<ul>${items.map((item) => `<li>${inlineMarkdown(item.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>` : ""}</aside>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ""));
      out.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ""));
      out.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) tableLines.push(lines[index++]);
      out.push(markdownTable(tableLines));
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (image) {
      const src = safeHttpUrl(image[2]);
      if (src) {
        // Ảnh AI chèn trong bài trước đây ra <figure> TRẦN - mất sạch vai trò,
        // nên khổ ảnh chỉ áp được cho ảnh hệ thống tự bố trí. Tra ngược URL về
        // ảnh trong kho là chỗ duy nhất đưa detail/maintenance vào đúng khổ.
        const known = byUrl.get(imageKey(image[2]));
        if (known) {
          used?.add(known.id);
          out.push(`<div style="margin:26px 0">${renderFigure(known)}</div>`);
        } else {
          out.push(renderUnknownFigure(src, image[1]));
        }
      }
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^\s*>|^\s*[-*]\s+|^\s*\d+\.\s+/.test(lines[index])) {
      if (lines[index].includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) break;
      paragraph.push(lines[index].trim()); index += 1;
    }
    out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}

type ArticleImage = JapanVipContentProject["images"][number];

/**
 * VÌ SAO KHỔ ẢNH VIẾT THẲNG VÀO `style` CHỨ KHÔNG PHẢI CLASS + STYLESHEET:
 * `article.html` trong gói đăng là FRAGMENT dán vào CMS japanvip.vn, còn thẻ
 * <style> thì chỉ nằm trong preview.html. Bố cục viết bằng class sống đúng ở bản
 * xem trước rồi chết ngay khi lên site thật - ảnh về mặc định của theme. Style
 * inline thì fragment tự mang khổ của nó đi đâu cũng được.
 *
 * Lưới dùng `repeat(auto-fit, minmax(...))` để co về một cột trên điện thoại mà
 * không cần media query - thứ duy nhất không viết inline được.
 */
function figureStyle(resolved: ResolvedFormat, image: ArticleImage): string {
  // width/height:auto + max-width/max-height = ảnh tự thu cho vừa khung, giữ
  // nguyên tỉ lệ, và KHÔNG BAO GIỜ phóng to (max-* chỉ thu nhỏ được). Không cần
  // aspect-ratio hay object-fit, nên cũng không có đường nào cắt vào ảnh.
  // width đặt CỤ THỂ chứ không phải auto: với auto, ảnh chiếm 0×0 cho tới khi
  // tải xong nên cả trang giật một nhịp khi ảnh về - thuộc tính width/height
  // trên thẻ chỉ giữ được chỗ khi trình duyệt đã biết một chiều. displayWidth
  // vốn đã bị chặn trên bởi kích thước thật nên vẫn không có đường phóng to.
  const width = resolved.displayWidth ?? resolved.box.maxWidth;
  return [
    "display:block",
    `width:${width}px`,
    "max-width:100%",
    "height:auto",
    `max-height:${resolved.box.maxHeight}px`,
    "margin:0 auto",
    "border-radius:14px",
    "background:#f8fafc",
  ].join(";");
}

function renderFigure(image: ArticleImage): string {
  const src = safeHttpUrl(image.url);
  if (!src) return "";
  const resolved = resolveImageFormat(image);
  const alt = escapeHtml(image.altText || image.caption || image.role);
  const caption = escapeHtml(image.caption || image.altText || "Ảnh chính thức từ hãng");
  const size = image.width && image.height ? ` width="${image.width}" height="${image.height}"` : "";
  const figureStyleAttr = resolved.layout === "full" ? "margin:0 0 26px" : "margin:0";
  return `<figure style="${figureStyleAttr}"><img src="${src}" alt="${alt}"${size} loading="lazy" decoding="async" style="${figureStyle(resolved, image)}"><figcaption style="text-align:center;color:#64748b;font-size:13px;margin-top:8px">${caption}</figcaption></figure>`;
}

/** Ảnh lạ (AI chèn URL ngoài manifest): vẫn hiện, nhưng không đoán khổ bừa. */
function renderUnknownFigure(src: string, alt: string): string {
  return `<figure style="margin:26px 0"><img src="${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:14px"><figcaption style="text-align:center;color:#64748b;font-size:13px;margin-top:8px">${escapeHtml(alt)}</figcaption></figure>`;
}

/** Số ảnh mỗi hàng trên màn rộng. Ảnh tính năng nhỏ gom 4 một hàng. */
const PER_ROW: Record<JapanVipImageLayout, number> = { full: 1, solo: 1, "grid-2": 2, "grid-4": 4 };

/**
 * Bọc một nhóm ảnh cùng vai trò thành lưới. Nhóm chỉ có MỘT ảnh thì không bọc -
 * đó chính là ý "một ảnh lớn hoặc lưới 2", không cần thêm giá trị cấu hình.
 */
function renderGroup(images: ArticleImage[]): string {
  if (!images.length) return "";
  const figures = images.map((image) => renderFigure(image)).filter(Boolean);
  if (figures.length <= 1) return figures.length ? `<div style="margin:26px 0">${figures[0]}</div>` : "";
  const perRow = PER_ROW[resolveImageFormat(images[0]).layout] ?? 2;
  // flex chứ không phải grid: `flex-basis` theo % cộng `min-width` cho đúng SỐ
  // ẢNH MỘT HÀNG trên màn rộng rồi tự rút bớt cột trên điện thoại - grid
  // auto-fit thì nhồi thêm cột khi còn chỗ, không giữ được đúng 4.
  const basis = `calc(${(100 / perRow).toFixed(4)}% - ${Math.round((14 * (perRow - 1)) / perRow)}px)`;
  const minWidth = perRow >= 4 ? 140 : 240;
  const cells = figures.map((figure) => `<div style="flex:1 1 ${basis};min-width:${minWidth}px">${figure}</div>`).join("");
  return `<div style="display:flex;flex-wrap:wrap;gap:14px;margin:26px 0">${cells}</div>`;
}

export function buildJapanVipArticleHtml(project: JapanVipContentProject): string {
  assertApprovedBase(project);
  // Lọc bản trùng PC/mobile trên TOÀN BÀI, không phải trong từng nhóm: bản PC
  // hay rơi vào vai trò hero còn bản mobile rơi vào lưới feature, lọc theo nhóm
  // thì hai bản của cùng một hình vẫn cùng lên bài ở hai chỗ khác nhau.
  const approved = dedupeVariants(project.images.filter((image) => image.status === "approved"));
  const byUrl = new Map(approved.map((image) => [imageKey(image.url), image]));
  // Ảnh AI đã tự chèn trong Markdown thì hệ thống KHÔNG bố trí lại lần nữa,
  // nếu không cùng một hình xuất hiện hai lần trong bài.
  const used = new Set<string>();
  let body = markdownToHtml(project.article.trim(), byUrl, used);

  const remaining = (role: ArticleImage["role"]) => approved.filter((image) => image.role === role && !used.has(image.id));
  const hero = remaining("hero")[0];
  const packshot = remaining("main-packshot")[0];
  const feature = [...remaining("feature"), ...remaining("feature-small")];
  const installation = [...remaining("alternate-angle"), ...remaining("dimensions")];

  if (packshot) {
    used.add(packshot.id);
    body = body.replace(/<\/p>/, `</p><div style="margin:26px 0">${renderFigure(packshot)}</div>`);
  }

  const featureGallery = renderGroup(feature);
  if (featureGallery) {
    for (const image of feature) used.add(image.id);
    const featureHeading = /(<h2>[^<]*(?:đáng chú ý|tính năng)[^<]*<\/h2>)/i;
    body = featureHeading.test(body) ? body.replace(featureHeading, `$1${featureGallery}`) : `${featureGallery}${body}`;
  }

  const installGallery = renderGroup(installation);
  if (installGallery) {
    for (const image of installation) used.add(image.id);
    const installHeading = /(<h2>[^<]*(?:kiểm tra|lắp đặt)[^<]*<\/h2>)/i;
    body = installHeading.test(body) ? body.replace(installHeading, `${installGallery}$1`) : `${body}${installGallery}`;
  }

  const heroHtml = hero ? renderFigure(hero) : "";
  return `<article class="jv-article">${heroHtml}${body}</article>`;
}

/**
 * Ảnh đã duyệt nhưng không xuất hiện trong bài.
 *
 * Không tự nhét vào - bài viết không bắt buộc dùng hết ảnh đã duyệt. Nhưng cũng
 * không để nó biến mất trong im lặng: liệt kê ra lúc kiểm tra gói đăng.
 */
export function unusedApprovedImages(project: JapanVipContentProject): ArticleImage[] {
  const approved = dedupeVariants(project.images.filter((image) => image.status === "approved"));
  const byUrl = new Map(approved.map((image) => [imageKey(image.url), image]));
  const used = new Set<string>();
  markdownToHtml(project.article.trim(), byUrl, used);
  const autoPlaced = new Set(["hero", "main-packshot", "alternate-angle", "feature", "feature-small", "dimensions"]);
  return approved.filter((image) => !used.has(image.id) && !autoPlaced.has(image.role));
}


export function buildJapanVipPreviewHtml(project: JapanVipContentProject): string {
  const article = buildJapanVipArticleHtml(project);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(project.name)} — Bản xem trước</title><style>
  :root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202124;background:#f4f5f7}*{box-sizing:border-box}body{margin:0}.jv-preview-head{padding:16px 22px;background:#111827;color:#fff;position:sticky;top:0;z-index:2}.jv-preview-head strong{display:block;font-size:15px}.jv-preview-head span{font-size:12px;color:#cbd5e1}.jv-shell{max-width:980px;margin:28px auto;padding:0 18px}.jv-title{font-size:clamp(28px,4vw,44px);line-height:1.15;margin:0 0 24px}.jv-article{background:#fff;border-radius:18px;padding:clamp(20px,4vw,52px);box-shadow:0 12px 38px rgba(15,23,42,.08)}.jv-article h2{font-size:clamp(23px,3vw,32px);line-height:1.25;margin:42px 0 14px}.jv-article h3{font-size:21px;line-height:1.35;margin:30px 0 10px}.jv-article p,.jv-article li{font-size:17px;line-height:1.8}.jv-article ul,.jv-article ol{padding-left:24px}.jv-article a{color:#d9272e}.jv-article figure{margin:26px 0}.jv-article img{display:block;max-width:100%;height:auto;border-radius:14px;background:#f8fafc}.jv-article figcaption{text-align:center;color:#64748b;font-size:13px;margin-top:8px}.jv-hero{margin-top:0!important}.jv-callout{margin:28px 0;padding:20px 24px;border-left:5px solid #ef3e46;border-radius:12px;background:#fff1f2}.jv-callout p{margin-top:0;font-weight:700}.jv-table-wrap{overflow-x:auto;margin:24px 0}table{width:100%;border-collapse:collapse;font-size:15px}th,td{padding:13px 14px;border:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f8fafc}@media(max-width:680px){.jv-shell{padding:0;margin:0}.jv-article{border-radius:0;padding:22px}.jv-preview-head{position:static}}
  </style></head><body><div class="jv-preview-head"><strong>Bản xem trước HTML — chưa đăng lên website</strong><span>${escapeHtml(project.productModel)} · Hermes ${project.hermesReviews[0]?.totalScore ?? 0}/100 · ${project.images.filter((image) => image.status === "approved").length} ảnh đã duyệt</span></div><main class="jv-shell"><h1 class="jv-title">${escapeHtml(project.name)}</h1>${article}</main></body></html>`;
}

export function prepareJapanVipPublicationPackage(project: JapanVipContentProject) {
  const { review } = assertApprovedBase(project);
  const blockers = publicationBlockers(project);
  if (blockers.length) throw new HttpError(409, "JAPANVIP_PUBLICATION_BLOCKED", `Chưa thể tạo gói đăng: ${blockers.join("; ")}`);
  const slug = toKebabAscii(project.name).slice(0, 64) || project.id;
  const unused = unusedApprovedImages(project);
  return {
    fileName: `${slug}-japanvip.zip`,
    fingerprint: publicationFingerprint(project),
    reviewScore: review.totalScore,
    approvedImageCount: project.images.filter((image) => image.status === "approved").length,
    // Cảnh báo chứ không chặn: bài không bắt buộc dùng hết ảnh đã duyệt, nhưng
    // ảnh rơi ra ngoài thì phải nhìn thấy được.
    unusedImages: unused.map((image) => ({ id: image.id, role: image.role, altText: image.altText })),
    generatedAt: nowIso(),
  };
}

export function buildJapanVipPublicationZip(project: JapanVipContentProject): Buffer {
  assertApprovedBase(project);
  const prepared = project.publicationPackage;
  if (!prepared || prepared.fingerprint !== publicationFingerprint(project)) {
    throw new HttpError(409, "JAPANVIP_PACKAGE_STALE", "Gói đăng chưa được tạo hoặc nội dung đã thay đổi; hãy chuẩn bị lại gói đăng");
  }
  const approvedImages = project.images.filter((image) => image.status === "approved");
  const manifest = {
    schemaVersion: 1,
    projectId: project.id,
    title: project.name,
    productModel: project.productModel,
    primaryUrl: project.primaryUrl,
    targetKeyword: project.targetKeyword,
    audience: project.audience,
    reviewScore: prepared.reviewScore,
    generatedAt: prepared.generatedAt,
    files: ["article.md", "article.html", "preview.html", "article-package.json", "images.json", "sources-internal.json", "facts-internal.txt"],
  };
  const imageManifest = approvedImages.map((image) => ({
    role: image.role,
    url: image.url,
    altText: image.altText,
    caption: image.caption,
    intendedSection: image.intendedSection,
    featureGroup: image.featureGroup,
    sourcePageUrl: image.sourcePageUrl,
    rightsBasis: image.rightsBasis,
    width: image.width,
    height: image.height,
  }));
  const sourceManifest = project.sources.map((source) => ({
    title: source.title,
    url: source.canonicalUrl ?? source.url,
    siteName: source.siteName,
    fetchedAt: source.fetchedAt,
  }));
  const zip = new AdmZip();
  zip.addFile("README.txt", Buffer.from("Gói nháp đã được Japan VIP duyệt nội bộ. Mở preview.html để đọc và kiểm tra bố cục hoàn chỉnh. article.html là fragment HTML dùng cho CMS; article.md là nội dung làm việc. images.json chứa URL ảnh hãng, caption, alt text và căn cứ quyền sử dụng. sources-internal.json và facts-internal.txt chỉ dùng đối chiếu nội bộ, không dán vào bài công khai. Gói này không tự đăng hoặc thay đổi trạng thái CMS.\n", "utf8"));
  zip.addFile("article.md", Buffer.from(project.article.trim() + "\n", "utf8"));
  zip.addFile("article.html", Buffer.from(buildJapanVipArticleHtml(project) + "\n", "utf8"));
  zip.addFile("preview.html", Buffer.from(buildJapanVipPreviewHtml(project) + "\n", "utf8"));
  zip.addFile("article-package.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
  zip.addFile("images.json", Buffer.from(JSON.stringify(imageManifest, null, 2) + "\n", "utf8"));
  zip.addFile("sources-internal.json", Buffer.from(JSON.stringify(sourceManifest, null, 2) + "\n", "utf8"));
  zip.addFile("facts-internal.txt", Buffer.from(project.facts.join("\n") + "\n", "utf8"));
  return zip.toBuffer();
}
