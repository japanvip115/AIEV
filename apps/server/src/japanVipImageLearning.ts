import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import type { JapanVipContentImage, JapanVipImageRole } from "./japanVipContent.js";
import { ensureDir, nowIso } from "./util.js";

interface ImageDecision {
  projectId: string;
  imageId: string;
  url: string;
  status: "approved" | "rejected";
  role: JapanVipImageRole;
  width: number | null;
  height: number | null;
  altText: string;
  sourcePageUrl: string;
  sourceType: JapanVipContentImage["sourceType"];
  updatedAt: string;
}

interface ImageLearningLibrary { version: 1; decisions: ImageDecision[]; updatedAt: string }

export interface JapanVipImageLearningProfile {
  mode: "manual" | "hybrid";
  reviewedProjects: number;
  labeledImages: number;
  approvedImages: number;
  rejectedImages: number;
  requiredProjects: number;
  requiredImages: number;
  roleCounts: Partial<Record<JapanVipImageRole, number>>;
  roleStats: Partial<Record<JapanVipImageRole, { approved: number; rejected: number; approvalRate: number }>>;
  updatedAt: string | null;
}

const REQUIRED_PROJECTS = 3;
const REQUIRED_IMAGES = 24;

function filePath(): string { return path.join(paths.japanVipContentDir, "image-selection-learning.json"); }

function readLibrary(): ImageLearningLibrary {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as Partial<ImageLearningLibrary>;
    return { version: 1, decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [], updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso() };
  } catch {
    return { version: 1, decisions: [], updatedAt: nowIso() };
  }
}

function writeLibrary(library: ImageLearningLibrary): void {
  ensureDir(paths.japanVipContentDir);
  library.updatedAt = nowIso();
  const file = filePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(library, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function recordExplicitImageDecision(projectId: string, image: JapanVipContentImage): void {
  if (image.status === "pending") return;
  const library = readLibrary();
  const decision: ImageDecision = {
    projectId, imageId: image.id, url: image.url, status: image.status, role: image.role,
    width: image.width, height: image.height, altText: image.altText, sourcePageUrl: image.sourcePageUrl,
    sourceType: image.sourceType, updatedAt: nowIso(),
  };
  const index = library.decisions.findIndex((item) => item.projectId === projectId && item.imageId === image.id);
  if (index >= 0) library.decisions[index] = decision;
  else library.decisions.push(decision);
  library.decisions = library.decisions.slice(-2_000);
  writeLibrary(library);
}

export function removeExplicitImageDecision(projectId: string, imageId: string): void {
  const library = readLibrary();
  const decisions = library.decisions.filter((item) => item.projectId !== projectId || item.imageId !== imageId);
  if (decisions.length === library.decisions.length) return;
  library.decisions = decisions;
  writeLibrary(library);
}

export function getJapanVipImageLearningProfile(): JapanVipImageLearningProfile {
  const library = readLibrary();
  const reviewedProjects = new Set(library.decisions.map((item) => item.projectId)).size;
  const approved = library.decisions.filter((item) => item.status === "approved");
  const roleCounts: Partial<Record<JapanVipImageRole, number>> = {};
  const roleStats: JapanVipImageLearningProfile["roleStats"] = {};
  for (const item of approved) roleCounts[item.role] = (roleCounts[item.role] ?? 0) + 1;
  for (const item of library.decisions) {
    const stats = roleStats[item.role] ?? { approved: 0, rejected: 0, approvalRate: 0 };
    stats[item.status] += 1;
    stats.approvalRate = Number((stats.approved / (stats.approved + stats.rejected)).toFixed(2));
    roleStats[item.role] = stats;
  }
  return {
    mode: reviewedProjects >= REQUIRED_PROJECTS && library.decisions.length >= REQUIRED_IMAGES ? "hybrid" : "manual",
    reviewedProjects, labeledImages: library.decisions.length, approvedImages: approved.length,
    rejectedImages: library.decisions.length - approved.length, requiredProjects: REQUIRED_PROJECTS,
    requiredImages: REQUIRED_IMAGES, roleCounts, roleStats, updatedAt: library.decisions.length ? library.updatedAt : null,
  };
}

function comparable(value: string): string {
  return value.toLocaleLowerCase("en").normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

function inferRole(image: JapanVipContentImage): JapanVipImageRole {
  const signal = `${image.url} ${image.altText} ${image.sourcePageUrl}`.toLocaleLowerCase("en");
  if (/(dimension|dimensions|size|spec|寸法|サイズ|設置)/i.test(signal)) return "dimensions";
  if (/(clean|care|maintenance|replace|wash|filter|お手入れ|掃除|交換|洗)/i.test(signal)) return "maintenance";
  if (/(detail|close|control|display|panel|sensor|material|構造|センサー|操作|内釜)/i.test(signal)) return "detail";
  const aspect = image.width && image.height ? image.width / image.height : 1;
  if (aspect >= 1.6 && /(lifestyle|scene|room|kitchen|使用イメージ|キッチン)/i.test(signal)) return "hero";
  if (aspect > 0.85 && aspect < 1.2 && /(front|product|本体|正面)/i.test(signal)) return "main-packshot";
  if (image.width && image.height && Math.min(image.width, image.height) < 650) return "feature-small";
  return "feature";
}

export function applyLearnedImageSelection(input: { projectModel: string; primaryUrl: string; images: JapanVipContentImage[] }): number {
  const profile = getJapanVipImageLearningProfile();
  if (profile.mode !== "hybrid") return 0;
  const modelToken = comparable(input.projectModel);
  let approvedCount = 0;
  for (const image of input.images) {
    if (image.status !== "pending" || approvedCount >= 10) continue;
    const role = inferRole(image);
    const signal = comparable(`${image.url} ${image.altText} ${image.sourcePageUrl} ${input.primaryUrl}`);
    const exactModel = modelToken.length >= 4 && signal.includes(modelToken);
    const enoughResolution = Boolean(image.width && image.height && image.width * image.height >= 400_000 && Math.min(image.width, image.height) >= 400);
    const cleanAsset = !/(watermark|logo|icon|banner|sprite|thumbnail|thumb)/i.test(`${image.url} ${image.altText}`);
    const safeRole = !["hero", "main-packshot", "alternate-angle"].includes(role);
    const rolePreference = profile.roleStats[role];
    const roleLearned = Boolean(rolePreference && rolePreference.approved >= 2 && rolePreference.approvalRate >= 0.6);
    const confidence = Number((0.2 + (exactModel ? 0.25 : 0) + (enoughResolution ? 0.2 : 0) + (cleanAsset ? 0.15 : 0) + (roleLearned ? 0.2 : 0)).toFixed(2));
    image.role = role;
    image.selectionOrigin = "auto";
    image.selectionConfidence = confidence;
    image.selectionReason = `Nguồn hãng; ${exactModel ? "khớp model" : "chưa đủ tín hiệu model"}; ${enoughResolution ? "đủ độ phân giải" : "chưa rõ độ phân giải"}; vai trò ${role}`;
    if (image.sourceType === "official" && exactModel && enoughResolution && cleanAsset && safeRole && roleLearned && confidence >= 0.8) {
      image.status = "approved";
      approvedCount += 1;
    }
  }
  return approvedCount;
}
