"use client";

import { ArrowLeft, BookOpenCheck, ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { IconButton } from "@/components/IconButton";
import { PageHeader } from "@/components/PageHeader";
import {
  addJapanVipLearningRule,
  addJapanVipReferenceArticle,
  deleteJapanVipLearningRule,
  deleteJapanVipReferenceArticle,
  getJapanVipLearningLibrary,
  getJapanVipAiStatus,
  updateJapanVipLearningRule,
  updateJapanVipReferenceArticle,
  type JapanVipLearningLibrary,
  type JapanVipAiProvider,
  type JapanVipAiStatus,
  type JapanVipReferenceKind,
} from "@/lib/api";

const KIND_LABEL: Record<JapanVipReferenceKind, string> = {
  competitor: "Đối thủ",
  inspiration: "Bài hay cần học",
  japanvip: "Bài Japan VIP",
};

const AI_LABEL: Record<JapanVipAiProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  ollama: "Ollama Local",
};

export default function JapanVipLearningPage() {
  const [library, setLibrary] = useState<JapanVipLearningLibrary | null>(null);
  const [aiStatus, setAiStatus] = useState<JapanVipAiStatus | null>(null);
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<JapanVipReferenceKind>("competitor");
  const [aiProvider, setAiProvider] = useState<JapanVipAiProvider>("codex");
  const [tags, setTags] = useState("");
  const [rule, setRule] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextLibrary, nextStatus] = await Promise.all([getJapanVipLearningLibrary(), getJapanVipAiStatus()]);
      setLibrary(nextLibrary);
      setAiStatus(nextStatus);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function run(label: string, action: () => Promise<JapanVipLearningLibrary>) {
    setBusy(label);
    setError(null);
    try {
      setLibrary(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!library) return <div className="flex flex-col gap-4">{error && <ErrorBanner message="Không mở được thư viện" detail={error} />}</div>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AI học nội dung"
        subtitle={`${library.articles.length} bài tham khảo · ${library.rules.length} quy tắc Japan VIP`}
        actions={<Link href="/japanvip-content" className="btn btn-secondary"><ArrowLeft size={15} /> Content Project</Link>}
      />
      {error && <ErrorBanner message="Thao tác chưa hoàn tất" detail={error} />}

      <Card title="Thêm bài viết cần học" actions={<Badge tone="muted" label="Không dùng làm nguồn sự thật" />}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          AI sẽ bóc tách cách trình bày, bố cục và kỹ thuật thuyết phục. Hệ thống không được sao chép câu chữ hoặc lấy claim sản phẩm từ bài này.
        </p>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_190px_210px_auto]">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán URL bài đối thủ hoặc bài cần học…" />
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as JapanVipReferenceKind)}>
            {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="input" aria-label="AI phân tích" value={aiProvider} onChange={(e) => setAiProvider(e.target.value as JapanVipAiProvider)}>
            <option value="codex">ChatGPT (Codex CLI)</option>
            <option value="claude">Claude Code</option>
            <option value="ollama">Ollama Local (qwen3:14b)</option>
          </select>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Nồi cơm, mở bài, SEO…" />
          <Button disabled={!url.trim() || busy !== null} onClick={() => void run("add-article", async () => {
            const next = await addJapanVipReferenceArticle({ url: url.trim(), kind, aiProvider, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
            setUrl("");
            setTags("");
            return next;
          })}><Plus size={15} /> {busy === "add-article" ? `${AI_LABEL[aiProvider]} đang phân tích…` : "Thêm và phân tích"}</Button>
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Ollama: {aiStatus?.ollama.running
            ? aiStatus.ollama.installed ? `Sẵn sàng · ${aiStatus.ollama.model}` : `Đang chạy nhưng thiếu ${aiStatus.ollama.model}`
            : "Chưa chạy"}
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Thư viện bài tham khảo">
          <div className="flex flex-col gap-3">
            {library.articles.map((article) => (
              <div key={article.id} className="rounded-[var(--radius)] border border-[var(--border)] p-4">
                <div className="flex items-start gap-3">
                  <input
                    className="mt-1 h-4 w-4 accent-[var(--primary)]"
                    type="checkbox"
                    checked={article.active}
                    aria-label={`Bật ${article.title}`}
                    disabled={busy !== null}
                    onChange={(e) => void run(`article-${article.id}`, () => updateJapanVipReferenceArticle(article.id, { active: e.target.checked }))}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={article.canonicalUrl ?? article.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--primary)]">
                        {article.title} <ExternalLink size={13} />
                      </a>
                      <Badge tone={article.kind === "japanvip" ? "success" : "muted"} label={KIND_LABEL[article.kind]} />
                    </div>
                    <p className="mt-1 text-meta text-[var(--text-muted)]">{article.siteName || "Nguồn web"} · {article.tags.join(", ") || "chưa gắn nhãn"}</p>
                    {article.analysis.reusableLessons.length > 0 && (
                      <details open className="group mt-3 overflow-hidden rounded-[var(--radius)] border-2 border-[var(--primary)] bg-[var(--surface)] shadow-sm">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[color-mix(in_srgb,var(--primary)_12%,var(--surface))] px-4 py-3 marker:content-none">
                          <span className="flex items-center gap-2 font-semibold text-[var(--primary)]">
                            <BookOpenCheck size={18} />
                            Bài học AI rút ra để áp dụng
                          </span>
                          <span className="rounded-full bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-white">
                            {article.analysis.reusableLessons.length} bài học
                          </span>
                        </summary>
                        <div className="border-t border-[var(--border)] px-4 py-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Bài học có thể áp dụng</p>
                          <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
                            {article.analysis.reusableLessons.slice(0, 5).map((lesson) => <li key={lesson}>{lesson}</li>)}
                          </ul>
                        </div>
                      </details>
                    )}
                    <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                      <span className="font-medium text-[var(--text)]">Tóm tắt cách viết: </span>
                      {article.analysis.summary || "Chưa có tóm tắt phong cách."}
                    </p>
                  </div>
                  <IconButton label="Xóa bài tham khảo" tone="danger" size="sm" disabled={busy !== null} onClick={() => void run(`delete-${article.id}`, () => deleteJapanVipReferenceArticle(article.id))}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </div>
            ))}
            {library.articles.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">Chưa có bài tham khảo. Hãy thêm những bài bạn thực sự đánh giá cao.</p>}
          </div>
        </Card>

        <Card title="Quy tắc viết Japan VIP" actions={<BookOpenCheck size={18} className="text-[var(--primary)]" />}>
          <p className="mb-3 text-sm text-[var(--text-muted)]">Quy tắc đang bật được áp dụng cho mọi dàn ý và bài viết mới.</p>
          <div className="mb-3 flex gap-2">
            <textarea className="input min-h-20 resize-y" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Ví dụ: Không mở bài bằng câu chung chung…" />
            <Button disabled={!rule.trim() || busy !== null} onClick={() => void run("add-rule", async () => {
              const next = await addJapanVipLearningRule(rule.trim());
              setRule("");
              return next;
            })}><Plus size={15} /> Thêm</Button>
          </div>
          <div className="flex flex-col gap-2">
            {library.rules.map((item) => (
              <div key={item.id} className="flex items-start gap-2 rounded-[var(--radius)] border border-[var(--border)] p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                  checked={item.active}
                  aria-label={`Bật quy tắc ${item.text}`}
                  disabled={busy !== null}
                  onChange={(e) => void run(`rule-${item.id}`, () => updateJapanVipLearningRule(item.id, { active: e.target.checked }))}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-5">{item.text}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{item.source === "feedback" ? "Học từ phản hồi" : "Nhập thủ công"}</p>
                </div>
                <IconButton label="Xóa quy tắc" tone="danger" size="sm" disabled={busy !== null} onClick={() => void run(`delete-rule-${item.id}`, () => deleteJapanVipLearningRule(item.id))}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
            {library.rules.length === 0 && <p className="py-5 text-center text-sm text-[var(--text-muted)]">Chưa có quy tắc. Phản hồi được lưu làm bài học cũng sẽ xuất hiện tại đây.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
