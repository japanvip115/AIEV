import { nanoid } from "nanoid";
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
} from "../japanVipContent.js";
import { HttpError, nowIso } from "../util.js";
import { addJapanVipLearningRule, findCopiedReferenceExcerpt, japanVipLearningContext, readJapanVipLearningLibrary, writeJapanVipLearningLibrary } from "../japanVipLearning.js";
import { askHermesCritic } from "../hermesCritic.js";
import { discoverJapanVipImages } from "../japanVipImages.js";

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
  const raw = await askHermesCritic(prompt);
  const parsed = extractJson<Record<string, unknown>>(raw);
  if (!parsed || !Array.isArray(parsed.criteria)) throw new HttpError(502, "HERMES_REVIEW_PARSE_FAILED", "Hermes không trả về bảng chấm điểm hợp lệ");
  const criteria = parsed.criteria.slice(0, 7).map((item) => {
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

router.get("/:id", (req, res) => res.json(readJapanVipContent(req.params.id)));

router.patch("/:id", (req, res) => {
  const project = readJapanVipContent(req.params.id);
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
  writeJapanVipContent(project);
  res.json(project);
});

router.delete("/:id", (req, res) => {
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
  writeJapanVipContent(project);
  res.status(201).json(project);
});

router.patch("/:id/images/:imageId", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const image = project.images.find((item) => item.id === req.params.imageId);
  if (!image) throw new HttpError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh trong project");
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.status === "string" && IMAGE_STATUSES.has(body.status as JapanVipImageStatus)) image.status = body.status as JapanVipImageStatus;
  if (typeof body.role === "string" && IMAGE_ROLES.has(body.role as JapanVipImageRole)) image.role = body.role as JapanVipImageRole;
  for (const key of ["altText", "caption", "intendedSection", "featureGroup"] as const) if (typeof body[key] === "string") image[key] = body[key].trim().slice(0, 500);
  writeJapanVipContent(project);
  res.json(project);
});

router.delete("/:id/images/:imageId", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const next = project.images.filter((item) => item.id !== req.params.imageId);
  if (next.length === project.images.length) throw new HttpError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh trong project");
  project.images = next;
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
  project.article = article;
  project.status = "review";
  writeJapanVipContent(project);
  res.json(project);
});

router.post("/:id/hermes-review", async (req, res) => {
  res.json(await runHermesReview(readJapanVipContent(req.params.id)));
});

router.post("/:id/revise-from-hermes", async (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const review = project.hermesReviews[0];
  if (!review) throw new HttpError(400, "NO_HERMES_REVIEW", "Cần để Hermes phản biện trước khi sửa bài");
  const prompt = [
    "Bạn là biên tập viên senior của japanvip.vn. Hãy sửa bài theo phản biện Hermes bên dưới.",
    "Giữ nguyên mọi dữ kiện đúng; không bổ sung claim, giá, bảo hành, chứng nhận hoặc trải nghiệm chưa có trong nguồn chính thức/fact sheet.",
    "Không sao chép bài tham khảo. Xuất Markdown thuần, không giải thích và không bọc code fence.",
    `PHẢN BIỆN HERMES:\n${review.revisionInstructions.map((item) => `- ${item}`).join("\n")}`,
    japanVipLearningContext(project.selectedReferenceIds),
    researchContext(project),
    `BÀI HIỆN TẠI:\n${project.article}`,
  ].join("\n\n");
  const ai = await generateJapanVipText(project.aiProvider, { prompt, usageTag: "japanvip-hermes-revision", projectId: project.id, timeoutMs: 5 * 60_000 });
  const article = ai.text.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/, "").trim();
  if (article.length < 300) throw new HttpError(502, "ARTICLE_TOO_SHORT", "Bản sửa AI trả về quá ngắn");
  const copiedExcerpt = findCopiedReferenceExcerpt(article, project.selectedReferenceIds);
  if (copiedExcerpt) throw new HttpError(502, "ARTICLE_TOO_SIMILAR", "Bản sửa lặp lại câu dài từ bài tham khảo");
  project.article = article;
  project.status = "review";
  writeJapanVipContent(project);
  res.json(project);
});

export default router;
