import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import type { ExtractedArticle } from "./textToVideoMeta.js";
import { execFileCaptureAll } from "./util.js";

interface Crawl4AiResult {
  title?: string | null;
  markdown?: string;
  finalUrl?: string;
}

function pythonCandidates(): string[] {
  const env = (process.env.CRAWL4AI_PYTHON ?? "").trim();
  const local = process.platform === "win32"
    ? path.join(paths.runtime.root, "crawl4ai", "Scripts", "python.exe")
    : path.join(paths.runtime.root, "crawl4ai", "bin", "python");
  return [
    env,
    local,
    "/Users/tohongson/Video-marketing/marketing-ai/.venv-crawl4ai311/bin/python",
  ].filter(Boolean);
}

function availablePython(): string | null {
  return pythonCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

function cleanMarkdownBlock(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractArticleWithCrawl4Ai(url: string): Promise<ExtractedArticle | null> {
  const python = availablePython();
  if (!python) return null;
  const script = path.join(paths.serverDir, "scripts", "crawl4ai_extract.py");
  const result = await execFileCaptureAll(python, [script, url], { timeoutMs: 90_000 });
  if (result.code !== 0 || result.timedOut) return null;
  let parsed: Crawl4AiResult;
  try {
    const raw = result.stdout.trim();
    const jsonStart = raw.lastIndexOf("\n{");
    parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart + 1) : raw) as Crawl4AiResult;
  } catch {
    return null;
  }
  const blocks = (parsed.markdown ?? "")
    .split(/\n\s*\n/)
    .map(cleanMarkdownBlock)
    .filter((block) => block.length >= 20)
    .slice(0, 1_000);
  const chars = blocks.reduce((sum, block) => sum + block.length, 0);
  if (chars < 500) return null;
  let hostname: string | null = null;
  try { hostname = new URL(parsed.finalUrl || url).hostname; } catch { /* validated upstream */ }
  return {
    title: (parsed.title ?? "").trim() || blocks[0].slice(0, 160),
    blocks,
    byline: null,
    siteName: hostname,
    publishedTime: null,
    canonicalUrl: parsed.finalUrl || url,
    leadImage: null,
    lang: null,
    chars,
  };
}
