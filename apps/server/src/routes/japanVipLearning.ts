import { nanoid } from "nanoid";
import { Router } from "express";
import { extractArticleFromUrl } from "../article.js";
import { extractJson } from "../aiText.js";
import { generateJapanVipText, parseJapanVipAiProvider } from "../japanVipAi.js";
import { runJapanVipCritic } from "../japanVipCritic.js";
import {
  addJapanVipLearningRule,
  normalizeStyleAnalysis,
  normalizeLearningReview,
  readJapanVipLearningLibrary,
  writeJapanVipLearningLibrary,
  type JapanVipReferenceArticle,
  type JapanVipReferenceKind,
} from "../japanVipLearning.js";
import { HttpError, nowIso } from "../util.js";
import { getOllamaStatus } from "../ollamaText.js";
import { generateOllamaCloudText, getOllamaCloudStatus } from "../ollamaCloudText.js";

const router = Router();
const KINDS = new Set<JapanVipReferenceKind>(["competitor", "inspiration", "japanvip"]);
const JAPANVIP_APPROVAL_SCORE = 85;
const JAPANVIP_ACCURACY_SCORE = 80;

function publicLibrary() {
  const library = readJapanVipLearningLibrary();
  return {
    ...library,
    // Nội dung toàn bài chỉ lưu cục bộ để tạo context; UI chỉ cần metadata + phân tích.
    articles: library.articles.map((article) => ({
      ...article,
      text: "",
      improvementDraft: article.improvementDraft ? { ...article.improvementDraft, improvedText: "" } : article.improvementDraft,
    })),
  };
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
}

async function analyzeJapanVipArticle(text: string, title: string) {
  const prompt = [
    "Bạn là Hermes, giám khảo độc lập cho thư viện nội dung nội bộ japanvip.vn.",
    "Chỉ đánh giá bài đã xuất bản; không dùng công cụ, không bổ sung dữ kiện và không tự phê duyệt làm nguồn.",
    "Chấm đúng 6 tiêu chí theo thang 100: accuracy (độ chính xác và an toàn claim), depth (chiều sâu hữu ích), naturalness (tiếng Việt tự nhiên), structure (cấu trúc và trải nghiệm đọc), seo (ý định tìm kiếm), conversion (CTA và chuyển đổi).",
    "totalScore là trung bình cộng làm tròn. accuracyScore phải bằng điểm tiêu chí accuracy.",
    "Đồng thời phân tích kỹ thuật viết để tái sử dụng, tuyệt đối không sao chép câu chữ hoặc xem bài này là nguồn xác thực thông số sản phẩm.",
    "Trả JSON thuần gồm: totalScore, accuracyScore, summary, strengths, issues, criteria và analysis.",
    "criteria là mảng {key,label,score,maxScore,feedback}; analysis gồm structure, openingPatterns, persuasionPatterns, seoPatterns, strengths, weaknesses, reusableLessons, avoidCopying.",
    `TIÊU ĐỀ: ${title}`,
    `NỘI DUNG:\n${text.slice(0, 36_000)}`,
  ].join("\n\n");
  const result = await runJapanVipCritic<Record<string, unknown>>({
    prompt,
    usageTag: "japanvip-owned-review",
    isValid: (parsed) => Array.isArray(parsed.criteria) && parsed.criteria.length === 6,
  });
  const parsed = result.parsed;
  const review = normalizeLearningReview({ ...parsed, evaluator: result.evaluator, createdAt: nowIso() });
  if (!review) throw new HttpError(502, "JAPANVIP_REVIEW_PARSE_FAILED", "AI không trả về bảng chấm hợp lệ");
  return { review, analysis: normalizeStyleAnalysis(parsed.analysis) };
}

async function importJapanVipArticle(url: string, tags: string[]) {
  let hostname = "";
  try { hostname = new URL(url).hostname.toLocaleLowerCase("en"); } catch { /* handled below */ }
  if (hostname !== "japanvip.vn" && hostname !== "www.japanvip.vn") {
    throw new HttpError(400, "NOT_JAPANVIP_URL", "Nguồn nội bộ chỉ nhận URL thuộc japanvip.vn");
  }
  const library = readJapanVipLearningLibrary();
  if (library.articles.length >= 100) throw new HttpError(400, "REFERENCE_LIMIT", "Thư viện nhận tối đa 100 bài tham khảo");
  const extracted = await extractArticleFromUrl(url);
  const canonical = extracted.canonicalUrl ?? url;
  if (library.articles.some((article) => (article.canonicalUrl ?? article.url) === canonical)) {
    throw new HttpError(409, "REFERENCE_EXISTS", "Bài viết này đã có trong thư viện");
  }
  const text = extracted.blocks.join("\n\n").slice(0, 60_000);
  const { review, analysis } = await analyzeJapanVipArticle(text, extracted.title);
  if (!analysis.summary) analysis.summary = review.summary;
  const now = nowIso();
  const article: JapanVipReferenceArticle = {
    id: nanoid(10), kind: "japanvip", url, canonicalUrl: extracted.canonicalUrl,
    title: extracted.title, siteName: extracted.siteName, tags, text, analysis,
    hermesReview: review, approvalStatus: "pending", approvedAt: null, active: false,
    fetchedAt: now, createdAt: now, updatedAt: now,
  };
  library.articles.unshift(article);
  writeJapanVipLearningLibrary(library);
}

function buildImprovedCopy(original: string, rawChanges: unknown) {
  if (!Array.isArray(rawChanges)) throw new HttpError(502, "INVALID_IMPROVEMENT", "AI không trả về danh sách chỉnh sửa hợp lệ");
  const changes = rawChanges.slice(0, 8).map((value) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { id: nanoid(8), before: String(row.before ?? "").trim(), after: String(row.after ?? "").trim(), reason: String(row.reason ?? "").trim().slice(0, 500) };
  }).filter((change) => change.before && change.after && change.before !== change.after);
  if (!changes.length) throw new HttpError(502, "NO_IMPROVEMENTS", "AI chưa đề xuất được chỉnh sửa cục bộ");
  const positioned = changes.map((change) => {
    const first = original.indexOf(change.before);
    if (first < 0 || original.indexOf(change.before, first + change.before.length) >= 0) throw new HttpError(502, "IMPROVEMENT_NOT_EXACT", "Đoạn AI muốn sửa không khớp duy nhất với bản gốc");
    return { ...change, index: first };
  }).sort((a, b) => b.index - a.index);
  for (let i = 1; i < positioned.length; i += 1) {
    if (positioned[i - 1].index < positioned[i].index + positioned[i].before.length) throw new HttpError(502, "IMPROVEMENT_OVERLAP", "Các chỉnh sửa AI đề xuất bị chồng lấn");
  }
  if (positioned.reduce((sum, item) => sum + item.before.length, 0) > original.length * 0.35) throw new HttpError(502, "IMPROVEMENT_TOO_LARGE", "AI đề xuất thay quá nhiều nội dung; bản gốc được giữ nguyên");
  let improvedText = original;
  for (const change of positioned) improvedText = improvedText.slice(0, change.index) + change.after + improvedText.slice(change.index + change.before.length);
  return { changes: positioned.map(({ index: _index, ...change }) => change), improvedText };
}

router.get("/", (_req, res) => res.json(publicLibrary()));
router.get("/ai-status", async (_req, res) => {
  const [ollama, ollamaCloud] = await Promise.all([getOllamaStatus(), getOllamaCloudStatus()]);
  res.json({ ollama, ollamaCloud });
});

router.post("/japanvip-articles", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) throw new HttpError(400, "INVALID_URL", "Thiếu URL bài Japan VIP cần chấm");
  await importJapanVipArticle(url, cleanTags(body.tags));
  res.status(201).json(publicLibrary());
});

router.post("/articles", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind as JapanVipReferenceKind : "competitor";
  const aiProvider = parseJapanVipAiProvider(body.aiProvider);
  if (!url) throw new HttpError(400, "INVALID_URL", "Thiếu URL bài viết cần học");
  if (!KINDS.has(kind)) throw new HttpError(400, "INVALID_REFERENCE_KIND", "Loại bài tham khảo không hợp lệ");
  if (kind === "japanvip") throw new HttpError(400, "USE_JAPANVIP_REVIEW_FLOW", "Bài Japan VIP phải được nhập qua luồng Hermes chấm và duyệt");
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
  const ai = await generateJapanVipText(aiProvider, { prompt, usageTag: "japanvip-learn" });
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
    hermesReview: null,
    approvalStatus: "approved",
    approvedAt: now,
    active: true,
    fetchedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  library.articles.unshift(article);
  writeJapanVipLearningLibrary(library);
  res.status(201).json(publicLibrary());
});

router.post("/articles/:articleId/hermes-review", async (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article || article.kind !== "japanvip") throw new HttpError(404, "JAPANVIP_REFERENCE_NOT_FOUND", "Không tìm thấy bài Japan VIP");
  const result = await analyzeJapanVipArticle(article.text, article.title);
  article.hermesReview = result.review;
  article.analysis = result.analysis;
  article.approvalStatus = "pending";
  article.approvedAt = null;
  article.active = false;
  article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.post("/articles/:articleId/improve", async (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article || article.kind !== "japanvip") throw new HttpError(404, "JAPANVIP_REFERENCE_NOT_FOUND", "Không tìm thấy bài Japan VIP");
  const currentReview = article.improvementDraft?.review ?? article.hermesReview;
  const currentText = article.improvementDraft?.review ? article.improvementDraft.improvedText : article.text;
  const alreadyPasses = Boolean(currentReview && currentReview.totalScore >= JAPANVIP_APPROVAL_SCORE && currentReview.accuracyScore >= JAPANVIP_ACCURACY_SCORE);
  if (!currentReview || currentReview.totalScore < 75 || alreadyPasses) throw new HttpError(409, "NOT_NEAR_APPROVAL", "Chỉ cải thiện chọn lọc bài gần đạt nhưng chưa qua điều kiện duyệt");
  const lowFeedback = currentReview.criteria.filter((item) => item.score < 85).map((item) => `- ${item.label} ${item.score}/100: ${item.feedback}`).join("\n");
  const prompt = [
    "Bạn là biên tập viên Japan VIP. Chỉ đề xuất chỉnh sửa CỤC BỘ cho các tiêu chí điểm thấp.",
    "Không viết lại toàn bài, không đổi thông số/claim, không thêm dữ kiện mới. Mỗi before phải là đoạn trích nguyên văn xuất hiện đúng một lần trong bài gốc.",
    "Tối đa 8 thay đổi. Trả JSON thuần: {\"changes\":[{\"before\":\"\",\"after\":\"\",\"reason\":\"\"}]}",
    `ĐIỂM CẦN CẢI THIỆN:\n${lowFeedback}`,
    `BẢN ĐANG CẢI THIỆN (bài mẫu gốc vẫn bất biến):\n${currentText.slice(0, 60_000)}`,
  ].join("\n\n");
  const ai = await generateOllamaCloudText({ prompt, usageTag: "japanvip-selective-improvement", jsonMode: true });
  const parsed = extractJson<Record<string, unknown>>(ai.text);
  const built = buildImprovedCopy(currentText, parsed?.changes);
  article.improvementDraft = { id: nanoid(10), ...built, review: null, createdAt: nowIso() };
  article.approvalStatus = "pending"; article.active = false; article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.post("/articles/:articleId/improvement-review", async (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article?.improvementDraft) throw new HttpError(404, "IMPROVEMENT_NOT_FOUND", "Chưa có bản cải thiện để chấm");
  const result = await analyzeJapanVipArticle(article.improvementDraft.improvedText, article.title);
  article.improvementDraft.review = result.review; article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library); res.json(publicLibrary());
});

router.post("/articles/:articleId/approve", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article || article.kind !== "japanvip") throw new HttpError(404, "JAPANVIP_REFERENCE_NOT_FOUND", "Không tìm thấy bài Japan VIP");
  const review = article.improvementDraft?.review ?? article.hermesReview;
  if (!review || review.totalScore < JAPANVIP_APPROVAL_SCORE || review.accuracyScore < JAPANVIP_ACCURACY_SCORE) {
    throw new HttpError(409, "JAPANVIP_APPROVAL_GATE_FAILED", `Bài cần đạt tổng ${JAPANVIP_APPROVAL_SCORE}/100 và độ chính xác ${JAPANVIP_ACCURACY_SCORE}/100`);
  }
  article.approvalStatus = "approved";
  article.approvedVariant = article.improvementDraft?.review ? "improved" : "original";
  article.approvedAt = nowIso();
  article.active = true;
  article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.post("/articles/:articleId/reject", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article || article.kind !== "japanvip") throw new HttpError(404, "JAPANVIP_REFERENCE_NOT_FOUND", "Không tìm thấy bài Japan VIP");
  article.approvalStatus = "rejected";
  article.approvedAt = null;
  article.active = false;
  article.updatedAt = nowIso();
  writeJapanVipLearningLibrary(library);
  res.json(publicLibrary());
});

router.patch("/articles/:articleId", (req, res) => {
  const library = readJapanVipLearningLibrary();
  const article = library.articles.find((item) => item.id === req.params.articleId);
  if (!article) throw new HttpError(404, "REFERENCE_NOT_FOUND", "Không tìm thấy bài tham khảo");
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.active === "boolean" && article.kind !== "japanvip") article.active = body.active;
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
