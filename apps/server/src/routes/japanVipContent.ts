import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { Router } from "express";
import { extractArticleFromUrl } from "../article.js";
import { extractJson } from "../aiText.js";
import { generateJapanVipText, parseJapanVipAiProvider } from "../japanVipAi.js";
import {
  createJapanVipContent,
  deleteJapanVipContent,
  listJapanVipContent,
  readJapanVipContent,
  writeJapanVipContent,
  type JapanVipContentProject,
  type JapanVipContentStatus,
  type JapanVipImageRole,
  type JapanVipImageStatus,
  type JapanVipRevisionCategory,
} from "../japanVipContent.js";
import { HttpError, nowIso } from "../util.js";
import { addJapanVipLearningRule, findCopiedReferenceExcerpt, japanVipLearningContext, readJapanVipLearningLibrary, writeJapanVipLearningLibrary } from "../japanVipLearning.js";
import { runJapanVipCritic } from "../japanVipCritic.js";
import { discoverJapanVipImages } from "../japanVipImages.js";
import { researchOfficialProduct } from "../officialProductResearch.js";
import { applyLearnedImageSelection, getJapanVipImageLearningProfile, recordExplicitImageDecision, removeExplicitImageDecision } from "../japanVipImageLearning.js";
import { approveJapanVipProjectAsLearning, buildJapanVipPublicationZip, deactivateJapanVipProjectLearning, prepareJapanVipPublicationPackage, publicationFingerprint } from "../japanVipPublication.js";

const router = Router();
const STATUSES = new Set<JapanVipContentStatus>([
  "draft",
  "researching",
  "writing",
  "review",
  "approved",
]);
const IMAGE_ROLES = new Set<JapanVipImageRole>(["hero", "main-packshot", "alternate-angle", "feature", "feature-small", "detail", "dimensions", "maintenance"]);
const IMAGE_STATUSES = new Set<JapanVipImageStatus>(["pending", "approved", "rejected"]);
const REVISION_CATEGORIES = new Set<JapanVipRevisionCategory>(["cta", "naturalness", "claims", "repetition", "seo"]);
const REVISION_CATEGORY_LABELS: Record<JapanVipRevisionCategory, string> = {
  cta: "CTA và tư vấn mua hàng",
  naturalness: "câu mang văn phong dịch hoặc thiếu tự nhiên",
  claims: "claim, bằng chứng và giới hạn cần nêu rõ",
  repetition: "đoạn lặp, dài dòng hoặc trùng ý",
  seo: "tiêu đề, heading và cách dùng từ khóa SEO",
};

function articleFingerprint(article: string): string {
  return createHash("sha256").update(article).digest("hex");
}

function invalidateArticleApproval(project: JapanVipContentProject): void {
  project.publicationPackage = null;
  if (project.learningReferenceId) deactivateJapanVipProjectLearning(project.learningReferenceId);
  project.learningReferenceId = null;
  if (project.status === "approved") project.status = "review";
}

function exactOccurrenceCount(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (needle && (offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function imageWritingContext(project: JapanVipContentProject): string {
  const approved = project.images.filter((image) => image.status === "approved");
  if (!approved.length) return "Không có ảnh đã duyệt. Không tự chèn URL ảnh khác.";
  return [
    "MANIFEST ẢNH ĐÃ DUYỆT (chỉ được dùng các URL này, mỗi URL đúng một lần):",
    ...approved.map((image) => `- role=${image.role}; section=${image.intendedSection || "tự ghép theo ngữ cảnh"}; group=${image.featureGroup || "none"}; alt=${image.altText}; caption=${image.caption}; url=${image.url}`),
    "Ảnh hero đặt đầu bài. Ảnh feature/detail/dimensions/maintenance phải đặt sát phần nội dung thực sự giải thích đúng hình.",
    "Các ảnh role=feature-small phải gom theo group thành một bảng HTML responsive duy nhất cho mỗi group; không rải từng ảnh nhỏ thành các khối riêng.",
    "Không dùng ảnh pending/rejected, không lặp URL và không suy ra claim chỉ từ hình ảnh.",
  ].join("\n");
}

function textList(value: unknown, limit = 12): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, limit) : [];
}

async function runHermesReview(project: JapanVipContentProject) {
  if (!project.article.trim()) throw new HttpError(400, "NO_ARTICLE", "Cần viết bài trước khi Hermes chấm điểm");
  const approvedRules = readJapanVipLearningLibrary().rules.filter((rule) => rule.active).map((rule) => `- ${rule.text}`).join("\n");
  const prompt = [
    "Bạn là Hermes, giám khảo biên tập độc lập cho nội dung sản phẩm cao cấp của japanvip.vn.",
    "Không dùng công cụ, không bổ sung dữ kiện mới và không phê duyệt xuất bản.",
    "Chấm đúng 7 tiêu chí, mỗi tiêu chí tối đa 100 rồi tính totalScore là trung bình làm tròn.",
    "Tiêu chí: factual (chính xác và bám nguồn), structure (cấu trúc), naturalness (tiếng Việt tự nhiên), seo (ý định tìm kiếm), evidence (bằng chứng và giới hạn), originality (không lặp/không giống AI), conversion (tư vấn mua hàng).",
    "Phân biệt lỗi riêng của bài với quy tắc có thể tái sử dụng. suggestedRules chỉ là đề xuất, chưa được tự lưu.",
    "Trả JSON thuần theo schema: {\"totalScore\":0,\"verdict\":\"needs_work|good|excellent\",\"summary\":\"\",\"strengths\":[\"\"],\"issues\":[\"\"],\"revisionInstructions\":[\"\"],\"suggestedRules\":[\"\"],\"criteria\":[{\"key\":\"factual\",\"label\":\"Độ chính xác\",\"score\":0,\"maxScore\":100,\"feedback\":\"\"}] }.",
    `QUY TẮC ĐÃ ĐƯỢC CHỦ SỞ HỮU DUYỆT:\n${approvedRules || "Chưa có"}`,
    researchContext(project),
    `BÀI VIẾT CẦN CHẤM:\n${project.article.slice(0, 80_000)}`,
  ].join("\n\n");
  const critic = await runJapanVipCritic<Record<string, unknown>>({
    prompt,
    usageTag: "japanvip-article-review",
    isValid: (parsed) => Array.isArray(parsed.criteria),
  });
  const parsed = critic.parsed;
  const rawCriteria = parsed.criteria as unknown[];
  const criteria = rawCriteria.slice(0, 7).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      key: typeof row.key === "string" ? row.key.slice(0, 40) : "other",
      label: typeof row.label === "string" ? row.label.slice(0, 80) : "Tiêu chí",
      score: Math.max(0, Math.min(100, Math.round(Number(row.score) || 0))),
      maxScore: 100,
      feedback: typeof row.feedback === "string" ? row.feedback.trim().slice(0, 1_000) : "",
    };
  });
  const calculated = criteria.length ? Math.round(criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length) : 0;
  const review = {
    id: nanoid(10),
    round: (project.hermesReviews[0]?.round ?? 0) + 1,
    totalScore: calculated,
    verdict: (calculated >= 90 ? "excellent" : calculated >= 75 ? "good" : "needs_work") as "excellent" | "good" | "needs_work",
    summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 2_000) : "",
    strengths: textList(parsed.strengths),
    issues: textList(parsed.issues),
    revisionInstructions: textList(parsed.revisionInstructions),
    suggestedRules: textList(parsed.suggestedRules, 8),
    criteria,
    evaluator: critic.evaluator,
    createdAt: nowIso(),
  };
  project.hermesReviews.unshift(review);
  project.hermesReviews = project.hermesReviews.slice(0, 12);
  project.status = "review";
  writeJapanVipContent(project);
  return project;
}

function researchContext(project: JapanVipContentProject): string {
  const sources = project.sources
    .map(
      (s, i) =>
        `## NGUỒN ${i + 1}: ${s.title}\nURL: ${s.canonicalUrl ?? s.url}\n${s.text.slice(0, 18_000)}`,
    )
    .join("\n\n");
  const facts = project.facts.map((f) => `- ${f}`).join("\n");
  return [
    `Sản phẩm: ${project.name}`,
    `Model: ${project.productModel || "chưa xác định"}`,
    `Từ khóa mục tiêu: ${project.targetKeyword || "chưa xác định"}`,
    `Độc giả: ${project.audience}`,
    facts ? `FACT SHEET DO NGƯỜI DÙNG DUYỆT:\n${facts}` : "",
    sources ? `NỘI DUNG NGUỒN:\n${sources}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

router.get("/", (_req, res) => res.json(listJapanVipContent()));

router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const project = createJapanVipContent({
    name: typeof body.name === "string" ? body.name : "",
    productModel: typeof body.productModel === "string" ? body.productModel : "",
    primaryUrl: typeof body.primaryUrl === "string" ? body.primaryUrl : "",
  });
  res.status(201).json(project);
});

router.get("/image-learning/profile", (_req, res) => res.json(getJapanVipImageLearningProfile()));

router.post("/auto", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) throw new HttpError(400, "INVALID_OFFICIAL_URL", "Hãy dán URL sản phẩm chính hãng");
  const pages = await researchOfficialProduct(url);
  const primary = pages[0];
  const project = createJapanVipContent({ name: primary.title, primaryUrl: primary.url });
  project.aiProvider = parseJapanVipAiProvider(body.aiProvider, "codex");
  project.sources = pages.map((page) => ({
    id: nanoid(10), url: page.url, canonicalUrl: page.url, title: page.title,
    siteName: page.siteName, lang: page.lang, leadImage: page.leadImage,
    text: page.text.slice(0, 50_000), fetchedAt: nowIso(),
  }));
  project.selectedReferenceIds = readJapanVipLearningLibrary().articles
    .filter((article) => article.kind === "japanvip" && article.approvalStatus === "approved" && article.active)
    .map((article) => article.id)
    .slice(0, 12);
  project.status = "researching";
  project.notes = `Tạo tự động từ nguồn hãng: ${primary.url}. Đã thu thập ${pages.length} trang hãng và chọn ${project.selectedReferenceIds.length} bài Japan VIP đã duyệt làm mẫu phong cách.`;
  try {
    const discovered = await discoverJapanVipImages(primary.url);
    project.images = discovered.images.slice(0, 120).map((image) => ({
      id: nanoid(10), url: image.url, sourcePageUrl: discovered.pageUrl, sourceType: "official" as const,
      rightsBasis: "admin-attested-authorized-reseller", status: "pending" as const, role: "feature" as const,
      altText: image.alt.slice(0, 180), caption: "", intendedSection: "", featureGroup: "",
      width: image.width, height: image.height, discoveredAt: nowIso(),
    }));
  } catch {
    // Ảnh là bước duyệt riêng; không chặn việc tạo nội dung từ nguồn chữ hợp lệ.
  }
  writeJapanVipContent(project);
  try {
    const prompt = [
      "Bạn là Codex, biên tập viên chịu trách nhiệm cuối cùng cho japanvip.vn.",
      "Từ duy nhất gói nguồn chính hãng bên dưới, hãy nhận diện chính xác loại sản phẩm, thương hiệu, model/suffix; sau đó tạo dàn ý và bài Markdown tiếng Việt hoàn chỉnh trong MỘT lượt để tiết kiệm hạn mức.",
      "Bài Japan VIP đã duyệt chỉ dùng để học giọng tư vấn, cấu trúc và cách giải thích. Không sao chép câu chữ và không lấy chúng làm nguồn thông số.",
      "Không bịa giá, tồn kho, bảo hành, chứng nhận, trải nghiệm sử dụng hay công dụng. Claim chưa đủ điều kiện phải ghi [CẦN KIỂM CHỨNG].",
      "Nếu không xác định chắc chắn model từ nguồn hãng, để productModel rỗng; hệ thống sẽ dừng để người dùng kiểm tra.",
      "Trả JSON thuần: {\"name\":\"loại sản phẩm + thương hiệu + model\",\"productModel\":\"\",\"targetKeyword\":\"\",\"outline\":\"Markdown H2/H3\",\"article\":\"bài Markdown hoàn chỉnh\"}.",
      japanVipLearningContext(project.selectedReferenceIds),
      researchContext(project),
    ].join("\n\n");
    const ai = await generateJapanVipText(project.aiProvider, { prompt, usageTag: "japanvip-auto-official", projectId: project.id, timeoutMs: 7 * 60_000 });
    const parsed = extractJson<Record<string, unknown>>(ai.text);
    const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
    const productModel = typeof parsed?.productModel === "string" ? parsed.productModel.trim() : "";
    const targetKeyword = typeof parsed?.targetKeyword === "string" ? parsed.targetKeyword.trim() : "";
    const outline = typeof parsed?.outline === "string" ? parsed.outline.trim() : "";
    const article = typeof parsed?.article === "string" ? parsed.article.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/, "").trim() : "";
    if (!name || !productModel) throw new HttpError(422, "AUTO_IDENTITY_UNCERTAIN", `Đã tạo project “${project.name}” nhưng chưa khóa được model chính xác; hãy kiểm tra nguồn trước khi viết`);
    if (outline.length < 80 || article.length < 500) throw new HttpError(502, "AUTO_CONTENT_INCOMPLETE", `Đã tạo project “${project.name}” nhưng AI chưa trả đủ dàn ý và bài viết`);
    const copiedExcerpt = findCopiedReferenceExcerpt(article, project.selectedReferenceIds);
    if (copiedExcerpt) throw new HttpError(502, "AUTO_ARTICLE_TOO_SIMILAR", "Bài tự động lặp một câu dài từ bài mẫu nên đã bị chặn");
    project.name = name;
    project.productModel = productModel;
    project.targetKeyword = targetKeyword || name;
    project.outline = outline;
    project.article = article;
    applyLearnedImageSelection({ projectModel: project.productModel, primaryUrl: project.primaryUrl, images: project.images });
    project.status = "review";
    project.notes += " Nội dung đã tạo xong và đang chờ kiểm tra claim, ảnh và Hermes trước khi duyệt.";
    writeJapanVipContent(project);
    res.status(201).json(project);
  } catch (error) {
    project.status = "researching";
    project.notes += ` Quy trình tự động đã dừng: ${error instanceof Error ? error.message : String(error)}`;
    writeJapanVipContent(project);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "AUTO_CONTENT_FAILED", `Đã lưu project “${project.name}” nhưng AI chưa hoàn tất: ${error instanceof Error ? error.message : String(error)}`);
  }
});

router.post("/:id/approve-as-learning", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  project.learningReferenceId = approveJapanVipProjectAsLearning(project);
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/publication-package", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  project.publicationPackage = prepareJapanVipPublicationPackage(project);
  writeJapanVipContent(project);
  res.json(project);
});

router.get("/:id/publication-package/download", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const archive = buildJapanVipPublicationZip(project);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${project.publicationPackage?.fileName ?? `${project.id}-japanvip.zip`}"`);
  res.send(archive);
});

router.get("/:id", (req, res) => res.json(readJapanVipContent(req.params.id)));

router.patch("/:id", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const beforeArticle = project.article;
  const beforePublicationFingerprint = publicationFingerprint(project);
  const beforeLearningInput = JSON.stringify([project.name, project.productModel, project.targetKeyword, project.article]);
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const key of [
    "name",
    "productModel",
    "primaryUrl",
    "targetKeyword",
    "audience",
    "outline",
    "article",
    "notes",
  ] as const) {
    if (typeof body[key] === "string") project[key] = body[key].trim();
  }
  if (body.aiProvider !== undefined) project.aiProvider = parseJapanVipAiProvider(body.aiProvider, project.aiProvider);
  if (Array.isArray(body.facts)) {
    project.facts = body.facts
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 200);
  }
  if (Array.isArray(body.selectedReferenceIds)) {
    const allowed = new Set(readJapanVipLearningLibrary().articles.map((article) => article.id));
    project.selectedReferenceIds = body.selectedReferenceIds
      .filter((value): value is string => typeof value === "string" && allowed.has(value))
      .slice(0, 12);
  }
  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status as JapanVipContentStatus)) {
      throw new HttpError(400, "INVALID_STATUS", "Trạng thái Content Project không hợp lệ");
    }
    project.status = body.status as JapanVipContentStatus;
  }
  if (!project.name) throw new HttpError(400, "INVALID_NAME", "Tên project không được để trống");
  if (beforeArticle !== project.article) invalidateArticleApproval(project);
  if (project.publicationPackage && beforePublicationFingerprint !== publicationFingerprint(project)) project.publicationPackage = null;
  const learningInputChanged = beforeLearningInput !== JSON.stringify([project.name, project.productModel, project.targetKeyword, project.article]);
  if (project.learningReferenceId && (learningInputChanged || project.status !== "approved")) {
    deactivateJapanVipProjectLearning(project.learningReferenceId);
    project.learningReferenceId = null;
  }
  if (project.selectiveRevision && articleFingerprint(project.article) !== project.selectiveRevision.articleFingerprint) project.selectiveRevision = null;
  writeJapanVipContent(project);
  res.json(project);
});

router.delete("/:id", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  if (project.learningReferenceId) deactivateJapanVipProjectLearning(project.learningReferenceId);
  deleteJapanVipContent(req.params.id);
  res.status(204).end();
});

router.post("/:id/sources", async (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) throw new HttpError(400, "INVALID_URL", "Thiếu URL nguồn chính thức");
  if (project.sources.length >= 12) {
    throw new HttpError(400, "SOURCE_LIMIT", "Mỗi Content Project nhận tối đa 12 nguồn");
  }
  const article = await extractArticleFromUrl(url);
  const canonical = article.canonicalUrl ?? url;
  const exists = project.sources.some((s) => (s.canonicalUrl ?? s.url) === canonical);
  if (exists) throw new HttpError(409, "SOURCE_EXISTS", "Nguồn này đã có trong project");
  project.sources.push({
    id: nanoid(10),
    url,
    canonicalUrl: article.canonicalUrl,
    title: article.title,
    siteName: article.siteName,
    lang: article.lang,
    leadImage: article.leadImage,
    text: article.blocks.join("\n\n").slice(0, 50_000),
    fetchedAt: nowIso(),
  });
  if (!project.primaryUrl) project.primaryUrl = canonical;
  project.status = "researching";
  project.publicationPackage = null;
  writeJapanVipContent(project);
  res.status(201).json(project);
});

router.post("/:id/sources/manual", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!url) throw new HttpError(400, "INVALID_URL", "Thiếu URL của nguồn được dán thủ công");
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { throw new HttpError(400, "INVALID_URL", "URL nguồn không hợp lệ"); }
  if (text.length < 200) throw new HttpError(400, "MANUAL_SOURCE_TOO_SHORT", "Nội dung dán thủ công cần ít nhất 200 ký tự");
  if (project.sources.length >= 12) throw new HttpError(400, "SOURCE_LIMIT", "Mỗi Content Project nhận tối đa 12 nguồn");
  if (project.sources.some((source) => (source.canonicalUrl ?? source.url) === url)) {
    throw new HttpError(409, "SOURCE_EXISTS", "Nguồn này đã có trong project");
  }
  project.sources.push({
    id: nanoid(10), url, canonicalUrl: url,
    title: title || `Nguồn dán thủ công từ ${hostname}`,
    siteName: hostname, lang: null, leadImage: null,
    text: text.slice(0, 50_000), fetchedAt: nowIso(),
  });
  if (!project.primaryUrl) project.primaryUrl = url;
  project.status = "researching";
  project.publicationPackage = null;
  writeJapanVipContent(project);
  res.status(201).json(project);
});

router.delete("/:id/sources/:sourceId", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const next = project.sources.filter((s) => s.id !== req.params.sourceId);
  if (next.length === project.sources.length) {
    throw new HttpError(404, "SOURCE_NOT_FOUND", "Không tìm thấy nguồn cần xóa");
  }
  project.sources = next;
  project.publicationPackage = null;
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/images/discover", async (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const sourceType = body.sourceType === "owned" ? "owned" : body.sourceType === "reference-only" ? "reference-only" : "official";
  if (!url) throw new HttpError(400, "INVALID_IMAGE_SOURCE", "Thiếu URL trang ảnh của hãng");
  const discovered = await discoverJapanVipImages(url);
  const existing = new Set(project.images.map((image) => image.url));
  for (const image of discovered.images) {
    if (existing.has(image.url)) continue;
    project.images.push({
      id: nanoid(10), url: image.url, sourcePageUrl: discovered.pageUrl, sourceType,
      rightsBasis: sourceType === "official" ? "admin-attested-authorized-reseller" : sourceType === "owned" ? "business-owned" : "reference-only",
      status: "pending", role: "feature", altText: image.alt.slice(0, 180), caption: "", intendedSection: "", featureGroup: "",
      width: image.width, height: image.height, discoveredAt: nowIso(),
    });
  }
  project.images = project.images.slice(0, 240);
  applyLearnedImageSelection({ projectModel: project.productModel, primaryUrl: project.primaryUrl, images: project.images });
  project.publicationPackage = null;
  writeJapanVipContent(project);
  res.status(201).json(project);
});

router.patch("/:id/images/:imageId", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const image = project.images.find((item) => item.id === req.params.imageId);
  if (!image) throw new HttpError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh trong project");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const explicitDecision = body.status !== undefined || body.role !== undefined;
  if (typeof body.status === "string" && IMAGE_STATUSES.has(body.status as JapanVipImageStatus)) image.status = body.status as JapanVipImageStatus;
  if (typeof body.role === "string" && IMAGE_ROLES.has(body.role as JapanVipImageRole)) image.role = body.role as JapanVipImageRole;
  for (const key of ["altText", "caption", "intendedSection", "featureGroup"] as const) if (typeof body[key] === "string") image[key] = body[key].trim().slice(0, 500);
  if (explicitDecision) {
    image.selectionOrigin = "manual";
    image.selectionConfidence = null;
    image.selectionReason = "Chủ sở hữu đã lựa chọn thủ công";
    if (image.status === "pending") removeExplicitImageDecision(project.id, image.id);
    else recordExplicitImageDecision(project.id, image);
  }
  project.publicationPackage = null;
  writeJapanVipContent(project);
  res.json(project);
});

router.delete("/:id/images/:imageId", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const next = project.images.filter((item) => item.id !== req.params.imageId);
  if (next.length === project.images.length) throw new HttpError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh trong project");
  removeExplicitImageDecision(project.id, req.params.imageId);
  project.images = next;
  project.publicationPackage = null;
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/feedback", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "other";
  const saveAsRule = body.saveAsRule === true;
  if (!note) throw new HttpError(400, "INVALID_FEEDBACK", "Nội dung phản hồi không được để trống");
  if (project.feedback.length >= 100) throw new HttpError(400, "FEEDBACK_LIMIT", "Mỗi project nhận tối đa 100 phản hồi");
  const duplicate = project.feedback.find((item) => item.category.toLocaleLowerCase("vi") === category.toLocaleLowerCase("vi") && item.note.toLocaleLowerCase("vi") === note.toLocaleLowerCase("vi"));
  if (duplicate) throw new HttpError(409, "FEEDBACK_EXISTS", "Bài học này đã được lưu trong project");
  const rule = saveAsRule ? addJapanVipLearningRule(note, "feedback") : null;
  project.feedback.unshift({
    id: nanoid(10),
    category: category.slice(0, 80),
    note: note.slice(0, 1_000),
    savedAsRule: saveAsRule,
    ruleId: rule?.id ?? null,
    createdAt: nowIso(),
  });
  writeJapanVipContent(project);
  res.status(201).json(project);
});

router.delete("/:id/feedback/:feedbackId", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const feedback = project.feedback.find((item) => item.id === req.params.feedbackId);
  if (!feedback) throw new HttpError(404, "FEEDBACK_NOT_FOUND", "Không tìm thấy bài học cần xóa");
  project.feedback = project.feedback.filter((item) => item.id !== req.params.feedbackId);
  if (feedback.savedAsRule) {
    const stillUsed = project.feedback.some((item) => item.savedAsRule && item.note.toLocaleLowerCase("vi") === feedback.note.toLocaleLowerCase("vi"));
    if (!stillUsed) {
      const library = readJapanVipLearningLibrary();
      library.rules = library.rules.filter((rule) => feedback.ruleId ? rule.id !== feedback.ruleId : rule.text.toLocaleLowerCase("vi") !== feedback.note.toLocaleLowerCase("vi"));
      writeJapanVipLearningLibrary(library);
    }
  }
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/generate-outline", async (req, res) => {
  const project = readJapanVipContent(req.params.id);
  if (project.sources.length === 0 && project.facts.length === 0) {
    throw new HttpError(400, "NO_RESEARCH", "Cần ít nhất một nguồn hoặc một fact đã kiểm chứng");
  }
  const prompt = [
    "Bạn là biên tập viên nội dung sản phẩm cao cấp cho japanvip.vn.",
    "Hãy lập dàn ý SEO tiếng Việt tự nhiên, giàu thông tin, không sáo rỗng.",
    "Chỉ dùng dữ kiện có trong nguồn hoặc fact sheet; điểm chưa chắc chắn phải ghi [CẦN KIỂM CHỨNG].",
    "Không bịa giá, xuất xứ, bảo hành, chứng nhận hay công dụng.",
    "Nguồn chính thức và fact sheet là nguồn DUY NHẤT cho dữ kiện sản phẩm. Bài tham khảo chỉ dùng để học cách tổ chức và diễn đạt.",
    "Trả JSON thuần: {\"outline\": \"dàn ý Markdown với H2/H3\"}.",
    japanVipLearningContext(project.selectedReferenceIds),
    imageWritingContext(project),
    researchContext(project),
  ].join("\n\n");
  const ai = await generateJapanVipText(project.aiProvider, { prompt, usageTag: "japanvip-outline", projectId: project.id });
  const parsed = extractJson<{ outline?: unknown }>(ai.text);
  if (!parsed || typeof parsed.outline !== "string" || !parsed.outline.trim()) {
    throw new HttpError(502, "OUTLINE_PARSE_FAILED", "AI không trả về dàn ý hợp lệ");
  }
  project.outline = parsed.outline.trim();
  project.status = "writing";
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/generate-article", async (req, res) => {
  const project = readJapanVipContent(req.params.id);
  if (!project.outline.trim()) throw new HttpError(400, "NO_OUTLINE", "Cần có dàn ý trước khi viết bài");
  const prompt = [
    "Bạn là biên tập viên senior của japanvip.vn.",
    "Viết bài sản phẩm tiếng Việt hoàn chỉnh theo dàn ý, giọng tự nhiên, chuyên nghiệp, thuyết phục bằng thông tin.",
    "Chỉ dùng dữ kiện có trong nguồn hoặc fact sheet. Không biến suy luận thành sự thật.",
    "Nguồn chính thức và fact sheet là nguồn DUY NHẤT cho dữ kiện sản phẩm. Bài tham khảo chỉ dùng để học bố cục, nhịp điệu và cách giải thích.",
    "Không được sao chép nguyên câu hoặc mô phỏng quá sát bài tham khảo. Phải viết mới bằng giọng tự nhiên của Japan VIP.",
    "Mọi chỗ chưa đủ bằng chứng phải giữ nhãn [CẦN KIỂM CHỨNG]. Không tự tạo đánh giá khách hàng.",
    "Xuất Markdown thuần, không bọc code fence, không giải thích thêm.",
    `DÀN Ý:\n${project.outline}`,
    japanVipLearningContext(project.selectedReferenceIds),
    imageWritingContext(project),
    researchContext(project),
  ].join("\n\n");
  const ai = await generateJapanVipText(project.aiProvider, {
    prompt,
    usageTag: "japanvip-article",
    projectId: project.id,
    timeoutMs: 5 * 60_000,
  });
  const article = ai.text.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/, "").trim();
  if (article.length < 300) throw new HttpError(502, "ARTICLE_TOO_SHORT", "Bài AI trả về quá ngắn");
  const copiedExcerpt = findCopiedReferenceExcerpt(article, project.selectedReferenceIds);
  if (copiedExcerpt) {
    throw new HttpError(
      502,
      "ARTICLE_TOO_SIMILAR",
      `AI đã lặp lại một câu dài từ bài tham khảo (\"${copiedExcerpt}…\"). Hãy tạo lại bài để bảo đảm nội dung nguyên bản.`,
    );
  }
  invalidateArticleApproval(project);
  project.article = article;
  project.selectiveRevision = null;
  project.status = "review";
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/hermes-review", async (req, res) => {
  res.json(await runHermesReview(readJapanVipContent(req.params.id)));
});

router.post("/:id/revise-from-hermes", async (req, res) => {
  throw new HttpError(410, "FULL_REVISION_DISABLED", "Sửa toàn bài đã được tắt. Hãy dùng Sửa có chọn lọc để xem trước và áp dụng từng thay đổi.");
});

router.post("/:id/selective-revision/preview", async (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const review = project.hermesReviews[0];
  if (!review) throw new HttpError(400, "NO_HERMES_REVIEW", "Cần để Hermes phản biện trước khi sửa bài");
  if (!project.article.trim()) throw new HttpError(400, "NO_ARTICLE", "Cần có bài viết trước khi sửa chọn lọc");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const categories = Array.isArray(body.categories)
    ? [...new Set(body.categories.filter((value): value is JapanVipRevisionCategory => typeof value === "string" && REVISION_CATEGORIES.has(value as JapanVipRevisionCategory)))]
    : [];
  if (!categories.length) throw new HttpError(400, "NO_REVISION_CATEGORY", "Hãy chọn ít nhất một hạng mục cần sửa");
  const request = typeof body.request === "string" ? body.request.trim().slice(0, 2_000) : "";
  const prompt = [
    "Bạn là biên tập viên senior của japanvip.vn. Hãy đề xuất các chỉnh sửa CỤC BỘ theo phản biện Hermes.",
    "Không viết lại toàn bài. Chỉ trả tối đa 8 thay đổi thật sự cần thiết thuộc đúng hạng mục đã chọn.",
    "Mỗi before phải được chép NGUYÊN VĂN từ bài hiện tại, đủ dài để chỉ xuất hiện đúng một lần. after chỉ là đoạn thay thế tương ứng.",
    "Giữ nguyên mọi dữ kiện đúng; không bổ sung claim, giá, bảo hành, chứng nhận hoặc trải nghiệm chưa có trong nguồn chính thức/fact sheet.",
    "Không xóa ảnh, bảng thông số hoặc heading không thuộc hạng mục đã chọn. Không sao chép bài tham khảo.",
    "Trả JSON thuần: {\"changes\":[{\"category\":\"cta|naturalness|claims|repetition|seo\",\"before\":\"đoạn nguyên văn\",\"after\":\"đoạn thay thế\",\"reason\":\"lý do ngắn\"}] }.",
    `HẠNG MỤC ĐƯỢC CHỌN:\n${categories.map((category) => `- ${category}: ${REVISION_CATEGORY_LABELS[category]}`).join("\n")}`,
    request ? `YÊU CẦU RIÊNG CỦA BIÊN TẬP VIÊN:\n${request}` : "",
    `PHẢN BIỆN HERMES:\n${review.revisionInstructions.map((item) => `- ${item}`).join("\n")}`,
    japanVipLearningContext(project.selectedReferenceIds),
    researchContext(project),
    `BÀI HIỆN TẠI:\n${project.article}`,
  ].filter(Boolean).join("\n\n");
  const ai = await generateJapanVipText(project.aiProvider, { prompt, usageTag: "japanvip-selective-revision", projectId: project.id, timeoutMs: 5 * 60_000 });
  const parsed = extractJson<{ changes?: unknown }>(ai.text);
  if (!parsed || !Array.isArray(parsed.changes)) throw new HttpError(502, "SELECTIVE_REVISION_PARSE_FAILED", "AI không trả về danh sách thay đổi hợp lệ");

  const occupied: Array<{ start: number; end: number }> = [];
  let totalBeforeLength = 0;
  const changes = parsed.changes.slice(0, 8).flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const category = typeof row.category === "string" && categories.includes(row.category as JapanVipRevisionCategory) ? row.category as JapanVipRevisionCategory : null;
    const before = typeof row.before === "string" ? row.before.trim() : "";
    const after = typeof row.after === "string" ? row.after.trim() : "";
    const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, 500) : "";
    if (!category || before.length < 12 || before.length > 6_000 || !after || after.length > 8_000 || before === after) return [];
    if (exactOccurrenceCount(project.article, before) !== 1) return [];
    const start = project.article.indexOf(before);
    const end = start + before.length;
    if (occupied.some((range) => start < range.end && end > range.start)) return [];
    occupied.push({ start, end });
    totalBeforeLength += before.length;
    return [{ id: nanoid(10), category, before, after, reason }];
  });
  if (!changes.length) throw new HttpError(502, "NO_SAFE_SELECTIVE_CHANGES", "AI chưa tạo được thay đổi cục bộ an toàn. Hãy chọn hạng mục khác hoặc ghi yêu cầu cụ thể hơn.");
  if (totalBeforeLength > project.article.length * 0.45) throw new HttpError(502, "SELECTIVE_REVISION_TOO_LARGE", "Phạm vi AI đề xuất vượt 45% bài viết nên đã bị từ chối để tránh viết lại toàn bài.");
  project.selectiveRevision = {
    id: nanoid(10),
    reviewId: review.id,
    articleFingerprint: articleFingerprint(project.article),
    categories,
    request,
    changes,
    createdAt: nowIso(),
  };
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/selective-revision/apply", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const proposal = project.selectiveRevision;
  if (!proposal) throw new HttpError(400, "NO_SELECTIVE_REVISION", "Chưa có bản sửa chọn lọc để áp dụng");
  if (articleFingerprint(project.article) !== proposal.articleFingerprint) {
    throw new HttpError(409, "ARTICLE_CHANGED", "Bài viết đã thay đổi sau khi tạo bản xem trước. Hãy tạo lại đề xuất sửa để tránh ghi đè nhầm.");
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const requestedIds = new Set(Array.isArray(body.changeIds) ? body.changeIds.filter((value): value is string => typeof value === "string") : []);
  const selected = proposal.changes.filter((change) => requestedIds.has(change.id));
  if (!selected.length) throw new HttpError(400, "NO_SELECTED_CHANGES", "Hãy chọn ít nhất một thay đổi để áp dụng");
  const replacements = selected.map((change) => {
    if (exactOccurrenceCount(project.article, change.before) !== 1) throw new HttpError(409, "REVISION_TARGET_CHANGED", "Một đoạn cần sửa không còn khớp với bài hiện tại. Hãy tạo lại bản xem trước.");
    return { ...change, start: project.article.indexOf(change.before) };
  }).sort((a, b) => b.start - a.start);
  let article = project.article;
  for (const change of replacements) article = article.slice(0, change.start) + change.after + article.slice(change.start + change.before.length);
  const copiedExcerpt = findCopiedReferenceExcerpt(article, project.selectedReferenceIds);
  if (copiedExcerpt) throw new HttpError(502, "ARTICLE_TOO_SIMILAR", "Bản sửa lặp lại câu dài từ bài tham khảo");
  invalidateArticleApproval(project);
  project.article = article;
  project.selectiveRevision = null;
  project.status = "review";
  writeJapanVipContent(project);
  res.json(project);
});

router.delete("/:id/selective-revision", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  project.selectiveRevision = null;
  writeJapanVipContent(project);
  res.json(project);
});

export default router;
