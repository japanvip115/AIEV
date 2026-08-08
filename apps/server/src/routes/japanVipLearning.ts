import { nanoid } from "nanoid";
import { Router } from "express";
import { extractArticleFromUrl } from "../article.js";
import { extractJson } from "../aiText.js";
import { generateCodexText } from "../codexText.js";
import {
  addJapanVipLearningRule,
  normalizeStyleAnalysis,
  readJapanVipLearningLibrary,
  writeJapanVipLearningLibrary,
  type JapanVipReferenceArticle,
  type JapanVipReferenceKind,
} from "../japanVipLearning.js";
import { HttpError, nowIso } from "../util.js";

const router = Router();
const KINDS = new Set<JapanVipReferenceKind>(["competitor", "inspiration", "japanvip"]);

function publicLibrary() {
  const library = readJapanVipLearningLibrary();
  return {
    ...library,
    // Nội dung toàn bài chỉ lưu cục bộ để tạo context; UI chỉ cần metadata + phân tích.
    articles: library.articles.map((article) => ({ ...article, text: "" })),
  };
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
}

router.get("/", (_req, res) => res.json(publicLibrary()));

router.post("/articles", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind as JapanVipReferenceKind : "competitor";
  if (!url) throw new HttpError(400, "INVALID_URL", "Thiếu URL bài viết cần học");
  if (!KINDS.has(kind)) throw new HttpError(400, "INVALID_REFERENCE_KIND", "Loại bài tham khảo không hợp lệ");
  const library = readJapanVipLearningLibrary();
  if (library.articles.length >= 100) throw new HttpError(400, "REFERENCE_LIMIT", "Thư viện nhận tối đa 100 bài tham khảo");
  const extracted = await extractArticleFromUrl(url);
  const canonical = extracted.canonicalUrl ?? url;
  if (library.articles.some((article) => (article.canonicalUrl ?? article.url) === canonical)) {
    throw new HttpError(409, "REFERENCE_EXISTS", "Bài viết này đã có trong thư viện");
  }
  const text = extracted.blocks.join("\n\n").slice(0, 60_000);
  const prompt = [
    "Bạn là chiến lược gia nội dung cấp cao của Japan VIP.",
    "Phân tích KỸ THUẬT VIẾT của bài dưới đây, không xác nhận thông tin sản phẩm và không sao chép câu chữ.",
    "Tập trung vào cấu trúc, mở bài, cách biến tính năng thành lợi ích, SEO, sức thuyết phục, điểm mạnh và khoảng trống có thể làm tốt hơn.",
    "Trả JSON thuần với các khóa: summary (string), structure, openingPatterns, persuasionPatterns, seoPatterns, strengths, weaknesses, reusableLessons, avoidCopying (đều là mảng string).",
    `TIÊU ĐỀ: ${extracted.title}`,
    `LOẠI TÀI LIỆU: ${kind}`,
    `NỘI DUNG:\n${text.slice(0, 24_000)}`,
  ].join("\n\n");
  const ai = await generateCodexText({ prompt, usageTag: "japanvip-learn" });
  const parsed = extractJson<Record<string, unknown>>(ai.text);
  if (!parsed) throw new HttpError(502, "REFERENCE_ANALYSIS_FAILED", "AI không trả về phân tích bài viết hợp lệ");
  const now = nowIso();
  const article: JapanVipReferenceArticle = {
    id: nanoid(10),
    kind,
    url,
    canonicalUrl: extracted.canonicalUrl,
    title: extracted.title,
    siteName: extracted.siteName,
    tags: cleanTags(body.tags),
    text,
    analysis: normalizeStyleAnalysis(parsed),
    active: true,
    fetchedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  library.articles.unshift(article);
  writeJapanVipLearningLibrary(library);
  res.status(201).json(publicLibrary());
});

router.patch("/articles/:articleId", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article) throw new HttpError(404, "REFERENCE_NOT_FOUND", "Không tìm thấy bài tham khảo");
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.active === "boolean") article.active = body.active;
  if (typeof body.kind === "string" && KINDS.has(body.kind as JapanVipReferenceKind)) article.kind = body.kind as JapanVipReferenceKind;
  if (Array.isArray(body.tags)) article.tags = cleanTags(body.tags);
  article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.delete("/articles/:articleId", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const next = library.articles.filter((item) => item.id !== req.params.articleId);
  if (next.length === library.articles.length) throw new HttpError(404, "REFERENCE_NOT_FOUND", "Không tìm thấy bài tham khảo");
  library.articles = next;
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.post("/rules", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  addJapanVipLearningRule(typeof body.text === "string" ? body.text : "", "manual");
  res.status(201).json(publicLibrary());
});

router.patch("/rules/:ruleId", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const rule = library.rules.find((item) => item.id === req.params.ruleId);
  if (!rule) throw new HttpError(404, "LEARNING_RULE_NOT_FOUND", "Không tìm thấy quy tắc");
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.active === "boolean") rule.active = body.active;
  if (typeof body.text === "string" && body.text.trim()) rule.text = body.text.trim().slice(0, 1_000);
  rule.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.delete("/rules/:ruleId", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const next = library.rules.filter((item) => item.id !== req.params.ruleId);
  if (next.length === library.rules.length) throw new HttpError(404, "LEARNING_RULE_NOT_FOUND", "Không tìm thấy quy tắc");
  library.rules = next;
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

export default router;
