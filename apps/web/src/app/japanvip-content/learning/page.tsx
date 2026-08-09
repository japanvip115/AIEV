"use client";

import { ArrowLeft, BookOpenCheck, CheckCircle2, ChevronDown, ExternalLink, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { IconButton } from "@/components/IconButton";
import { LinkButton } from "@/components/LinkButton";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import {
  addJapanVipLearningRule,
  addJapanVipOwnedArticle,
  addJapanVipReferenceArticle,
  approveJapanVipOwnedArticle,
  deleteJapanVipLearningRule,
  deleteJapanVipReferenceArticle,
  getJapanVipLearningLibrary,
  getJapanVipAiStatus,
  improveJapanVipOwnedArticle,
  rejectJapanVipOwnedArticle,
  reviewJapanVipOwnedImprovement,
  reviewJapanVipOwnedArticle,
  updateJapanVipLearningRule,
  updateJapanVipReferenceArticle,
  type JapanVipLearningLibrary,
  type JapanVipAiProvider,
  type JapanVipAiStatus,
  type JapanVipReferenceKind,
} from "@/lib/api";
import { ImageFormatCard } from "../ImageFormatCard";
import { AI_LABEL, AiProviderSelect } from "../shared";

const KIND_LABEL: Record<JapanVipReferenceKind, string> = {
  competitor: "Đối thủ",
  inspiration: "Bài hay cần học",
  japanvip: "Bài Japan VIP",
};

/** Ngưỡng duyệt bài mẫu: tổng ≥85 VÀ độ chính xác ≥80. Đủ 75 thì mới đáng cải thiện. */
const GATE_TOTAL = 85;
const GATE_ACCURACY = 80;
const IMPROVABLE_TOTAL = 75;

export default function JapanVipLearningPage() {
  const [library, setLibrary] = useState<JapanVipLearningLibrary | null>(null);
  const [aiStatus, setAiStatus] = useState<JapanVipAiStatus | null>(null);
  const [url, setUrl] = useState("");
  const [ownedUrl, setOwnedUrl] = useState("");
  const [ownedTags, setOwnedTags] = useState("");
  const [ownedManualTitle, setOwnedManualTitle] = useState("");
  const [ownedManualText, setOwnedManualText] = useState("");
  const [kind, setKind] = useState<JapanVipReferenceKind>("competitor");
  const [aiProvider, setAiProvider] = useState<JapanVipAiProvider>("codex");
  const [tags, setTags] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [rule, setRule] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const [improvementProviders, setImprovementProviders] = useState<Record<string, "ollama-cloud" | "codex">>({});

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
        actions={<LinkButton href="/japanvip-content"><ArrowLeft size={15} /> Content Project</LinkButton>}
      />
      {error && <ErrorBanner message="Thao tác chưa hoàn tất" detail={error} />}

      <Card title="Chấm bài đã xuất bản trên JapanVIP" actions={<Badge tone="success" label="Nguồn nội bộ" />}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          Dán URL bài trên japanvip.vn. Ollama Cloud GPT-OSS 120B sẽ chấm 6 tiêu chí; bài chỉ được duyệt làm nguồn học khi tổng điểm ≥85 và độ chính xác ≥80.
        </p>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px_auto]">
          <input className="input" value={ownedUrl} onChange={(e) => setOwnedUrl(e.target.value)} placeholder="https://japanvip.vn/bai-viet/..." />
          <input className="input" value={ownedTags} onChange={(e) => setOwnedTags(e.target.value)} placeholder="Nồi cơm, bài tư vấn…" />
          <Button disabled={!ownedUrl.trim() || busy !== null} onClick={() => void run("add-owned", async () => {
            const next = await addJapanVipOwnedArticle({ url: ownedUrl.trim(), tags: ownedTags.split(",").map((tag) => tag.trim()).filter(Boolean), title: ownedManualTitle.trim() || undefined, text: ownedManualText.trim() || undefined });
            setOwnedUrl("");
            setOwnedTags("");
            setOwnedManualTitle("");
            setOwnedManualText("");
            return next;
          })}><ShieldCheck size={15} /> {busy === "add-owned" ? "Ollama Cloud đang chấm…" : "Nhập và chấm bằng Ollama Cloud"}</Button>
        </div>
        <details className="panel mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">Trang chặn bot hoặc dùng JavaScript? Dán nội dung bài tại đây</summary>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Giữ URL bài ở ô phía trên, rồi sao chép phần nội dung bài viết và dán bên dưới. Bản gốc trên website không bị thay đổi.</p>
          <input className="input mt-3" value={ownedManualTitle} onChange={(e) => setOwnedManualTitle(e.target.value)} placeholder="Tên bài viết" />
          <textarea className="input mt-2 min-h-44 resize-y" value={ownedManualText} onChange={(e) => setOwnedManualText(e.target.value)} placeholder="Dán nội dung bài viết (tối thiểu 200 ký tự)…" />
          <p className={`mt-2 text-xs ${ownedManualText.trim().length >= 200 ? "text-emerald-700" : "text-[var(--text-muted)]"}`}>{ownedManualText.trim().length}/200 ký tự tối thiểu</p>
        </details>
        <p className="mt-3 text-xs text-[var(--text-muted)]">Bài đạt điểm vẫn cần bạn bấm duyệt. Nội dung được dùng để học cách viết, không tự trở thành nguồn xác thực thông số sản phẩm.</p>
      </Card>

      <Card title="Thêm bài viết cần học" actions={<Badge tone="muted" label="Không dùng làm nguồn sự thật" />}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          AI sẽ bóc tách cách trình bày, bố cục và kỹ thuật thuyết phục. Hệ thống không được sao chép câu chữ hoặc lấy claim sản phẩm từ bài này.
        </p>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_190px_210px_auto]">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán URL bài đối thủ hoặc bài cần học…" />
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as JapanVipReferenceKind)}>
            {(Object.entries(KIND_LABEL) as Array<[JapanVipReferenceKind, string]>).filter(([value]) => value !== "japanvip").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <AiProviderSelect aria-label="AI phân tích" value={aiProvider} onChange={setAiProvider} />
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Nồi cơm, mở bài, SEO…" />
          <Button disabled={!url.trim() || busy !== null} onClick={() => void run("add-article", async () => {
            const next = await addJapanVipReferenceArticle({ url: url.trim(), kind, aiProvider, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), title: manualTitle.trim() || undefined, text: manualText.trim() || undefined });
            setUrl("");
            setTags("");
            setManualTitle("");
            setManualText("");
            return next;
          })}><Plus size={15} /> {busy === "add-article" ? `${AI_LABEL[aiProvider]} đang phân tích…` : "Thêm và phân tích"}</Button>
        </div>
        <details className="panel mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">Không bóc được URL? Dán nội dung bài cần học</summary>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Hệ thống vẫn giữ URL để đối chiếu, nhưng AI chỉ phân tích phần chữ bạn dán; không dùng bài này làm nguồn xác thực thông số.</p>
          <input className="input mt-3" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="Tên bài viết" />
          <textarea className="input mt-2 min-h-44 resize-y" value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="Dán nội dung bài viết (tối thiểu 200 ký tự)…" />
          <p className={`mt-2 text-xs ${manualText.trim().length >= 200 ? "text-emerald-700" : "text-[var(--text-muted)]"}`}>{manualText.trim().length}/200 ký tự tối thiểu</p>
        </details>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Ollama: {aiStatus?.ollama.running
            ? aiStatus.ollama.installed ? `Sẵn sàng · ${aiStatus.ollama.model}` : `Đang chạy nhưng thiếu ${aiStatus.ollama.model}`
            : "Chưa chạy"}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Ollama Cloud: {aiStatus?.ollamaCloud.running && aiStatus.ollamaCloud.available
            ? `Sẵn sàng · ${aiStatus.ollamaCloud.model}`
            : aiStatus?.ollamaCloud.error || "Chưa sẵn sàng"}
        </p>
      </Card>

      <ImageFormatCard />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Thư viện bài tham khảo">
          <p className="mb-3 text-xs text-[var(--text-muted)]">Bấm vào từng bài để mở chi tiết. Việc mở hoặc thu gọn không gọi AI và không tốn hạn mức.</p>
          <div className="flex flex-col gap-3">
            {library.articles.map((article) => {
              const review = article.hermesReview;
              const approvalReview = article.improvementDraft?.review ?? review;
              const passesGate = Boolean(approvalReview && approvalReview.totalScore >= GATE_TOTAL && approvalReview.accuracyScore >= GATE_ACCURACY);
              const originalPassesGate = Boolean(review && review.totalScore >= GATE_TOTAL && review.accuracyScore >= GATE_ACCURACY);
              const canImprove = Boolean(approvalReview && approvalReview.totalScore >= IMPROVABLE_TOTAL && !passesGate && article.approvalStatus !== "approved");
              const improvementRound = article.improvementDraft?.round ?? 0;
              const recommendedImprovementProvider: "ollama-cloud" | "codex" = improvementRound >= 2 ? "codex" : "ollama-cloud";
              const selectedImprovementProvider = improvementProviders[article.id] ?? recommendedImprovementProvider;
              return (
              <details key={article.id} open={openArticleId === article.id} className="group overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                <summary onClick={(event) => { event.preventDefault(); setOpenArticleId((current) => current === article.id ? null : article.id); }} className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-subtle)] [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={17} className="shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-180" />
                  {article.kind === "japanvip" ? <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${article.approvalStatus === "approved" ? "bg-[var(--success-bg)] text-[var(--success)]" : article.approvalStatus === "rejected" ? "bg-[var(--danger-bg)] text-[var(--danger)]" : "bg-amber-100 text-amber-700"}`}>{article.approvalStatus === "approved" ? <CheckCircle2 size={15} /> : article.approvalStatus === "rejected" ? <XCircle size={15} /> : <ShieldCheck size={15} />}</span> : <BookOpenCheck size={20} className="shrink-0 text-[var(--primary)]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{article.title}</span>
                      <Badge tone={article.kind === "japanvip" ? "success" : "muted"} label={KIND_LABEL[article.kind]} />
                      {article.kind === "japanvip" && <Badge tone={article.approvalStatus === "approved" ? "success" : article.approvalStatus === "rejected" ? "danger" : "running"} label={article.approvalStatus === "approved" ? "Đã duyệt" : article.approvalStatus === "rejected" ? "Đã loại" : "Chờ duyệt"} />}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{article.siteName || "Nguồn web"}{article.tags.length ? ` · ${article.tags.join(", ")}` : ""}</p>
                  </div>
                  {review && <div className="shrink-0 text-right"><p className={`text-sm font-bold ${passesGate ? "text-emerald-600" : "text-amber-600"}`}>{approvalReview?.totalScore ?? review.totalScore}/100</p><p className="text-xs text-[var(--text-muted)]">Chính xác {approvalReview?.accuracyScore ?? review.accuracyScore}</p></div>}
                </summary>
                <div className="border-t border-[var(--border)] p-4">
                <div className="flex items-start gap-3">
                  {article.kind !== "japanvip" ? <input
                    className="mt-1 h-4 w-4 accent-[var(--primary)]"
                    type="checkbox"
                    checked={article.active}
                    aria-label={`Bật ${article.title}`}
                    disabled={busy !== null}
                    onChange={(e) => void run(`article-${article.id}`, () => updateJapanVipReferenceArticle(article.id, { active: e.target.checked }))}
                  /> : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={article.canonicalUrl ?? article.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--primary)]">
                        Mở bài gốc <ExternalLink size={13} />
                      </a>
                      {article.tags.length > 0 && <span className="text-xs text-[var(--text-muted)]">{article.tags.join(", ")}</span>}
                    </div>
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
                    {article.kind === "japanvip" && review && (
                      <Panel className="mt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div><div className="flex items-baseline gap-2"><span className={`text-[28px] font-bold leading-tight tabular-nums ${originalPassesGate ? "text-emerald-600" : "text-amber-600"}`}>{review.totalScore}/100</span><span className="text-xs text-[var(--text-muted)]">Độ chính xác {review.accuracyScore}/100</span></div>{review.evaluator && <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">{review.evaluator.fallback ? `Dự phòng: Hermes · ${review.evaluator.model}` : `Chấm bởi Ollama Cloud · ${review.evaluator.model}`}</p>}</div>
                          <div className="flex flex-wrap gap-2">
                            <Button small variant="secondary" disabled={busy !== null} title="Chấm lại nguyên văn bài mẫu đã sao chép" onClick={() => void run(`review-${article.id}`, () => reviewJapanVipOwnedArticle(article.id))}><RotateCcw size={13} /> Chấm lại bài gốc</Button>
                            {canImprove && <select className="input h-8 min-h-0 w-auto py-1 text-xs" aria-label={`AI cải thiện ${article.title}`} value={selectedImprovementProvider} disabled={busy !== null} onChange={(event) => setImprovementProviders((current) => ({ ...current, [article.id]: event.target.value as "ollama-cloud" | "codex" }))}><option value="ollama-cloud">Ollama Cloud · tiết kiệm</option><option value="codex">ChatGPT · chất lượng cao</option></select>}
                            {canImprove && <Button small variant={improvementRound >= 2 ? "primary" : "secondary"} disabled={busy !== null} onClick={() => void run(`improve-${article.id}`, async () => { const next = await improveJapanVipOwnedArticle(article.id, selectedImprovementProvider); setImprovementProviders((current) => { const copy = { ...current }; delete copy[article.id]; return copy; }); return next; })}><Sparkles size={13} /> {busy === `improve-${article.id}` ? `${selectedImprovementProvider === "codex" ? "ChatGPT" : "Ollama"} đang cải thiện…` : article.improvementDraft?.review ? "Cải thiện tiếp điểm còn yếu" : article.improvementDraft ? "Tạo lại bản cải thiện" : "Cải thiện phần điểm thấp"}</Button>}
                            {article.approvalStatus !== "rejected" && <Button small variant="secondary" disabled={busy !== null} onClick={() => void run(`reject-${article.id}`, () => rejectJapanVipOwnedArticle(article.id))}><XCircle size={13} /> Loại</Button>}
                            {article.approvalStatus !== "approved" && <Button small disabled={busy !== null || !passesGate} title={!passesGate ? "Cần tổng ≥85 và độ chính xác ≥80" : undefined} onClick={() => void run(`approve-${article.id}`, () => approveJapanVipOwnedArticle(article.id))}><CheckCircle2 size={13} /> {article.improvementDraft?.review ? "Duyệt bản cải thiện" : "Duyệt làm nguồn"}</Button>}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {review.criteria.map((criterion) => <div key={criterion.key} className="rounded-[var(--radius)] bg-[var(--surface)] p-3"><div className="flex items-center justify-between gap-2 text-xs font-semibold"><span>{criterion.label}</span><span>{criterion.score}/100</span></div><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{criterion.feedback}</p></div>)}
                        </div>
                        {review.issues.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-amber-700">Điểm cần cải thiện ({review.issues.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">{review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}
                        {!passesGate && approvalReview && approvalReview.totalScore >= 85 && approvalReview.accuracyScore < 80 && (
                          <div className="mt-3 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            <p className="font-semibold">Chưa thể duyệt dù tổng điểm là {approvalReview.totalScore}/100</p>
                            <p className="mt-1">Độ chính xác đang là {approvalReview.accuracyScore}/100, cần tối thiểu 80. Hãy bấm <strong>Cải thiện phần điểm thấp</strong>; AI chỉ xử lý claim hoặc câu chưa đủ căn cứ, không viết lại bài và không sửa bài mẫu gốc.</p>
                          </div>
                        )}
                        {canImprove && improvementRound >= 2 && <p className="mt-3 rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">Bài đã cải thiện {improvementRound} vòng bằng AI. Hệ thống đề xuất chuyển sang ChatGPT để thoát khỏi vùng điểm đang bị lặp.</p>}
                        {article.improvementDraft && (
                          <div className="mt-3 rounded-[var(--radius)] border-2 border-emerald-300 bg-emerald-50/60 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="flex items-center gap-2 font-semibold text-emerald-800"><ShieldCheck size={16} /> Bản cải thiện riêng · bản gốc được khóa</p>
                                <p className="mt-1 text-xs text-emerald-800/80">Vòng {article.improvementDraft.round ?? 1} · {article.improvementDraft.provider === "codex" ? "ChatGPT/Codex" : "Ollama Cloud"} · chỉ thay {article.improvementDraft.changes.length} đoạn điểm thấp. Nội dung bài mẫu đã sao chép không bị sửa.</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {article.improvementDraft.review && <span className={`text-sm font-bold ${passesGate ? "text-emerald-700" : "text-amber-700"}`}>{article.improvementDraft.review.totalScore}/100 <span className="text-xs font-normal">· chính xác {article.improvementDraft.review.accuracyScore}</span></span>}
                                <Button small variant="secondary" disabled={busy !== null} onClick={() => void run(`improvement-review-${article.id}`, () => reviewJapanVipOwnedImprovement(article.id))}><RotateCcw size={13} /> {article.improvementDraft.review ? "Chấm lại bản cải thiện" : "Chấm bản cải thiện"}</Button>
                              </div>
                            </div>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-sm font-medium text-emerald-800">Xem các đoạn được sửa ({article.improvementDraft.changes.length})</summary>
                              <div className="mt-2 space-y-2">
                                {article.improvementDraft.changes.map((change, index) => <div key={change.id} className="rounded-[var(--radius)] border border-emerald-200 bg-[var(--surface)] p-3 text-xs leading-5"><p className="font-semibold text-[var(--text)]">Thay đổi {index + 1}: {change.reason}</p><p className="mt-1 text-[var(--danger)]"><span className="font-semibold">Trước:</span> {change.before}</p><p className="mt-1 text-emerald-700"><span className="font-semibold">Sau:</span> {change.after}</p></div>)}
                              </div>
                            </details>
                            {article.improvementDraft.review && article.improvementDraft.review.issues.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-amber-700">Bản cải thiện còn {article.improvementDraft.review.issues.length} điểm cần xử lý</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">{article.improvementDraft.review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}
                          </div>
                        )}
                      </Panel>
                    )}
                  </div>
                  <IconButton label="Xóa bài tham khảo" tone="danger" size="sm" disabled={busy !== null} onClick={() => void run(`delete-${article.id}`, () => deleteJapanVipReferenceArticle(article.id))}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                </div>
              </details>
            );})}
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
