"use client";

import { ArrowLeft, Brain, ExternalLink, FileCheck2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { PageHeader } from "@/components/PageHeader";
import {
  addJapanVipContentSource,
  addJapanVipContentFeedback,
  deleteJapanVipContentSource,
  generateJapanVipArticle,
  generateJapanVipOutline,
  getJapanVipContentProject,
  getJapanVipLearningLibrary,
  updateJapanVipContentProject,
  type JapanVipContentProject,
  type JapanVipAiProvider,
  type JapanVipContentStatus,
  type JapanVipLearningLibrary,
} from "@/lib/api";

const STATUS: Record<JapanVipContentStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Nháp", tone: "muted" },
  researching: { label: "Đang nghiên cứu", tone: "running" },
  writing: { label: "Đang viết", tone: "running" },
  review: { label: "Chờ duyệt", tone: "running" },
  approved: { label: "Đã duyệt", tone: "success" },
};

const AI_LABEL: Record<JapanVipAiProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  ollama: "Ollama Local",
};

export default function JapanVipContentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<JapanVipContentProject | null>(null);
  const [draft, setDraft] = useState<JapanVipContentProject | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [learning, setLearning] = useState<JapanVipLearningLibrary | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState("Giọng văn chưa đúng");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [saveAsRule, setSaveAsRule] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, nextLearning] = await Promise.all([getJapanVipContentProject(id), getJapanVipLearningLibrary()]);
      setProject(next);
      setDraft(next);
      setLearning(nextLearning);
      if (next.sources.length === 0 && next.primaryUrl) setSourceUrl(next.primaryUrl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  const dirty = useMemo(() => JSON.stringify(project) !== JSON.stringify(draft), [project, draft]);

  function patch<K extends keyof JapanVipContentProject>(key: K, value: JapanVipContentProject[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function run(label: string, action: () => Promise<JapanVipContentProject>) {
    setBusy(label);
    setError(null);
    try {
      const next = await action();
      setProject(next);
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    await run("save", () =>
      updateJapanVipContentProject(id, {
        name: draft.name,
        productModel: draft.productModel,
        primaryUrl: draft.primaryUrl,
        targetKeyword: draft.targetKeyword,
        audience: draft.audience,
        status: draft.status,
        facts: draft.facts,
        selectedReferenceIds: draft.selectedReferenceIds,
        outline: draft.outline,
        article: draft.article,
        notes: draft.notes,
      })
    );
  }

  async function chooseProvider(aiProvider: JapanVipAiProvider) {
    setBusy("provider");
    setError(null);
    try {
      const next = await updateJapanVipContentProject(id, { aiProvider });
      setProject((current) => current ? { ...current, aiProvider: next.aiProvider, updatedAt: next.updatedAt } : current);
      setDraft((current) => current ? { ...current, aiProvider: next.aiProvider, updatedAt: next.updatedAt } : current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!draft) {
    return <div className="flex flex-col gap-4">{error && <ErrorBanner message="Không mở được project" detail={error} />}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={draft.name}
        subtitle={`${draft.productModel || "Chưa có model"} · ${draft.sources.length} nguồn · ${draft.facts.length} fact`}
        actions={
          <>
            <Link href="/japanvip-content" className="btn btn-secondary"><ArrowLeft size={15} /> Danh sách</Link>
            <Badge tone={STATUS[draft.status].tone} label={STATUS[draft.status].label} />
            <Button disabled={!dirty || busy !== null} onClick={() => void save()}><Save size={15} /> Lưu</Button>
          </>
        }
      />
      {error && <ErrorBanner message="Thao tác chưa hoàn tất" detail={error} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Thông tin sản phẩm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tên sản phẩm" htmlFor="jvc-name">
                <input id="jvc-name" className="input" value={draft.name} onChange={(e) => patch("name", e.target.value)} />
              </Field>
              <Field label="Model" htmlFor="jvc-model">
                <input id="jvc-model" className="input" value={draft.productModel} onChange={(e) => patch("productModel", e.target.value)} />
              </Field>
              <Field label="Từ khóa SEO chính" htmlFor="jvc-keyword">
                <input id="jvc-keyword" className="input" value={draft.targetKeyword} onChange={(e) => patch("targetKeyword", e.target.value)} />
              </Field>
              <Field label="Trạng thái" htmlFor="jvc-status">
                <select id="jvc-status" className="input" value={draft.status} onChange={(e) => patch("status", e.target.value as JapanVipContentStatus)}>
                  {Object.entries(STATUS).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </select>
              </Field>
              <Field label="AI sử dụng" htmlFor="jvc-ai-provider">
                <select id="jvc-ai-provider" className="input" value={draft.aiProvider} disabled={busy !== null} onChange={(e) => {
                  const aiProvider = e.target.value as JapanVipAiProvider;
                  void chooseProvider(aiProvider);
                }}>
                  <option value="codex">ChatGPT (Codex CLI)</option>
                  <option value="claude">Claude Code</option>
                  <option value="ollama">Ollama Local (qwen3:14b)</option>
                </select>
              </Field>
            </div>
            <Field label="Độc giả mục tiêu" htmlFor="jvc-audience" className="mt-3">
              <input id="jvc-audience" className="input" value={draft.audience} onChange={(e) => patch("audience", e.target.value)} />
            </Field>
          </Card>

          <Card title="Nguồn chính thức" actions={<span className="text-meta text-[var(--text-muted)]">{draft.sources.length} nguồn</span>}>
            <div className="mb-3 flex gap-2">
              <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Dán URL trang chính thức của hãng…" />
              <Button disabled={!sourceUrl.trim() || busy !== null} onClick={() => void run("source", async () => {
                const next = await addJapanVipContentSource(id, sourceUrl.trim());
                setSourceUrl("");
                return next;
              })}><Plus size={15} /> {busy === "source" ? "Đang bóc…" : "Thêm"}</Button>
            </div>
            <div className="flex flex-col gap-2">
              {draft.sources.map((source) => (
                <div key={source.id} className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
                  <div className="min-w-0 flex-1">
                    <a className="inline-flex items-center gap-1 text-sm font-medium text-[var(--primary)]" href={source.canonicalUrl ?? source.url} target="_blank" rel="noreferrer">
                      {source.title} <ExternalLink size={12} />
                    </a>
                    <p className="mt-1 text-meta text-[var(--text-muted)]">{source.siteName || "Nguồn web"} · {source.text.length.toLocaleString("vi-VN")} ký tự</p>
                  </div>
                  <IconButton label="Xóa nguồn" tone="danger" size="sm" disabled={busy !== null} onClick={() => void run("delete-source", () => deleteJapanVipContentSource(id, source.id))}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ))}
              {draft.sources.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-muted)]">Chưa có nguồn. Hãy ưu tiên website chính thức của hãng Nhật.</p>}
            </div>
          </Card>

          <Card title="Fact sheet đã kiểm chứng">
            <Field label="Mỗi dòng là một fact" htmlFor="jvc-facts" hint="Chỉ đưa thông số hoặc claim đã đối chiếu nguồn. AI sẽ coi đây là nguồn sự thật ưu tiên.">
              <textarea id="jvc-facts" className="input min-h-52 resize-y" value={draft.facts.join("\n")} onChange={(e) => patch("facts", e.target.value.split("\n"))} placeholder="Dung tích 1,0 lít\nĐiện áp 100V Nhật Bản\nMàu BZ: đen" />
            </Field>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card
            title="AI học từ bài tham khảo"
            actions={<Link href="/japanvip-content/learning" className="btn btn-secondary btn-sm"><Brain size={14} /> Quản lý thư viện</Link>}
          >
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              Chọn bài để AI học bố cục và kỹ thuật viết. Dữ kiện sản phẩm vẫn chỉ lấy từ nguồn chính thức và fact sheet.
            </p>
            <div className="flex flex-col gap-2">
              {learning?.articles.filter((article) => article.active).map((article) => {
                const checked = draft.selectedReferenceIds.includes(article.id);
                return (
                  <label key={article.id} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[var(--primary)]"
                      checked={checked}
                      onChange={(e) => patch("selectedReferenceIds", e.target.checked
                        ? [...draft.selectedReferenceIds, article.id]
                        : draft.selectedReferenceIds.filter((value) => value !== article.id))}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{article.title}</span>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">{article.analysis.summary || article.siteName || "Bài tham khảo"}</span>
                    </span>
                  </label>
                );
              })}
              {(!learning || learning.articles.filter((article) => article.active).length === 0) && (
                <p className="py-5 text-center text-sm text-[var(--text-muted)]">Chưa có bài mẫu. Mở thư viện để dán link bài đối thủ hoặc bài cần học.</p>
              )}
            </div>
          </Card>

          <Card title="Dàn ý SEO" actions={<Button small disabled={busy !== null || (draft.sources.length === 0 && draft.facts.length === 0)} onClick={() => void run("outline", () => generateJapanVipOutline(id))}><Sparkles size={14} /> {busy === "outline" ? "Đang tạo…" : `${AI_LABEL[draft.aiProvider]} tạo dàn ý`}</Button>}>
            <textarea className="input min-h-72 resize-y font-mono text-sm" value={draft.outline} onChange={(e) => patch("outline", e.target.value)} placeholder="## Tổng quan sản phẩm…" />
          </Card>

          <Card title="Bài viết Markdown" actions={<Button small disabled={busy !== null || !draft.outline.trim()} onClick={() => void run("article", () => generateJapanVipArticle(id))}><Sparkles size={14} /> {busy === "article" ? "Đang viết…" : `${AI_LABEL[draft.aiProvider]} viết bài`}</Button>}>
            <textarea className="input min-h-[560px] resize-y font-mono text-sm leading-6" value={draft.article} onChange={(e) => patch("article", e.target.value)} placeholder="Bài viết hoàn chỉnh sẽ xuất hiện tại đây…" />
          </Card>

          <Card title="Duyệt nội dung" actions={draft.status !== "approved" ? <Button small variant="secondary" disabled={busy !== null || !draft.article.trim()} onClick={() => void run("approve", () => updateJapanVipContentProject(id, { status: "approved" }))}><FileCheck2 size={14} /> {busy === "approve" ? "Đang lưu…" : "Đánh dấu đã duyệt"}</Button> : undefined}>
            <Field label="Ghi chú biên tập" htmlFor="jvc-notes">
              <textarea id="jvc-notes" className="input min-h-28 resize-y" value={draft.notes} onChange={(e) => patch("notes", e.target.value)} placeholder="Điểm cần sửa, claim cần kiểm chứng, yêu cầu bổ sung ảnh…" />
            </Field>
            <p className="mt-3 text-meta text-[var(--text-muted)]">MVP chưa có chức năng xuất bản lên japanvip.vn. Nội dung phải được duyệt trước khi tích hợp CMS.</p>
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className="mb-2 text-sm font-semibold">Dạy AI từ lần chỉnh sửa này</p>
              <div className="grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)]">
                <select className="input" value={feedbackCategory} onChange={(e) => setFeedbackCategory(e.target.value)}>
                  <option>Giọng văn chưa đúng</option>
                  <option>Mở bài chưa hấp dẫn</option>
                  <option>Quá giống văn AI</option>
                  <option>Thiếu tư vấn mua hàng</option>
                  <option>Thông tin chưa đủ nguồn</option>
                  <option>Quá dài hoặc quá ngắn</option>
                  <option>Điểm làm tốt cần giữ</option>
                  <option>Khác</option>
                </select>
                <textarea className="input min-h-24 resize-y" value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} placeholder="Nói rõ AI cần giữ điều gì hoặc tránh điều gì ở những bài sau…" />
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={saveAsRule} onChange={(e) => setSaveAsRule(e.target.checked)} />
                Áp dụng phản hồi này như quy tắc cho các bài sau
              </label>
              <Button className="mt-3" small variant="secondary" disabled={!feedbackNote.trim() || busy !== null} onClick={() => void run("feedback", async () => {
                const next = await addJapanVipContentFeedback(id, { category: feedbackCategory, note: feedbackNote.trim(), saveAsRule });
                setFeedbackNote("");
                if (saveAsRule) setLearning(await getJapanVipLearningLibrary());
                return next;
              })}><Brain size={14} /> {busy === "feedback" ? "Đang ghi nhớ…" : "Lưu bài học cho AI"}</Button>
              {draft.feedback.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {draft.feedback.slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-[var(--radius)] bg-[var(--surface-subtle)] p-3 text-sm">
                      <span className="font-medium">{item.category}:</span> {item.note}
                      {item.savedAsRule && <span className="ml-2 text-xs text-[var(--primary)]">Đã lưu vào bộ nhớ chung</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
