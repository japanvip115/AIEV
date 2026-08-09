#!/usr/bin/env python3
"""Render one public page with Crawl4AI and return compact JSON on stdout."""

import asyncio
import json
import sys

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


async def main(url: str) -> None:
    browser = BrowserConfig(headless=True, browser_type="chromium", verbose=False)
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=60_000,
        wait_until="domcontentloaded",
        delay_before_return_html=3.0,
        scan_full_page=True,
        remove_overlay_elements=True,
    )
    async with AsyncWebCrawler(config=browser) as crawler:
        result = await crawler.arun(url=url, config=config)
    if not result.success:
        raise RuntimeError(result.error_message or "Crawl4AI failed")
    if result.status_code is not None and result.status_code >= 400:
        raise RuntimeError(f"HTTP {result.status_code}")
    markdown = (
        result.markdown.raw_markdown
        if hasattr(result.markdown, "raw_markdown")
        else str(result.markdown or "")
    )
    metadata = result.metadata or {}
    print(json.dumps({
        "title": metadata.get("title"),
        "markdown": markdown[:100_000],
        "finalUrl": getattr(result, "url", None) or url,
    }, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: crawl4ai_extract.py URL")
    asyncio.run(main(sys.argv[1]))
