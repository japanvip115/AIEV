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
} from "../japanVipContent.js";
import { HttpError, nowIso } from "../util.js";
import { addJapanVipLearningRule, findCopiedReferenceExcerpt, japanVipLearningContext, readJapanVipLearningLibrary } from "../japanVipLearning.js";

const router = Router();
const STATUSES = new Set<JapanVipContentStatus>([
  "draft",
  "researching",
  "writing",
  "review",
  "approved",
]);

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

router.post("/:id/feedback", (req, res) => {
  const project = readJapanVipContent(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "other";
  const saveAsRule = body.saveAsRule === true;
  if (!note) throw new HttpError(400, "INVALID_FEEDBACK", "Nội dung phản hồi không được để trống");
  if (project.feedback.length >= 100) throw new HttpError(400, "FEEDBACK_LIMIT", "Mỗi project nhận tối đa 100 phản hồi");
  if (saveAsRule) addJapanVipLearningRule(note, "feedback");
  project.feedback.unshift({
    id: nanoid(10),
    category: category.slice(0, 80),
    note: note.slice(0, 1_000),
    savedAsRule: saveAsRule,
    createdAt: nowIso(),
  });
  writeJapanVipContent(project);
  res.status(201).json(project);
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

export default router;
