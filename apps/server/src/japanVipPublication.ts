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

export function prepareJapanVipPublicationPackage(project: JapanVipContentProject) {
  const { review } = assertApprovedBase(project);
  const blockers = publicationBlockers(project);
  if (blockers.length) throw new HttpError(409, "JAPANVIP_PUBLICATION_BLOCKED", `Chưa thể tạo gói đăng: ${blockers.join("; ")}`);
  const slug = toKebabAscii(project.name).slice(0, 64) || project.id;
  return {
    fileName: `${slug}-japanvip.zip`,
    fingerprint: publicationFingerprint(project),
    reviewScore: review.totalScore,
    approvedImageCount: project.images.filter((image) => image.status === "approved").length,
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
    files: ["article.md", "article-package.json", "images.json", "sources-internal.json", "facts-internal.txt"],
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
  zip.addFile("README.txt", Buffer.from("Gói nháp đã được Japan VIP duyệt nội bộ. article.md là nội dung làm việc; images.json chứa URL ảnh hãng, caption, alt text và căn cứ quyền sử dụng. sources-internal.json và facts-internal.txt chỉ dùng đối chiếu nội bộ, không dán vào bài công khai. Gói này không tự đăng hoặc thay đổi trạng thái CMS.\n", "utf8"));
  zip.addFile("article.md", Buffer.from(project.article.trim() + "\n", "utf8"));
  zip.addFile("article-package.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
  zip.addFile("images.json", Buffer.from(JSON.stringify(imageManifest, null, 2) + "\n", "utf8"));
  zip.addFile("sources-internal.json", Buffer.from(JSON.stringify(sourceManifest, null, 2) + "\n", "utf8"));
  zip.addFile("facts-internal.txt", Buffer.from(project.facts.join("\n") + "\n", "utf8"));
  return zip.toBuffer();
}
