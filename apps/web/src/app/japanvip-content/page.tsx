"use client";

import { Brain, FileText, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Toolbar } from "@/components/Toolbar";
import {
  createAutomaticJapanVipContent,
  createJapanVipContentProject,
  deleteJapanVipContentProject,
  getJapanVipContentProjects,
  type JapanVipContentProject,
  type JapanVipContentStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const STATUS: Record<JapanVipContentStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Nháp", tone: "muted" },
  researching: { label: "Đang nghiên cứu", tone: "running" },
  writing: { label: "Đang viết", tone: "running" },
  review: { label: "Chờ duyệt", tone: "running" },
  approved: { label: "Đã duyệt", tone: "success" },
};

export default function JapanVipContentPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<JapanVipContentProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [autoUrl, setAutoUrl] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await getJapanVipContentProjects());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => void load(), [load]);

  const shown = useMemo(() => {
    if (!projects) return null;
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.name, p.productModel, p.targetKeyword].some((v) => v.toLowerCase().includes(q))
    );
  }, [projects, query]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const project = await createJapanVipContentProject({
        name: name.trim(),
        productModel: model.trim(),
        primaryUrl: url.trim(),
      });
      setOpen(false);
      router.push(`/japanvip-content/${project.id}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(project: JapanVipContentProject) {
    if (!window.confirm(`Xóa Content Project “${project.name}”?`)) return;
    try {
      await deleteJapanVipContentProject(project.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createAutomatic() {
    if (!autoUrl.trim() || autoBusy) return;
    setAutoBusy(true);
    setAutoError(null);
    try {
      const project = await createAutomaticJapanVipContent({ url: autoUrl.trim(), aiProvider: "codex" });
      router.push(`/japanvip-content/${project.id}`);
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Japan VIP Content"
        subtitle="Nghiên cứu nguồn chính thức, lập fact sheet, viết bài SEO và duyệt trước khi xuất bản."
        actions={
          <>
            <Link href="/japanvip-content/learning" className="btn btn-secondary"><Brain size={16} /> AI học nội dung</Link>
            <Button onClick={() => setOpen(true)}><Plus size={16} /> Tạo Content Project</Button>
          </>
        }
      />
      {error && <ErrorBanner message="Không tải được Content Project" detail={error} />}
      <Card title="Tạo tự động từ link sản phẩm hãng" actions={<Badge tone="success" label="1 link → bản nháp" />}>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          Dán URL sản phẩm chính hãng. Hệ thống tự đọc trang chính và các trang tính năng liên quan, nhận diện model, dùng những bài Japan VIP đã duyệt làm mẫu phong cách rồi tạo dàn ý và bài viết trong một lượt ChatGPT/Codex.
        </p>
        {autoError && <div className="mb-3"><ErrorBanner message="Quy trình tự động chưa hoàn tất" detail={autoError} /></div>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input min-w-0 flex-1" value={autoUrl} onChange={(event) => setAutoUrl(event.target.value)} placeholder="https://www.zojirushi.co.jp/... hoặc link sản phẩm hãng khác" />
          <Button disabled={autoBusy || !autoUrl.trim()} onClick={() => void createAutomatic()}><Sparkles size={16} /> {autoBusy ? "Đang nghiên cứu và viết bài…" : "Tự động tạo nội dung"}</Button>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-4">
          <span>1. Thu thập nguồn hãng</span><span>2. Khóa model và dữ kiện</span><span>3. Học bài đã duyệt</span><span>4. Tạo bản nháp chờ duyệt</span>
        </div>
        <p className="mt-3 text-xs font-medium text-amber-700">Không tự xuất bản. Ảnh hãng được đưa vào trạng thái chờ duyệt; claim không đủ bằng chứng bị đánh dấu để kiểm tra.</p>
      </Card>
      <Card>
        <Toolbar
          search={{ value: query, onChange: setQuery, placeholder: "Tìm theo sản phẩm, model hoặc từ khóa…" }}
        />
        {shown && shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Trạng thái</th>
                  <th>Nguồn</th>
                  <th>Fact</th>
                  <th>Cập nhật</th>
                  <th className="w-10"><span className="sr-only">Xóa</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="row-click" onClick={() => router.push(`/japanvip-content/${p.id}`)}>
                    <td>
                      <span className="font-medium">{p.name}</span>
                      <span className="mt-1 block text-meta text-[var(--text-muted)]">{p.productModel || p.id}</span>
                    </td>
                    <td><Badge tone={STATUS[p.status].tone} label={STATUS[p.status].label} /></td>
                    <td>{p.sources.length}</td>
                    <td>{p.facts.length}</td>
                    <td className="text-[var(--text-muted)]">{formatDateTime(p.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <IconButton label={`Xóa ${p.name}`} size="sm" tone="danger" onClick={() => void remove(p)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : shown ? (
          <EmptyState
            icon={FileText}
            description={query ? "Không có Content Project phù hợp." : "Chưa có Content Project nào."}
            action={!query ? <Button onClick={() => setOpen(true)}>Tạo project đầu tiên</Button> : undefined}
          />
        ) : null}
      </Card>

      <Modal
        title="Tạo Japan VIP Content Project"
        open={open}
        onClose={() => !busy && setOpen(false)}
        dismissible={!busy}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Hủy</Button>
            <Button disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? "Đang tạo…" : "Tạo project"}</Button>
          </>
        }
      >
        {formError && <ErrorBanner message="Không tạo được project" detail={formError} />}
        <Field label="Tên sản phẩm" htmlFor="jvc-name" required>
          <input id="jvc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Nồi cơm điện Zojirushi NX-AB10" />
        </Field>
        <Field label="Model" htmlFor="jvc-model">
          <input id="jvc-model" className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="NX-AB10-BZ" />
        </Field>
        <Field label="URL chính thức ban đầu" htmlFor="jvc-url" hint="Có thể để trống và thêm nhiều nguồn trong màn hình biên tập.">
          <input id="jvc-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.zojirushi.co.jp/..." />
        </Field>
      </Modal>
    </div>
  );
}
