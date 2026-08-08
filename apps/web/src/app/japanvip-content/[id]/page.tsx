"use client";

import { ArrowLeft, Brain, CheckCircle2, ClipboardPaste, Database, ExternalLink, FileCheck2, Images, PenTool, Plus, Save, Sparkles, Trash2, ShieldCheck, WandSparkles } from "lucide-react";
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
  addJapanVipManualContentSource,
  addJapanVipContentFeedback,
  deleteJapanVipContentSource,
  deleteJapanVipContentImage,
  deleteJapanVipContentFeedback,
  discoverJapanVipContentImages,
  generateJapanVipArticle,
  generateJapanVipOutline,
  reviewJapanVipArticleWithHermes,
  previewJapanVipSelectiveRevision,
  applyJapanVipSelectiveRevision,
  cancelJapanVipSelectiveRevision,
  getJapanVipContentProject,
  getJapanVipLearningLibrary,
  updateJapanVipContentProject,
  updateJapanVipContentImage,
  type JapanVipContentProject,
  type JapanVipAiProvider,
  type JapanVipContentStatus,
  type JapanVipLearningLibrary,
  type JapanVipRevisionCategory,
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
  "ollama-cloud": "Ollama Cloud",
};

const REVISION_OPTIONS: Array<{ id: JapanVipRevisionCategory; label: string }> = [
  { id: "cta", label: "CTA" },
  { id: "naturalness", label: "Văn phong dịch" },
  { id: "claims", label: "Claim & bằng chứng" },
  { id: "repetition", label: "Đoạn lặp" },
  { id: "seo", label: "SEO & heading" },
];

const REVISION_LABEL = Object.fromEntries(REVISION_OPTIONS.map((item) => [item.id, item.label])) as Record<JapanVipRevisionCategory, string>;

export default function JapanVipContentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<JapanVipContentProject | null>(null);
  const [draft, setDraft] = useState<JapanVipContentProject | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [manualSourceTitle, setManualSourceTitle] = useState("");
  const [manualSourceText, setManualSourceText] = useState("");
  const [imageSourceUrl, setImageSourceUrl] = useState("");
  const [learning, setLearning] = useState<JapanVipLearningLibrary | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState("Giọng văn chưa đúng");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [saveAsRule, setSaveAsRule] = useState(true);
  const [revisionCategories, setRevisionCategories] = useState<JapanVipRevisionCategory[]>(["cta", "naturalness", "claims", "repetition"]);
  const [revisionRequest, setRevisionRequest] = useState("");
  const [selectedRevisionChangeIds, setSelectedRevisionChangeIds] = useState<string[]>([]);
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

  useEffect(() => {
    if (draft?.selectiveRevision) setSelectedRevisionChangeIds(draft.selectiveRevision.changes.map((change) => change.id));
  }, [draft?.selectiveRevision?.id]);

  const dirty = useMemo(() => JSON.stringify(project) !== JSON.stringify(draft), [project, draft]);
  const workflow = useMemo(() => draft ? [
    { label: "Nghiên cứu", href: "#research", done: draft.sources.length > 0 || draft.facts.length > 0 },
    { label: "Hình ảnh", href: "#images", done: draft.images.some((image) => image.status === "approved") },
    { label: "Dàn ý", href: "#outline", done: Boolean(draft.outline.trim()) },
    { label: "Bài viết", href: "#article", done: Boolean(draft.article.trim()) },
    { label: "Phản biện", href: "#review", done: draft.hermesReviews.length > 0 },
    { label: "Duyệt", href: "#approval", done: draft.status === "approved" },
  ] : [], [draft]);
  const completedSteps = workflow.filter((step) => step.done).length;
  const articleWords = draft?.article.trim() ? draft.article.trim().split(/\s+/).length : 0;

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
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader
        title={draft.name}
        subtitle={`${draft.productModel || "Chưa có model"} · ${draft.sources.length} nguồn · ${draft.facts.length} fact`}
        actions={
          <>
            <Link href="/japanvip-content" className="btn btn-secondary"><ArrowLeft size={15} /> Danh sách</Link>
            <Badge tone={STATUS[draft.status].tone} label={STATUS[draft.status].label} />
          </>
        }
      />
      {error && <ErrorBanner message="Thao tác chưa hoàn tất" detail={error} />}

      <div className="sticky top-2 z-20 rounded-[calc(var(--radius)+4px)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] p-3 shadow-lg backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Tiến độ sản xuất nội dung" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {workflow.map((step, index) => (
              <a key={step.label} href={step.href} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${step.done ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${step.done ? "bg-[var(--primary)] text-white" : "border border-[var(--border)]"}`}>{step.done ? <CheckCircle2 size={13} /> : index + 1}</span>
                {step.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {dirty && <span className="hidden text-xs font-medium text-amber-600 sm:inline">Có thay đổi chưa lưu</span>}
            <label className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 shadow-sm">
              <span className="hidden items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-[var(--text-muted)] lg:flex"><Sparkles size={13} className="text-[var(--primary)]" /> AI thực thi</span>
              <select
                aria-label="AI thực thi nhanh"
                className="min-w-[150px] border-0 bg-transparent text-sm font-semibold outline-none sm:min-w-[190px]"
                value={draft.aiProvider}
                disabled={busy !== null}
                onChange={(e) => void chooseProvider(e.target.value as JapanVipAiProvider)}
              >
                <option value="codex">ChatGPT (Codex CLI)</option>
                <option value="claude">Claude Code</option>
                <option value="ollama">Ollama Local (qwen3:14b)</option>
                <option value="ollama-cloud">Ollama Cloud (GPT-OSS 120B)</option>
              </select>
            </label>
            <Button disabled={!dirty || busy !== null} onClick={() => void save()}><Save size={15} /> {busy === "save" ? "Đang lưu…" : "Lưu thay đổi"}</Button>
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tổng quan dự án">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tiến độ</p><p className="mt-2 text-2xl font-bold">{completedSteps}/{workflow.length}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]"><div className="h-full bg-[var(--primary)]" style={{ width: `${workflow.length ? completedSteps / workflow.length * 100 : 0}%` }} /></div></div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Dữ liệu đã khóa</p><p className="mt-2 text-2xl font-bold">{draft.sources.length} <span className="text-sm font-medium text-[var(--text-muted)]">nguồn</span> · {draft.facts.length} <span className="text-sm font-medium text-[var(--text-muted)]">fact</span></p></div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">AI sản xuất</p><p className="mt-2 text-lg font-bold">{AI_LABEL[draft.aiProvider]}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Áp dụng cho dàn ý và bài viết</p></div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Bản thảo</p><p className="mt-2 text-2xl font-bold">{articleWords.toLocaleString("vi-VN")} <span className="text-sm font-medium text-[var(--text-muted)]">từ</span></p><p className="mt-1 text-xs text-[var(--text-muted)]">Hermes: {draft.hermesReviews[0] ? `${draft.hermesReviews[0].totalScore}/100` : "chưa chấm"}</p></div>
      </section>

      <div className="flex min-w-0 flex-col gap-8">
        <section id="research" className="scroll-mt-28">
          <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"><Database size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Giai đoạn 1</p><h2 className="text-xl font-bold">Thiết lập và khóa dữ liệu</h2></div></div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <div className="xl:col-span-2">
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
                  <option value="ollama-cloud">Ollama Cloud (GPT-OSS 120B)</option>
                </select>
              </Field>
            </div>
            <Field label="Độc giả mục tiêu" htmlFor="jvc-audience" className="mt-3">
              <input id="jvc-audience" className="input" value={draft.audience} onChange={(e) => patch("audience", e.target.value)} />
            </Field>
          </Card>
          </div>

          <Card title="Nguồn chính thức" actions={<span className="text-meta text-[var(--text-muted)]">{draft.sources.length} nguồn</span>}>
            <div className="mb-3 flex gap-2">
              <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Dán URL trang chính thức của hãng…" />
              <Button disabled={!sourceUrl.trim() || busy !== null} onClick={() => void run("source", async () => {
                const next = await addJapanVipContentSource(id, sourceUrl.trim());
                setSourceUrl("");
                return next;
              })}><Plus size={15} /> {busy === "source" ? "Đang bóc…" : "Thêm"}</Button>
            </div>
            <details className="mb-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">Trang chặn bot hoặc dùng JavaScript? Dán nội dung thủ công</summary>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Mở trang nguồn, sao chép phần nội dung cần dùng rồi dán vào đây. Hệ thống vẫn gắn nội dung với URL nguồn phía trên.</p>
              <input className="input mt-3" value={manualSourceTitle} onChange={(e) => setManualSourceTitle(e.target.value)} placeholder="Tên nguồn, ví dụ: Zojirushi NW-NC10 – tính năng" />
              <textarea className="input mt-2 min-h-44 resize-y" value={manualSourceText} onChange={(e) => setManualSourceText(e.target.value)} placeholder="Dán nội dung đã sao chép từ trang hãng (tối thiểu 200 ký tự)…" />
              <div className="mt-2 flex justify-end"><Button small disabled={!sourceUrl.trim() || manualSourceText.trim().length < 200 || busy !== null} onClick={() => void run("manual-source", async () => {
                const next = await addJapanVipManualContentSource(id, { url: sourceUrl.trim(), title: manualSourceTitle.trim(), text: manualSourceText.trim() });
                setSourceUrl(""); setManualSourceTitle(""); setManualSourceText("");
                return next;
              })}><ClipboardPaste size={14} /> {busy === "manual-source" ? "Đang lưu…" : "Lưu nội dung làm nguồn"}</Button></div>
            </details>
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
        </section>

        <section id="images" className="scroll-mt-28">
          <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"><Images size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Giai đoạn 2</p><h2 className="text-xl font-bold">Ảnh sản phẩm và tính năng</h2></div></div>
          <Card title="Kho ảnh đã kiểm duyệt" actions={<span className="text-xs text-[var(--text-muted)]">{draft.images.filter((image) => image.status === "approved").length} đã duyệt · {draft.images.filter((image) => image.status === "pending").length} chờ duyệt</span>}>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
              <p className="text-sm font-semibold">Thu thập từ trang chính thức của hãng</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Chỉ ảnh bạn duyệt mới được chèn vào bài. Hệ thống không dùng ảnh đối thủ làm dữ kiện hoặc tài sản xuất bản.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input className="input flex-1" value={imageSourceUrl} onChange={(e) => setImageSourceUrl(e.target.value)} placeholder="Dán URL gallery, feature hoặc trang sản phẩm của hãng…" />
                <Button disabled={!imageSourceUrl.trim() || busy !== null} onClick={() => void run("discover-images", async () => { const next = await discoverJapanVipContentImages(id, imageSourceUrl.trim(), "official"); setImageSourceUrl(""); return next; })}><Images size={15} /> {busy === "discover-images" ? "Đang thu thập…" : "Thu thập ảnh hãng"}</Button>
              </div>
            </div>
            {draft.images.length > 0 ? <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {draft.images.map((image) => <article key={image.id} className={`overflow-hidden rounded-[var(--radius)] border ${image.status === "approved" ? "border-emerald-400" : image.status === "rejected" ? "border-red-300 opacity-60" : "border-[var(--border)]"}`}>
                <div className="grid h-44 place-items-center bg-white p-2"><img src={image.url} alt={image.altText || "Ảnh ứng viên sản phẩm"} className="max-h-full max-w-full object-contain" loading="lazy" /></div>
                <div className="flex flex-col gap-2 border-t border-[var(--border)] p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <select aria-label="Trạng thái ảnh" className="input" value={image.status} disabled={busy !== null} onChange={(e) => void run(`image-status-${image.id}`, () => updateJapanVipContentImage(id, image.id, { status: e.target.value as typeof image.status }))}><option value="pending">Chờ duyệt</option><option value="approved">Duyệt dùng</option><option value="rejected">Loại ảnh</option></select>
                    <select aria-label="Vai trò ảnh" className="input" value={image.role} disabled={busy !== null} onChange={(e) => void run(`image-role-${image.id}`, () => updateJapanVipContentImage(id, image.id, { role: e.target.value as typeof image.role }))}><option value="hero">Hero</option><option value="main-packshot">Ảnh sản phẩm chính</option><option value="alternate-angle">Góc khác</option><option value="feature">Feature lớn</option><option value="feature-small">Feature nhỏ (gom bảng)</option><option value="detail">Chi tiết</option><option value="dimensions">Kích thước</option><option value="maintenance">Vệ sinh</option></select>
                  </div>
                  <input className="input" value={image.intendedSection} onChange={(e) => setDraft((current) => current ? { ...current, images: current.images.map((item) => item.id === image.id ? { ...item, intendedSection: e.target.value } : item) } : current)} onBlur={(e) => void run(`image-section-${image.id}`, () => updateJapanVipContentImage(id, image.id, { intendedSection: e.target.value }))} placeholder="Phần bài phù hợp, ví dụ: Công nghệ IH" />
                  {image.role === "feature-small" && <input className="input" value={image.featureGroup} onChange={(e) => setDraft((current) => current ? { ...current, images: current.images.map((item) => item.id === image.id ? { ...item, featureGroup: e.target.value } : item) } : current)} onBlur={(e) => void run(`image-group-${image.id}`, () => updateJapanVipContentImage(id, image.id, { featureGroup: e.target.value }))} placeholder="Tên bảng gom, ví dụ: 6 công nghệ lõi" />}
                  <input className="input" value={image.caption} onChange={(e) => setDraft((current) => current ? { ...current, images: current.images.map((item) => item.id === image.id ? { ...item, caption: e.target.value } : item) } : current)} onBlur={(e) => void run(`image-caption-${image.id}`, () => updateJapanVipContentImage(id, image.id, { caption: e.target.value }))} placeholder="Chú thích giải thích đúng điều ảnh đang chứng minh" />
                  <input className="input" value={image.altText} onChange={(e) => setDraft((current) => current ? { ...current, images: current.images.map((item) => item.id === image.id ? { ...item, altText: e.target.value } : item) } : current)} onBlur={(e) => void run(`image-alt-${image.id}`, () => updateJapanVipContentImage(id, image.id, { altText: e.target.value }))} placeholder="Alt text tiếng Việt" />
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-[11px] text-[var(--text-muted)]">{image.width && image.height ? `${image.width}×${image.height}px` : "Chưa đọc được kích thước"} · {image.sourceType === "official" ? "Nguồn hãng" : image.sourceType}</span><IconButton label="Xóa ảnh" tone="danger" size="sm" disabled={busy !== null} onClick={() => void run(`delete-image-${image.id}`, () => deleteJapanVipContentImage(id, image.id))}><Trash2 size={14} /></IconButton></div>
                </div>
              </article>)}
            </div> : <p className="py-8 text-center text-sm text-[var(--text-muted)]">Chưa có ảnh. Hãy dán trang gallery hoặc feature chính thức của hãng.</p>}
          </Card>
        </section>

        <section className="scroll-mt-28">
          <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"><Brain size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Giai đoạn 3</p><h2 className="text-xl font-bold">Ngữ cảnh và bài tham khảo</h2></div></div>
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
        </section>

        <section className="scroll-mt-28">
          <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"><PenTool size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Giai đoạn 4</p><h2 className="text-xl font-bold">Không gian biên tập</h2></div></div>
          <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(360px,0.75fr)_minmax(0,1.25fr)]">
          <div id="outline" className="scroll-mt-28">
          <Card title="Dàn ý SEO" actions={<Button small disabled={busy !== null || (draft.sources.length === 0 && draft.facts.length === 0)} onClick={() => void run("outline", () => generateJapanVipOutline(id))}><Sparkles size={14} /> {busy === "outline" ? "Đang tạo…" : `${AI_LABEL[draft.aiProvider]} tạo dàn ý`}</Button>}>
            <textarea className="input min-h-[520px] resize-y font-mono text-sm leading-6" value={draft.outline} onChange={(e) => patch("outline", e.target.value)} placeholder="## Tổng quan sản phẩm…" />
          </Card>
          </div>

          <div id="article" className="scroll-mt-28">
          <Card title="Bài viết Markdown" actions={<Button small disabled={busy !== null || !draft.outline.trim()} onClick={() => void run("article", () => generateJapanVipArticle(id))}><Sparkles size={14} /> {busy === "article" ? "Đang viết…" : `${AI_LABEL[draft.aiProvider]} viết bài`}</Button>}>
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]"><span>Bản thảo làm việc</span><span>{articleWords.toLocaleString("vi-VN")} từ</span></div>
            <textarea className="input min-h-[520px] resize-y font-mono text-sm leading-6" value={draft.article} onChange={(e) => patch("article", e.target.value)} placeholder="Bài viết hoàn chỉnh sẽ xuất hiện tại đây…" />
          </Card>
          </div>
          </div>
        </section>

        <section id="review" className="scroll-mt-28">
          <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"><ShieldCheck size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Giai đoạn 5</p><h2 className="text-xl font-bold">Kiểm soát chất lượng</h2></div></div>
          <Card title="AI chấm điểm & phản biện" actions={<Button small disabled={busy !== null || !draft.article.trim()} onClick={() => void run("hermes-review", () => reviewJapanVipArticleWithHermes(id))}><ShieldCheck size={14} /> {busy === "hermes-review" ? "Ollama Cloud đang chấm…" : draft.hermesReviews.length ? "Chấm lại bằng Ollama Cloud" : "Ollama Cloud chấm bài"}</Button>}>
            {draft.hermesReviews.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">Sau khi viết bài, dùng Hermes làm giám khảo độc lập. Nhận xét chưa tự động trở thành quy tắc chung.</p>
            ) : (() => {
              const review = draft.hermesReviews[0];
              return <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--primary)] bg-[var(--surface-subtle)] p-4">
                  <div className="text-4xl font-bold text-[var(--primary)]">{review.totalScore}<span className="text-base text-[var(--text-muted)]">/100</span></div>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">Vòng chấm {review.round}</p>{review.evaluator && <Badge tone={review.evaluator.fallback ? "running" : "success"} label={review.evaluator.fallback ? `Dự phòng: Hermes · ${review.evaluator.model}` : `Ollama Cloud · ${review.evaluator.model}`} />}</div><p className="mt-1 text-sm text-[var(--text-muted)]">{review.summary}</p></div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {review.criteria.map((criterion) => <div key={criterion.key} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <div className="flex justify-between gap-2 text-sm font-semibold"><span>{criterion.label}</span><span className="text-[var(--primary)]">{criterion.score}/100</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-subtle)]"><div className="h-full bg-[var(--primary)]" style={{ width: `${criterion.score}%` }} /></div>
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{criterion.feedback}</p>
                  </div>)}
                </div>
                {review.revisionInstructions.length > 0 && <div><p className="mb-2 font-semibold">Việc cần sửa</p><ul className="list-disc space-y-1 pl-5 text-sm">{review.revisionInstructions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">Sửa có chọn lọc</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">AI chỉ đề xuất các đoạn thay thế. Bài viết chưa thay đổi cho tới khi bạn xem và áp dụng.</p>
                    </div>
                    <Badge tone="muted" label={`Dùng ${AI_LABEL[draft.aiProvider]}`} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {REVISION_OPTIONS.map((option) => {
                      const checked = revisionCategories.includes(option.id);
                      return <label key={option.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${checked ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_12%,var(--surface))] text-[var(--primary)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"}`}>
                        <input className="sr-only" type="checkbox" checked={checked} disabled={busy !== null} onChange={(e) => setRevisionCategories((current) => e.target.checked ? [...current, option.id] : current.filter((item) => item !== option.id))} />
                        {option.label}
                      </label>;
                    })}
                  </div>
                  <textarea className="input mt-3 min-h-20 resize-y" value={revisionRequest} disabled={busy !== null} onChange={(e) => setRevisionRequest(e.target.value)} placeholder="Yêu cầu sửa vòng này, ví dụ: giữ nguyên bảng thông số, chỉ rút gọn CTA cuối bài…" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button small disabled={busy !== null || review.revisionInstructions.length === 0 || revisionCategories.length === 0} onClick={() => void run("selective-preview", async () => {
                      const next = await previewJapanVipSelectiveRevision(id, { categories: revisionCategories, request: revisionRequest.trim() });
                      setSelectedRevisionChangeIds(next.selectiveRevision?.changes.map((change) => change.id) ?? []);
                      return next;
                    })}><WandSparkles size={14} /> {busy === "selective-preview" ? `${AI_LABEL[draft.aiProvider]} đang đề xuất…` : draft.selectiveRevision ? "Tạo lại bản xem trước" : "Xem trước phần cần sửa"}</Button>
                    {draft.selectiveRevision && <Button small variant="secondary" disabled={busy !== null} onClick={() => void run("selective-cancel", async () => {
                      const next = await cancelJapanVipSelectiveRevision(id);
                      setSelectedRevisionChangeIds([]);
                      return next;
                    })}><Trash2 size={14} /> Bỏ bản xem trước</Button>}
                  </div>
                </div>
                {draft.selectiveRevision && <div className="rounded-[var(--radius)] border-2 border-[var(--primary)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-semibold">Bản xem trước thay đổi</p><p className="mt-1 text-xs text-[var(--text-muted)]">{draft.selectiveRevision.changes.length} đề xuất · chọn từng mục muốn áp dụng</p></div>
                    <Button small disabled={busy !== null || selectedRevisionChangeIds.length === 0} onClick={() => void run("selective-apply", async () => {
                      const next = await applyJapanVipSelectiveRevision(id, selectedRevisionChangeIds);
                      setSelectedRevisionChangeIds([]);
                      return next;
                    })}><CheckCircle2 size={14} /> {busy === "selective-apply" ? "Đang áp dụng…" : `Áp dụng ${selectedRevisionChangeIds.length} thay đổi`}</Button>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    {draft.selectiveRevision.changes.map((change, index) => {
                      const checked = selectedRevisionChangeIds.includes(change.id);
                      return <div key={change.id} className={`rounded-[var(--radius)] border p-3 ${checked ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_5%,var(--surface))]" : "border-[var(--border)] opacity-65"}`}>
                        <label className="flex cursor-pointer items-start gap-3">
                          <input className="mt-1 h-4 w-4 accent-[var(--primary)]" type="checkbox" checked={checked} disabled={busy !== null} onChange={(e) => setSelectedRevisionChangeIds((current) => e.target.checked ? [...current, change.id] : current.filter((item) => item !== change.id))} />
                          <span className="min-w-0 flex-1"><span className="font-semibold">{index + 1}. {REVISION_LABEL[change.category]}</span>{change.reason && <span className="mt-1 block text-xs text-[var(--text-muted)]">{change.reason}</span>}</span>
                        </label>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <div className="min-w-0 rounded-[var(--radius)] border border-red-200 bg-red-50 p-3 text-sm text-red-950"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-red-700">Đoạn hiện tại</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">{change.before}</pre></div>
                          <div className="min-w-0 rounded-[var(--radius)] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">Đoạn đề xuất</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">{change.after}</pre></div>
                        </div>
                      </div>;
                    })}
                  </div>
                </div>}
                {review.suggestedRules.length > 0 && <div className="border-t border-[var(--border)] pt-4"><p className="font-semibold">Quy tắc Hermes đề xuất — chỉ lưu khi bạn duyệt</p><div className="mt-2 flex flex-col gap-2">{review.suggestedRules.map((rule) => <div key={rule} className="flex items-start justify-between gap-3 rounded-[var(--radius)] bg-[var(--surface-subtle)] p-3 text-sm"><span>{rule}</span><Button small variant="secondary" disabled={busy !== null} onClick={() => void run(`hermes-rule-${rule}`, async () => { const next = await addJapanVipContentFeedback(id, { category: "Hermes đề xuất", note: rule, saveAsRule: true }); setLearning(await getJapanVipLearningLibrary()); return next; })}>Duyệt & lưu</Button></div>)}</div></div>}
              </div>;
            })()}
          </Card>
        </section>

        <section id="approval" className="scroll-mt-28">
          <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"><FileCheck2 size={18} /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Giai đoạn 6</p><h2 className="text-xl font-bold">Duyệt và ghi nhớ</h2></div></div>
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
                    <div key={item.id} className="flex items-start gap-3 rounded-[var(--radius)] bg-[var(--surface-subtle)] p-3 text-sm">
                      <div className="min-w-0 flex-1"><span className="font-medium">{item.category}:</span> {item.note}
                      {item.savedAsRule && <span className="ml-2 text-xs text-[var(--primary)]">Đã lưu vào bộ nhớ chung</span>}</div>
                      <IconButton label="Xóa bài học" tone="danger" size="sm" disabled={busy !== null} onClick={() => void run(`delete-feedback-${item.id}`, async () => { const next = await deleteJapanVipContentFeedback(id, item.id); setLearning(await getJapanVipLearningLibrary()); return next; })}><Trash2 size={14} /></IconButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
