import { parseHTML } from "linkedom";
import { safeFetchHtml, SafeFetchError } from "./safeFetch.js";
import { HttpError } from "./util.js";

export interface DiscoveredJapanVipImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

function absoluteImageUrl(raw: string | null | undefined, baseUrl: string): string | null {
  const value = (raw || "").trim();
  if (!value || /^(?:data|blob):/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    const fileName = url.pathname.split("/").at(-1) || "";
    if (!fileName || /^\.[a-z0-9]+$/i.test(fileName)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function bestSrcset(value: string | null): string | null {
  if (!value) return null;
  const candidates = value.split(",").map((part) => part.trim().split(/\s+/)).filter((part) => part[0]);
  return candidates.at(-1)?.[0] ?? null;
}

export async function discoverJapanVipImages(pageUrl: string): Promise<{ pageUrl: string; images: DiscoveredJapanVipImage[] }> {
  let fetched;
  try {
    fetched = await safeFetchHtml(pageUrl);
  } catch (error) {
    if (error instanceof SafeFetchError) throw new HttpError(502, `IMAGE_${error.code}`, `Không đọc được trang ảnh: ${error.message}`);
    throw error;
  }
  const { document } = parseHTML(fetched.html);
  const found = new Map<string, DiscoveredJapanVipImage>();
  const add = (raw: string | null, alt = "", width: string | null = null, height: string | null = null) => {
    const url = absoluteImageUrl(raw, fetched.finalUrl);
    if (!url || /\.(?:svg|gif)(?:$|\?)/i.test(url)) return;
    if (/logo|icon|avatar|favicon|sprite/i.test(url) && !alt.trim()) return;
    const w = Number(width);
    const h = Number(height);
    const previous = found.get(url);
    found.set(url, {
      url,
      alt: alt.trim().slice(0, 300) || previous?.alt || "",
      width: Number.isFinite(w) && w > 0 ? w : previous?.width ?? null,
      height: Number.isFinite(h) && h > 0 ? h : previous?.height ?? null,
    });
  };
  for (const meta of [...document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')]) add(meta.getAttribute("content"));
  for (const image of [...document.querySelectorAll("img")]) {
    const raw = bestSrcset(image.getAttribute("srcset") || image.getAttribute("data-srcset"))
      || image.getAttribute("data-original") || image.getAttribute("data-src") || image.getAttribute("data-lazy-src") || image.getAttribute("src");
    add(raw, image.getAttribute("alt") || "", image.getAttribute("width"), image.getAttribute("height"));
  }
  for (const source of [...document.querySelectorAll("picture source")]) add(bestSrcset(source.getAttribute("srcset") || source.getAttribute("data-srcset")));
  return { pageUrl: fetched.finalUrl, images: [...found.values()].slice(0, 120) };
}
