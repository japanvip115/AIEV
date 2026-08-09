import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { paths } from "./config.js";
import { HttpError, ensureDir, nowIso } from "./util.js";

export type JapanVipReferenceKind = "competitor" | "inspiration" | "japanvip";

export interface JapanVipStyleAnalysis {
  summary: string;
  structure: string[];
  openingPatterns: string[];
  persuasionPatterns: string[];
  seoPatterns: string[];
  strengths: string[];
  weaknesses: string[];
  reusableLessons: string[];
  avoidCopying: string[];
}

export interface JapanVipLearningReviewCriterion {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  feedback: string;
}

export interface JapanVipLearningReview {
  totalScore: number;
  accuracyScore: number;
  verdict: "needs_work" | "good" | "excellent";
  summary: string;
  strengths: string[];
  issues: string[];
  criteria: JapanVipLearningReviewCriterion[];
  evaluator?: { provider: "ollama-cloud" | "hermes"; model: string; fallback: boolean };
  createdAt: string;
}

export interface JapanVipReferenceArticle {
  id: string;
  sourceProjectId?: string;
  kind: JapanVipReferenceKind;
  url: string;
  canonicalUrl: string | null;
  title: string;
  siteName: string | null;
  tags: string[];
  text: string;
  analysis: JapanVipStyleAnalysis;
  hermesReview: JapanVipLearningReview | null;
  approvalStatus: "pending" | "approved" | "rejected";
  approvedAt: string | null;
  improvementDraft?: {
    id: string;
    changes: Array<{ id: string; before: string; after: string; reason: string }>;
    improvedText: string;
    review: JapanVipLearningReview | null;
    provider?: "ollama-cloud" | "codex";
    round?: number;
    createdAt: string;
  } | null;
  approvedVariant?: "original" | "improved";
  active: boolean;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface JapanVipLearningRule {
  id: string;
  text: string;
  source: "manual" | "feedback";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JapanVipLearningLibrary {
  version: 1;
  articles: JapanVipReferenceArticle[];
  rules: JapanVipLearningRule[];
  updatedAt: string;
}

const EMPTY_ANALYSIS: JapanVipStyleAnalysis = {
  summary: "",
  structure: [],
  openingPatterns: [],
  persuasionPatterns: [],
  seoPatterns: [],
  strengths: [],
  weaknesses: [],
  reusableLessons: [],
  avoidCopying: [],
};

function libraryFile(): string {
  return path.join(paths.japanVipContentDir, "learning-library.json");
}

function cleanStrings(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeStyleAnalysis(value: unknown): JapanVipStyleAnalysis {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    structure: cleanStrings(raw.structure),
    openingPatterns: cleanStrings(raw.openingPatterns),
    persuasionPatterns: cleanStrings(raw.persuasionPatterns),
    seoPatterns: cleanStrings(raw.seoPatterns),
    strengths: cleanStrings(raw.strengths),
    weaknesses: cleanStrings(raw.weaknesses),
    reusableLessons: cleanStrings(raw.reusableLessons),
    avoidCopying: cleanStrings(raw.avoidCopying),
  };
}

export function readJapanVipLearningLibrary(): JapanVipLearningLibrary {
  ensureDir(paths.japanVipContentDir);
  const file = libraryFile();
  if (!fs.existsSync(file)) {
    return { version: 1, articles: [], rules: [], updatedAt: nowIso() };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<JapanVipLearningLibrary>;
    return {
      version: 1,
      articles: Array.isArray(parsed.articles)
        ? parsed.articles.map((article) => ({
            ...article,
            analysis: normalizeStyleAnalysis(article.analysis),
            hermesReview: normalizeLearningReview(article.hermesReview),
            approvalStatus: article.approvalStatus === "pending" || article.approvalStatus === "rejected"
              ? article.approvalStatus
              : "approved",
            approvedAt: typeof article.approvedAt === "string" ? article.approvedAt : null,
          }))
        : [],
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    };
  } catch {
    throw new HttpError(500, "JAPANVIP_LEARNING_CORRUPT", "Thư viện học nội dung bị hỏng");
  }
}

export function normalizeLearningReview(value: unknown): JapanVipLearningReview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const criteria = Array.isArray(raw.criteria) ? raw.criteria.slice(0, 6).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      key: typeof row.key === "string" ? row.key.slice(0, 40) : "other",
      label: typeof row.label === "string" ? row.label.slice(0, 80) : "Tiêu chí",
      score: Math.max(0, Math.min(100, Math.round(Number(row.score) || 0))),
      maxScore: 100,
      feedback: typeof row.feedback === "string" ? row.feedback.trim().slice(0, 1_000) : "",
    };
  }) : [];
  const accuracy = criteria.find((item) => item.key === "accuracy" || item.key === "factual")?.score;
  const totalScore = criteria.length
    ? Math.round(criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length)
    : Math.max(0, Math.min(100, Math.round(Number(raw.totalScore) || 0)));
  return {
    totalScore,
    accuracyScore: Math.max(0, Math.min(100, Math.round(Number(accuracy ?? raw.accuracyScore) || 0))),
    verdict: totalScore >= 90 ? "excellent" : totalScore >= 85 ? "good" : "needs_work",
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 2_000) : "",
    strengths: cleanStrings(raw.strengths, 12),
    issues: cleanStrings(raw.issues, 12),
    criteria,
    evaluator: raw.evaluator && typeof raw.evaluator === "object" ? {
      provider: (raw.evaluator as Record<string, unknown>).provider === "ollama-cloud" ? "ollama-cloud" : "hermes",
      model: typeof (raw.evaluator as Record<string, unknown>).model === "string" ? String((raw.evaluator as Record<string, unknown>).model) : "tencent/hy3:free",
      fallback: Boolean((raw.evaluator as Record<string, unknown>).fallback),
    } : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso(),
  };
}

export function writeJapanVipLearningLibrary(library: JapanVipLearningLibrary): void {
  ensureDir(paths.japanVipContentDir);
  library.updatedAt = nowIso();
  const file = libraryFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(library, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function addJapanVipLearningRule(text: string, source: JapanVipLearningRule["source"]): JapanVipLearningRule {
  const clean = text.trim();
  if (!clean) throw new HttpError(400, "INVALID_LEARNING_RULE", "Quy tắc học không được để trống");
  const library = readJapanVipLearningLibrary();
  const duplicate = library.rules.find((rule) => rule.text.toLocaleLowerCase("vi") === clean.toLocaleLowerCase("vi"));
  if (duplicate) return duplicate;
  const now = nowIso();
  const rule: JapanVipLearningRule = {
    id: nanoid(10),
    text: clean.slice(0, 1_000),
    source,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  library.rules.unshift(rule);
  writeJapanVipLearningLibrary(library);
  return rule;
}

export function emptyStyleAnalysis(): JapanVipStyleAnalysis {
  return { ...EMPTY_ANALYSIS };
}

export function japanVipLearningContext(selectedReferenceIds: string[]): string {
  const library = readJapanVipLearningLibrary();
  const selected = new Set(selectedReferenceIds);
  const articles = library.articles.filter((article) => article.active && (article.kind === "japanvip" || selected.has(article.id)));
  const rules = library.rules.filter((rule) => rule.active);
  const articleContext = articles.map((article, index) => {
    const analysis = article.analysis;
    const effectiveText = article.approvedVariant === "improved" && article.improvementDraft?.improvedText
      ? article.improvementDraft.improvedText
      : article.text;
    return [
      `### BÀI THAM KHẢO ${index + 1}: ${article.title}`,
      `Loại: ${article.kind}`,
      article.kind === "japanvip" ? "Ưu tiên: nguồn nội bộ Japan VIP đã được chủ sở hữu duyệt" : "",
      analysis.summary ? `Tóm tắt phong cách: ${analysis.summary}` : "",
      analysis.structure.length ? `Cấu trúc: ${analysis.structure.join(" | ")}` : "",
      analysis.openingPatterns.length ? `Cách mở bài: ${analysis.openingPatterns.join(" | ")}` : "",
      analysis.persuasionPatterns.length ? `Cách thuyết phục: ${analysis.persuasionPatterns.join(" | ")}` : "",
      analysis.seoPatterns.length ? `Cách triển khai SEO: ${analysis.seoPatterns.join(" | ")}` : "",
      analysis.reusableLessons.length ? `Bài học có thể áp dụng: ${analysis.reusableLessons.join(" | ")}` : "",
      analysis.weaknesses.length ? `Điểm cần làm tốt hơn: ${analysis.weaknesses.join(" | ")}` : "",
      analysis.avoidCopying.length ? `Không được sao chép: ${analysis.avoidCopying.join(" | ")}` : "",
      `Trích đoạn chỉ để nhận diện nhịp điệu, KHÔNG sao chép câu chữ:\n${effectiveText.slice(0, 3_000)}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  return [
    rules.length ? `QUY TẮC JAPAN VIP ĐÃ ĐƯỢC DUYỆT:\n${rules.map((rule) => `- ${rule.text}`).join("\n")}` : "",
    articleContext ? `HỒ SƠ PHONG CÁCH ĐƯỢC CHỌN:\n${articleContext}` : "",
    articleContext
      ? "Chỉ học nguyên tắc, bố cục và cách giải thích. Không sao chép câu, cụm từ đặc trưng, ví dụ, số liệu hay claim của bài tham khảo."
      : "",
  ].filter(Boolean).join("\n\n");
}

function comparable(value: string): string {
  return value.toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();
}

/** Chặn trường hợp AI chép nguyên một câu dài từ bài mẫu; không thay thế kiểm tra đạo văn chuyên dụng. */
export function findCopiedReferenceExcerpt(article: string, selectedReferenceIds: string[]): string | null {
  const selected = new Set(selectedReferenceIds);
  const output = comparable(article);
  for (const reference of readJapanVipLearningLibrary().articles) {
    if (!reference.active || (reference.kind !== "japanvip" && !selected.has(reference.id))) continue;
    const effectiveText = reference.approvedVariant === "improved" && reference.improvementDraft?.improvedText ? reference.improvementDraft.improvedText : reference.text;
    const candidates = effectiveText
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((sentence) => comparable(sentence))
      .filter((sentence) => sentence.length >= 120 && sentence.length <= 500);
    const copied = candidates.find((sentence) => output.includes(sentence));
    if (copied) return copied.slice(0, 180);
  }
  return null;
}
