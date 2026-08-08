import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { HttpError, ensureDir, nowIso, toKebabAscii } from "./util.js";
import type { JapanVipAiProvider } from "./japanVipAi.js";

export type JapanVipContentStatus =
  | "draft"
  | "researching"
  | "writing"
  | "review"
  | "approved";

export interface JapanVipSource {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string;
  siteName: string | null;
  lang: string | null;
  leadImage: string | null;
  text: string;
  fetchedAt: string;
}

export interface JapanVipContentFeedback {
  id: string;
  category: string;
  note: string;
  savedAsRule: boolean;
  createdAt: string;
}

export interface JapanVipContentProject {
  id: string;
  name: string;
  productModel: string;
  primaryUrl: string;
  targetKeyword: string;
  audience: string;
  aiProvider: JapanVipAiProvider;
  status: JapanVipContentStatus;
  sources: JapanVipSource[];
  selectedReferenceIds: string[];
  facts: string[];
  outline: string;
  article: string;
  notes: string;
  feedback: JapanVipContentFeedback[];
  createdAt: string;
  updatedAt: string;
}

function normalizeProject(project: JapanVipContentProject): JapanVipContentProject {
  return {
    ...project,
    aiProvider: project.aiProvider === "claude" ? "claude" : "codex",
    selectedReferenceIds: Array.isArray(project.selectedReferenceIds) ? project.selectedReferenceIds : [],
    feedback: Array.isArray(project.feedback) ? project.feedback : [],
  };
}

function dirOf(id: string): string {
  return path.join(paths.japanVipContentDir, id);
}

function fileOf(id: string): string {
  return path.join(dirOf(id), "project.json");
}

function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
}

export function listJapanVipContent(): JapanVipContentProject[] {
  ensureDir(paths.japanVipContentDir);
  const out: JapanVipContentProject[] = [];
  for (const entry of fs.readdirSync(paths.japanVipContentDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    try {
      out.push(normalizeProject(JSON.parse(fs.readFileSync(fileOf(entry.name), "utf8")) as JapanVipContentProject));
    } catch {
      // Một project hỏng không được làm mất toàn bộ danh sách.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readJapanVipContent(id: string): JapanVipContentProject {
  if (!isValidId(id) || !fs.existsSync(fileOf(id))) {
    throw new HttpError(404, "JAPANVIP_CONTENT_NOT_FOUND", `Không tìm thấy Content Project "${id}"`);
  }
  try {
    return normalizeProject(JSON.parse(fs.readFileSync(fileOf(id), "utf8")) as JapanVipContentProject);
  } catch {
    throw new HttpError(500, "JAPANVIP_CONTENT_CORRUPT", `Dữ liệu Content Project "${id}" bị hỏng`);
  }
}

export function writeJapanVipContent(project: JapanVipContentProject): void {
  project.updatedAt = nowIso();
  ensureDir(dirOf(project.id));
  const file = fileOf(project.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function createJapanVipContent(input: {
  name: string;
  productModel?: string;
  primaryUrl?: string;
}): JapanVipContentProject {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "INVALID_NAME", "Thiếu tên Content Project");
  const base = toKebabAscii(name).slice(0, 64) || "japanvip-content";
  let id = base;
  for (let n = 2; fs.existsSync(dirOf(id)); n++) id = `${base}-${n}`;
  const now = nowIso();
  const project: JapanVipContentProject = {
    id,
    name,
    productModel: input.productModel?.trim() ?? "",
    primaryUrl: input.primaryUrl?.trim() ?? "",
    targetKeyword: "",
    audience: "Khách hàng Việt Nam quan tâm sản phẩm Nhật Bản cao cấp",
    aiProvider: "codex",
    status: "draft",
    sources: [],
    selectedReferenceIds: [],
    facts: [],
    outline: "",
    article: "",
    notes: "",
    feedback: [],
    createdAt: now,
    updatedAt: now,
  };
  writeJapanVipContent(project);
  return project;
}

export function deleteJapanVipContent(id: string): void {
  readJapanVipContent(id);
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}
