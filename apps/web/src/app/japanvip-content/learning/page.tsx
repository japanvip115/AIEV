"use client";

import { ArrowLeft, BookOpenCheck, CheckCircle2, ChevronDown, ExternalLink, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, XCircle } from "lucide-react";
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

const KIND_LABEL: Record<JapanVipReferenceKind, string> = {
  competitor: "Đối thủ",
  inspiration: "Bài hay cần học",
  japanvip: "Bài Japan VIP",
};

const AI_LABEL: Record<JapanVipAiProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  ollama: "Ollama Local",
  "ollama-cloud": "Ollama Cloud",
};

export default function JapanVipLearningPage() {
  const [library, setLibrary] = useState<JapanVipLearningLibrary | null>(null);
  const [aiStatus, setAiStatus] = useState<JapanVipAiStatus | null>(null);
  const [url, setUrl] = useState("");
  const [ownedUrl, setOwnedUrl] = useState("");
  const [ownedTags, setOwnedTags] = useState("");
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

      <Card title="Chấm bài đã xuất bản trên JapanVIP" actions={<Badge tone="success" label="Nguồn nội bộ" />}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          Dán URL bài trên japanvip.vn. Ollama Cloud GPT-OSS 120B sẽ chấm 6 tiêu chí; bài chỉ được duyệt làm nguồn học khi tổng điểm ≥85 và độ chính xác ≥80.
        </p>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px_auto]">
          <input className="input" value={ownedUrl} onChange={(e) => setOwnedUrl(e.target.value)} placeholder="https://japanvip.vn/bai-viet/..." />
          <input className="input" value={ownedTags} onChange={(e) => setOwnedTags(e.target.value)} placeholder="Nồi cơm, bài tư vấn…" />
          <Button disabled={!ownedUrl.trim() || busy !== null} onClick={() => void run("add-owned", async () => {
            const next = await addJapanVipOwnedArticle({ url: ownedUrl.trim(), tags: ownedTags.split(",").map((tag) => tag.trim()).filter(Boolean) });
            setOwnedUrl("");
            setOwnedTags("");
            return next;
          })}><ShieldCheck size={15} /> {busy === "add-owned" ? "Ollama Cloud đang chấm…" : "Nhập và chấm bằng Ollama Cloud"}</Button>
        </div>
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
          <select className="input" aria-label="AI phân tích" value={aiProvider} onChange={(e) => setAiProvider(e.target.value as JapanVipAiProvider)}>
            <option value="codex">ChatGPT (Codex CLI)</option>
            <option value="claude">Claude Code</option>
            <option value="ollama">Ollama Local (qwen3:14b)</option>
            <option value="ollama-cloud">Ollama Cloud (GPT-OSS 120B)</option>
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
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Ollama Cloud: {aiStatus?.ollamaCloud.running && aiStatus.ollamaCloud.available
            ? `Sẵn sàng · ${aiStatus.ollamaCloud.model}`
            : aiStatus?.ollamaCloud.error || "Chưa sẵn sàng"}
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Thư viện bài tham khảo">
          <p className="mb-3 text-xs text-[var(--text-muted)]">Bấm vào từng bài để mở chi tiết. Việc mở hoặc thu gọn không gọi AI và không tốn hạn mức.</p>
          <div className="flex flex-col gap-3">
            {library.articles.map((article) => {
              const review = article.hermesReview;
              const approvalReview = article.improvementDraft?.review ?? review;
              const passesGate = Boolean(approvalReview && approvalReview.totalScore >= 85 && approvalReview.accuracyScore >= 80);
              const originalPassesGate = Boolean(review && review.totalScore >= 85 && review.accuracyScore >= 80);
              const canImprove = Boolean(approvalReview && approvalReview.totalScore >= 75 && !passesGate && article.approvalStatus !== "approved");
              return (
              <details key={article.id} className="group overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-subtle)] [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={17} className="shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-180" />
                  {article.kind === "japanvip" ? <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${article.approvalStatus === "approved" ? "bg-emerald-100 text-emerald-700" : article.approvalStatus === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{article.approvalStatus === "approved" ? <CheckCircle2 size={15} /> : article.approvalStatus === "rejected" ? <XCircle size={15} /> : <ShieldCheck size={15} />}</span> : <BookOpenCheck size={20} className="shrink-0 text-[var(--primary)]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{article.title}</span>
                      <Badge tone={article.kind === "japanvip" ? "success" : "muted"} label={KIND_LABEL[article.kind]} />
                      {article.kind === "japanvip" && <Badge tone={article.approvalStatus === "approved" ? "success" : article.approvalStatus === "rejected" ? "danger" : "running"} label={article.approvalStatus === "approved" ? "Đã duyệt" : article.approvalStatus === "rejected" ? "Đã loại" : "Chờ duyệt"} />}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{article.siteName || "Nguồn web"}{article.tags.length ? ` · ${article.tags.join(", ")}` : ""}</p>
                  </div>
                  {review && <div className="shrink-0 text-right"><p className={`text-lg font-bold ${passesGate ? "text-emerald-600" : "text-amber-600"}`}>{approvalReview?.totalScore ?? review.totalScore}/100</p><p className="text-[11px] text-[var(--text-muted)]">Chính xác {approvalReview?.accuracyScore ?? review.accuracyScore}</p></div>}
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
                  /> : <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${article.approvalStatus === "approved" ? "bg-emerald-100 text-emerald-700" : article.approvalStatus === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{article.approvalStatus === "approved" ? <CheckCircle2 size={15} /> : article.approvalStatus === "rejected" ? <XCircle size={15} /> : <ShieldCheck size={15} />}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={article.canonicalUrl ?? article.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--primary)]">
                        {article.title} <ExternalLink size={13} />
                      </a>
                      <Badge tone={article.kind === "japanvip" ? "success" : "muted"} label={KIND_LABEL[article.kind]} />
                      {article.kind === "japanvip" && <Badge tone={article.approvalStatus === "approved" ? "success" : article.approvalStatus === "rejected" ? "danger" : "running"} label={article.approvalStatus === "approved" ? "Đã duyệt làm nguồn" : article.approvalStatus === "rejected" ? "Đã loại" : "Chờ duyệt"} />}
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
                    {article.kind === "japanvip" && review && (
                      <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div><div className="flex items-baseline gap-2"><span className={`text-2xl font-bold ${originalPassesGate ? "text-emerald-600" : "text-amber-600"}`}>{review.totalScore}/100</span><span className="text-xs text-[var(--text-muted)]">Độ chính xác {review.accuracyScore}/100</span></div>{review.evaluator && <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">{review.evaluator.fallback ? `Dự phòng: Hermes · ${review.evaluator.model}` : `Chấm bởi Ollama Cloud · ${review.evaluator.model}`}</p>}</div>
                          <div className="flex flex-wrap gap-2">
                            <Button small variant="secondary" disabled={busy !== null} title="Chấm lại nguyên văn bài mẫu đã sao chép" onClick={() => void run(`review-${article.id}`, () => reviewJapanVipOwnedArticle(article.id))}><RotateCcw size={13} /> Chấm lại bài gốc</Button>
                            {canImprove && <Button small variant="secondary" disabled={busy !== null} onClick={() => void run(`improve-${article.id}`, () => improveJapanVipOwnedArticle(article.id))}><Sparkles size={13} /> {busy === `improve-${article.id}` ? "Đang sửa chọn lọc…" : article.improvementDraft?.review ? "Cải thiện tiếp điểm còn yếu" : article.improvementDraft ? "Tạo lại bản cải thiện" : "Cải thiện phần điểm thấp"}</Button>}
                            {article.approvalStatus !== "rejected" && <Button small variant="secondary" disabled={busy !== null} onClick={() => void run(`reject-${article.id}`, () => rejectJapanVipOwnedArticle(article.id))}><XCircle size={13} /> Loại</Button>}
                            {article.approvalStatus !== "approved" && <Button small disabled={busy !== null || !passesGate} title={!passesGate ? "Cần tổng ≥85 và độ chính xác ≥80" : undefined} onClick={() => void run(`approve-${article.id}`, () => approveJapanVipOwnedArticle(article.id))}><CheckCircle2 size={13} /> {article.improvementDraft?.review ? "Duyệt bản cải thiện" : "Duyệt làm nguồn"}</Button>}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {review.criteria.map((criterion) => <div key={criterion.key} className="rounded-[var(--radius)] bg-[var(--surface)] p-2.5"><div className="flex items-center justify-between gap-2 text-xs font-semibold"><span>{criterion.label}</span><span>{criterion.score}/100</span></div><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{criterion.feedback}</p></div>)}
                        </div>
                        {review.issues.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-amber-700">Điểm cần cải thiện ({review.issues.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">{review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}
                        {!passesGate && approvalReview && approvalReview.totalScore >= 85 && approvalReview.accuracyScore < 80 && (
                          <div className="mt-3 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            <p className="font-semibold">Chưa thể duyệt dù tổng điểm là {approvalReview.totalScore}/100</p>
                            <p className="mt-1">Độ chính xác đang là {approvalReview.accuracyScore}/100, cần tối thiểu 80. Hãy bấm <strong>Cải thiện phần điểm thấp</strong>; AI chỉ xử lý claim hoặc câu chưa đủ căn cứ, không viết lại bài và không sửa bài mẫu gốc.</p>
                          </div>
                        )}
                        {article.improvementDraft && (
                          <div className="mt-3 rounded-[var(--radius)] border-2 border-emerald-300 bg-emerald-50/60 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="flex items-center gap-2 font-semibold text-emerald-800"><ShieldCheck size={16} /> Bản cải thiện riêng · bản gốc được khóa</p>
                                <p className="mt-1 text-xs text-emerald-800/80">Chỉ thay {article.improvementDraft.changes.length} đoạn điểm thấp. Nội dung bài mẫu đã sao chép không bị sửa.</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {article.improvementDraft.review && <span className={`text-lg font-bold ${passesGate ? "text-emerald-700" : "text-amber-700"}`}>{article.improvementDraft.review.totalScore}/100 <span className="text-xs font-normal">· chính xác {article.improvementDraft.review.accuracyScore}</span></span>}
                                <Button small variant="secondary" disabled={busy !== null} onClick={() => void run(`improvement-review-${article.id}`, () => reviewJapanVipOwnedImprovement(article.id))}><RotateCcw size={13} /> {article.improvementDraft.review ? "Chấm lại bản cải thiện" : "Chấm bản cải thiện"}</Button>
                              </div>
                            </div>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-sm font-medium text-emerald-800">Xem các đoạn được sửa ({article.improvementDraft.changes.length})</summary>
                              <div className="mt-2 space-y-2">
                                {article.improvementDraft.changes.map((change, index) => <div key={change.id} className="rounded-[var(--radius)] border border-emerald-200 bg-white p-3 text-xs leading-5"><p className="font-semibold text-[var(--text)]">Thay đổi {index + 1}: {change.reason}</p><p className="mt-1 text-red-700"><span className="font-semibold">Trước:</span> {change.before}</p><p className="mt-1 text-emerald-700"><span className="font-semibold">Sau:</span> {change.after}</p></div>)}
                              </div>
                            </details>
                            {article.improvementDraft.review && article.improvementDraft.review.issues.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-amber-700">Bản cải thiện còn {article.improvementDraft.review.issues.length} điểm cần xử lý</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">{article.improvementDraft.review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}
                          </div>
                        )}
                      </div>
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
