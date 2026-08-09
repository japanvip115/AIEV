import { parseHTML } from "linkedom";
import { safeFetchHtml, SafeFetchError } from "./safeFetch.js";
import { HttpError } from "./util.js";

export interface OfficialProductResearchPage {
  url: string;
  title: string;
  siteName: string | null;
  lang: string | null;
  leadImage: string | null;
  text: string;
}

function clean(value: string | null | undefined): string {
  return (value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function absolute(raw: string | null | undefined, base: string): string | null {
  try {
    const value = clean(raw);
    if (!value || /^(?:data|blob|javascript):/i.test(value)) return null;
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function meta(document: ReturnType<typeof parseHTML>["document"], selector: string): string {
  return clean(document.querySelector(selector)?.getAttribute("content"));
}

function jsonLdProductText(document: ReturnType<typeof parseHTML>["document"]): string[] {
  const lines: string[] = [];
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')]) {
    let parsed: unknown;
    try { parsed = JSON.parse(script.textContent || ""); } catch { continue; }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const row = node as Record<string, unknown>;
      if (Array.isArray(row["@graph"])) row["@graph"].forEach(visit);
      const type = Array.isArray(row["@type"]) ? row["@type"].join(" ") : String(row["@type"] ?? "");
      if (!/Product/i.test(type)) return;
      for (const key of ["name", "model", "sku", "mpn", "description", "color", "material"]) {
        if (typeof row[key] === "string" && clean(row[key] as string)) lines.push(`${key}: ${clean(row[key] as string)}`);
      }
      if (Array.isArray(row.additionalProperty)) {
        for (const item of row.additionalProperty.slice(0, 40)) {
          if (!item || typeof item !== "object") continue;
          const property = item as Record<string, unknown>;
          const name = clean(String(property.name ?? ""));
          const value = clean(String(property.value ?? ""));
          if (name && value) lines.push(`${name}: ${value}`);
        }
      }
    };
    roots.forEach(visit);
  }
  return lines;
}

export function extractOfficialProductPageHtml(html: string, pageUrl: string): { page: OfficialProductResearchPage; childUrls: string[] } {
  const { document } = parseHTML(html);
  const title = meta(document, 'meta[property="og:title"]') || clean(document.querySelector("h1")?.textContent) || clean(document.title) || "Sản phẩm chính hãng";
  const description = meta(document, 'meta[name="description"]') || meta(document, 'meta[property="og:description"]');
  const canonical = absolute(document.querySelector('link[rel="canonical"]')?.getAttribute("href"), pageUrl) || pageUrl;
  const leadImage = absolute(meta(document, 'meta[property="og:image"]') || meta(document, 'meta[name="twitter:image"]'), canonical);
  const siteName = meta(document, 'meta[property="og:site_name"]') || new URL(canonical).hostname;
  const lines: string[] = [title, description, ...jsonLdProductText(document)];
  const seen = new Set<string>();
  for (const element of [...document.querySelectorAll("main h1,main h2,main h3,main h4,main p,main li,main dt,main dd,main th,main td,article h1,article h2,article h3,article p,article li,body h1,body h2,body h3,body h4,body p,body dt,body dd,body th,body td")]) {
    const value = clean(element.textContent);
    if (value.length < 12 || value.length > 2_000 || seen.has(value)) continue;
    if (/^(cookie|privacy|menu|ホーム|トップ|お問い合わせ|会社概要|サイトマップ)$/i.test(value)) continue;
    seen.add(value);
    lines.push(value);
    if (lines.join("\n").length >= 55_000) break;
  }
  const text = lines.map(clean).filter(Boolean).join("\n").slice(0, 55_000);
  const rootHost = new URL(canonical).hostname;
  const canonicalPath = new URL(canonical).pathname;
  const productBasePath = canonicalPath.endsWith("/") ? canonicalPath : canonicalPath.slice(0, canonicalPath.lastIndexOf("/") + 1);
  const candidates: Array<{ url: string; score: number }> = [];
  const accepted = new Set<string>([canonical]);
  const useful = /(feature|function|technology|spec|detail|support|manual|product|gallery|特長|特徴|機能|仕様|詳細|お手入れ|使い方|寸法|サイズ)/i;
  const reject = /(privacy|company|corporate|recruit|news|login|cart|shop|store|contact|faq|pdf$)/i;
  for (const anchor of [...document.querySelectorAll("a[href]")]) {
    const url = absolute(anchor.getAttribute("href"), canonical);
    if (!url) continue;
    const parsed = new URL(url);
    parsed.hash = "";
    const normalized = parsed.href;
    if (parsed.hostname !== rootHost || !parsed.pathname.startsWith(productBasePath) || accepted.has(normalized) || reject.test(parsed.pathname)) continue;
    const label = clean(anchor.textContent);
    const signal = `${label} ${parsed.pathname}`;
    if (!useful.test(signal)) continue;
    accepted.add(normalized);
    candidates.push({ url: normalized, score: (useful.test(label) ? 2 : 0) + (useful.test(parsed.pathname) ? 1 : 0) });
  }
  candidates.sort((a, b) => b.score - a.score);
  return {
    page: { url: canonical, title, siteName, lang: clean(document.documentElement?.getAttribute("lang")) || null, leadImage, text },
    childUrls: candidates.slice(0, 3).map((item) => item.url),
  };
}

async function fetchPage(url: string): Promise<{ page: OfficialProductResearchPage; childUrls: string[] }> {
  try {
    const fetched = await safeFetchHtml(url);
    return extractOfficialProductPageHtml(fetched.html, fetched.finalUrl);
  } catch (error) {
    if (error instanceof SafeFetchError) throw new HttpError(502, `OFFICIAL_${error.code}`, `Không đọc được trang hãng: ${error.message}`);
    throw error;
  }
}

export async function researchOfficialProduct(url: string): Promise<OfficialProductResearchPage[]> {
  const primary = await fetchPage(url);
  if (primary.page.text.length < 200) throw new HttpError(422, "OFFICIAL_CONTENT_TOO_SHORT", "Trang hãng có quá ít nội dung để tự động viết bài an toàn");
  const pages = [primary.page];
  for (const childUrl of primary.childUrls) {
    try {
      const child = await fetchPage(childUrl);
      if (child.page.text.length >= 200 && !pages.some((page) => page.url === child.page.url)) pages.push(child.page);
    } catch {
      // Trang con là nguồn bổ sung; lỗi một trang không được làm hỏng nguồn chính.
    }
  }
  return pages.slice(0, 4);
}
