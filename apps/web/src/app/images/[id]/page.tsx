"use client";

/**
 * Chi tiết một Images Project - lắp bằng bộ khối workspace 3 cột dùng chung
 * (`components/Workspace.tsx`), đúng nhịp source → setup → output như mọi trang
 * chi tiết khác:
 *
 * - Cột `source`: thiết lập nội dung (Style Design, prompt, loại ảnh, tỉ lệ,
 *   chữ trên ảnh) - thứ mình BẮT ĐẦU TỪ ĐÓ.
 * - Cột `setup`: nút chạy, model tạo nền, tải nền lên thủ công.
 * - Cột `output`: ảnh thành phẩm ĐỨNG ĐẦU (đang chạy thì hiện tiến trình + log),
 *   rồi tới các bước trung gian.
 *
 * Trước đợt đại tu trang này tự dựng `xl:grid-cols-5` bằng media query nên KHÔNG
 * phản ứng khi người dùng gấp rail trái / panel phải - đúng cái lỗi mà container
 * query của `.workspace-grid` được viết ra để tránh. Tệ hơn: cột kết quả nằm bên
 * TRÁI, ngược với mọi trang chi tiết khác.
 */

import {
  ArrowLeft,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Save,
  ScrollText,
  Trash2,
  Upload,
  Wand2,
  Zap,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  cloneImageProject,
  deleteImageProject,
  generateImage,
  getImageProject,
  getJobs,
  imageFileUrl,
  renameImageProject,
  updateImageProject,
  uploadImageBackground,
  uploadImageProductRef,
  deleteImageProductRef,
  MAX_ANGLE_COUNT_UI,
  CUSTOM_SIZE_MIN_UI,
  CUSTOM_SIZE_MAX_UI,
  GPT_NATIVE_EDGE_UI,
  CODEX_CLI_IMAGE_MODEL_UI,
  type FileInfo,
  type ImageGenStep,
  type ImageProject,
  type JobStatus,
} from "@/lib/api";
import {
  MediaPreviewModal,
  ZoomableThumb,
  imageFileInfo,
} from "@/components/MediaPreviewModal";
import { useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { JobBadge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { CloneProjectModal } from "@/components/CloneProjectModal";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EditableTitle } from "@/components/EditableTitle";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { IconButton } from "@/components/IconButton";
import {
  AspectChip,
  ImageProjectFields,
  ImageStatusBadge,
  KIND_LABEL,
  useGeminiImageModels,
  type ImageDraft,
} from "@/components/ImageProjectForm";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ProgressBar } from "@/components/ProgressBar";
import { ShellRightPanel } from "@/components/Shell";
import { Skeleton } from "@/components/Skeleton";
import {
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
} from "@/components/Workspace";
import { useProviders } from "@/components/ModelPicker";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Job image-gen đang theo dõi trên trang - cập nhật realtime qua SSE. */
interface ActiveJob {
  id: string;
  progress: number;
  step: string;
  status: JobStatus;
}

/** Giữ card tiến trình thêm 3s sau khi job kết thúc rồi mới ẩn. */
const JOB_LINGER_MS = 3000;
/** Giới hạn số dòng log giữ trong bộ nhớ trang. */
const MAX_LOG_LINES = 300;

/**
 * Ô ảnh nhỏ trong khối "Các bước" - Background | Final.
 * Bấm vào mở modal xem chi tiết (trước đây ảnh trơ, không bấm được).
 */
function StepThumb({
  label,
  file,
  alt,
  onOpen,
}: {
  label: string;
  file: FileInfo | null;
  alt: string;
  onOpen: (file: FileInfo) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-meta text-[var(--text-muted)]" title={label}>
        {label}
      </span>
      {/* Cùng khung `.workspace-media` với ảnh thành phẩm - một hợp đồng CSS cho
          mọi ô media trong dashboard, không chép tay lại viền/nền/bo góc. */}
      <div
        className="workspace-media"
        style={{ "--workspace-aspect": "4 / 3" } as CSSProperties}
      >
        {file ? (
          <ZoomableThumb
            file={file}
            alt={alt}
            onOpen={onOpen}
            className="h-full w-full"
            imgClassName="h-full w-full object-contain"
            iconSize={20}
          />
        ) : (
          <ImageIcon
            size={22}
            strokeWidth={1.5}
            className="text-[var(--text-muted)] opacity-40"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Mẫu câu lệnh bấm-là-điền cho ảnh sinh từ sản phẩm mẫu.
 * Chỉ là chữ điền sẵn vào ô prompt - người dùng sửa tiếp thoải mái. Cố ý KHÔNG
 * làm nút gạt "chế độ": studio hay đặt trong nhà chỉ khác nhau ở câu chữ.
 *
 * Giữ KEY chứ không giữ chữ: hằng số ở tầng module không gọi được t() (t đến từ
 * hook useT trong component), nên nhãn và nội dung mẫu đều tra ở chỗ dùng.
 */
const PROMPT_PRESETS: Array<{ labelKey: string; textKey: string }> = [
  { labelKey: "imageRef.preset.studio", textKey: "imageRef.preset.studio-text" },
  { labelKey: "imageRef.preset.living", textKey: "imageRef.preset.living-text" },
  { labelKey: "imageRef.preset.kitchen", textKey: "imageRef.preset.kitchen-text" },
  { labelKey: "imageRef.preset.bedroom", textKey: "imageRef.preset.bedroom-text" },
];

/** Ba ô số của khối "sinh nhiều góc" - dùng chung một bộ luật kiểm/ghi. */
type NumField = "angleCount" | "customWidth" | "customHeight";
interface NumFieldOpts {
  min: number;
  max: number;
  /** Key i18n của tên ô - dùng để dựng câu lỗi, xem validateNumField. */
  labelKey: string;
  /** true = để trống là hợp lệ ở mức Ô (cặp cỡ còn phải cùng rỗng, xem commitCustomSize). */
  allowEmpty: boolean;
}

const ANGLE_COUNT_OPTS: NumFieldOpts = {
  min: 1,
  max: MAX_ANGLE_COUNT_UI,
  labelKey: "imageRef.field.count",
  allowEmpty: false,
};
const WIDTH_OPTS: NumFieldOpts = {
  min: CUSTOM_SIZE_MIN_UI,
  max: CUSTOM_SIZE_MAX_UI,
  labelKey: "imageRef.field.width",
  allowEmpty: true,
};
const HEIGHT_OPTS: NumFieldOpts = {
  min: CUSTOM_SIZE_MIN_UI,
  max: CUSTOM_SIZE_MAX_UI,
  labelKey: "imageRef.field.height",
  allowEmpty: true,
};

export default function ImageProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const imageId = params.id;
  const router = useRouter();
  const { t, tf } = useT();

  const [proj, setProj] = useState<ImageProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form sửa (prompt/loại/tỉ lệ/overlay) - bản nháp tách khỏi dữ liệu server
  const [draft, setDraft] = useState<ImageDraft | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [genError, setGenError] = useState<string | null>(null);
  const [genSubmitting, setGenSubmitting] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Select model ở cột thiết lập - danh sách live + auto-save khi chọn
  const {
    models: liveModels,
    loading: modelsLoading,
    load: loadModels,
  } = useGeminiImageModels();
  const [modelSaving, setModelSaving] = useState(false);

  // Ảnh đang xem chi tiết - dùng modal chung MediaPreviewModal (Esc, mở tab
  // mới, mở file trong Explorer) thay cho lightbox tự chế trước đây
  const [preview, setPreview] = useState<FileInfo | null>(null);
  /** relPath của một file trong thư mục project ảnh này, kèm cache-bust */
  const fileOf = useCallback(
    (fileName: string, label: string): FileInfo =>
      imageFileInfo(`image-projects/${imageId}/${fileName}`, {
        name: label,
        version: proj?.updatedAt,
      }),
    [imageId, proj?.updatedAt],
  );

  // Job image-gen đang chạy/vừa xong của dự án này - tiến trình thật qua SSE
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const activeJobIdRef = useRef<string | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logBoxRef = useRef<HTMLPreElement>(null);

  const { providers } = useProviders();
  const gemini = providers?.find((p) => p.id === "gemini");
  const geminiConnected = gemini?.connected === true;

  const load = useCallback(async () => {
    try {
      const p = await getImageProject(imageId);
      setProj(p);
      setError(null);
      // chỉ khởi tạo draft lần đầu - không ghi đè khi user đang sửa form
      setDraft(
        (d) =>
          d ?? {
            prompt: p.prompt,
            kind: p.kind,
            aspect: p.aspect,
            overlay: p.overlay,
            model: p.model,
            styleId: p.styleId ?? null,
          }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [imageId]);

  useEffect(() => {
    load();
  }, [load]);

  // Mới mở trang: tìm job image-gen của dự án này còn queued/running → bám theo
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const jobs = await getJobs(50);
        const j = jobs.find(
          (x) =>
            x.type === "image-gen" &&
            x.projectId === imageId &&
            (x.status === "queued" || x.status === "running")
        );
        if (alive && j) {
          activeJobIdRef.current = j.id;
          setActiveJob({
            id: j.id,
            progress: j.progress,
            step: j.step,
            status: j.status,
          });
        }
      } catch {
        // không tìm được job đang chạy - SSE sẽ bắt kịp khi có event mới
      }
    })();
    return () => {
      alive = false;
    };
  }, [imageId]);

  // Dọn timer giữ card tiến trình khi rời trang
  useEffect(
    () => () => {
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    },
    []
  );

  // Job "image-gen" của dự án ảnh này → cập nhật tiến trình sống
  useJobEvents((job) => {
    if (job.type !== "image-gen" || job.projectId !== imageId) return;
    if (activeJobIdRef.current !== job.id) {
      // job mới → reset log của job cũ
      activeJobIdRef.current = job.id;
      setLogLines([]);
    }
    if (lingerTimerRef.current) {
      clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
    setActiveJob({
      id: job.id,
      progress: job.progress,
      step: job.step,
      status: job.status,
    });
    if (["done", "failed", "canceled"].includes(job.status)) {
      load();
      // giữ kết quả 3 giây cho user kịp thấy rồi mới ẩn card tiến trình
      lingerTimerRef.current = setTimeout(() => {
        lingerTimerRef.current = null;
        activeJobIdRef.current = null;
        setActiveJob(null);
        setLogLines([]);
      }, JOB_LINGER_MS);
    } else {
      setProj((p) => (p ? { ...p, status: "generating" } : p));
    }
  });

  // Log từng dòng của job đang theo dõi → panel "Nhật ký AI" bên phải
  useJobLogEvents((e) => {
    if (e.jobId !== activeJobIdRef.current) return;
    setLogLines((cur) => [...cur.slice(-(MAX_LOG_LINES - 1)), e.line]);
  });

  // Auto-scroll xuống dòng log mới nhất
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines]);

  const jobRunning =
    activeJob !== null &&
    (activeJob.status === "queued" || activeJob.status === "running");
  const generating = proj?.status === "generating" || jobRunning;

  /** Đổi tên ngay trên tiêu đề - server là nguồn sự thật, lấy tên nó trả về. */
  async function saveName(next: string) {
    setProj(await renameImageProject(imageId, next));
  }

  async function onSave() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const p = await updateImageProject(imageId, {
        prompt: draft.prompt,
        kind: draft.kind,
        aspect: draft.aspect,
        overlay: draft.overlay,
        model: draft.model,
        styleId: draft.styleId,
      });
      setProj(p);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runGenerate(step: ImageGenStep) {
    if (genSubmitting || generating) return;
    setGenSubmitting(true);
    setGenError(null);
    try {
      // Form đang sửa dở → lưu trước để job dùng đúng prompt/overlay/model mới nhất
      if (draft) await onSaveSilent();
      // Số ảnh và cỡ vừa gõ cũng phải nằm trên server TRƯỚC khi tạo job. Bấm nút
      // khi con trỏ còn trong ô số thì blur mới vừa khởi chạy commit; không chờ
      // nó xong là job chạy bằng meta CŨ - sai số ảnh hoặc sai cỡ, tốn quota thật.
      if (!(await flushNumFields())) {
        setGenError(t("imageRef.flush-failed"));
        return;
      }
      const job = await generateImage(imageId, step);
      // Bám theo job ngay - không chờ event SSE đầu tiên
      activeJobIdRef.current = job.id;
      setLogLines([]);
      setActiveJob({
        id: job.id,
        progress: job.progress,
        step: job.step,
        status: job.status,
      });
      setProj((p) => (p ? { ...p, status: "generating" } : p));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenSubmitting(false);
    }
  }

  /** Lưu form không hiện cờ "Đã lưu" - dùng trước khi chạy generate. */
  async function onSaveSilent() {
    if (!draft) return;
    const p = await updateImageProject(imageId, {
      prompt: draft.prompt,
      kind: draft.kind,
      aspect: draft.aspect,
      overlay: draft.overlay,
      model: draft.model,
      styleId: draft.styleId,
    });
    setProj(p);
  }

  /** Chọn model ở cột thiết lập → PUT ngay (auto-save, không cần bấm Lưu). */
  async function onModelChange(next: string | null) {
    setDraft((d) => (d ? { ...d, model: next } : d));
    setModelSaving(true);
    setGenError(null);
    try {
      setProj(await updateImageProject(imageId, { model: next }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelSaving(false);
    }
  }

  async function onUploadBackground(file: File) {
    setUploadingBg(true);
    setGenError(null);
    try {
      setProj(await uploadImageBackground(imageId, file));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingBg(false);
    }
  }

  /**
   * Tải / THAY ảnh mẫu - cùng một endpoint, route tự dọn file cũ và loạt ảnh cũ.
   * Sau khi server trả meta mới thì bỏ hết bản nháp số + lỗi cũ: meta vừa đổi
   * (angles rỗng, status có thể đã về draft) nên chữ đang gõ dở và dòng lỗi của
   * lần trước không còn nói đúng cái gì nữa.
   */
  async function onUploadProductRef(file: File) {
    setUploadingRef(true);
    setGenError(null);
    try {
      setProj(await uploadImageProductRef(imageId, file));
      resetNumDrafts();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingRef(false);
    }
  }

  async function onRemoveProductRef() {
    setUploadingRef(true);
    setGenError(null);
    try {
      setProj(await deleteImageProductRef(imageId));
      resetNumDrafts();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingRef(false);
    }
  }

  /** Điền mẫu câu lệnh vào ô prompt đang sửa - người dùng vẫn sửa tiếp được. */
  function onPromptPreset(text: string) {
    setDraft((d) => (d ? { ...d, prompt: text } : d));
  }

  /**
   * Ba ô số (số ảnh, rộng, cao) đều theo cùng một luật: `proj` LUÔN là bản meta
   * server vừa trả về, còn chữ đang gõ nằm riêng ở `numDraft`.
   *
   * Nhét thẳng số đang gõ vào `proj` là cái bẫy cũ: gõ 5000 thì ô hiện 5000,
   * server từ chối, và mọi thứ đọc `proj` (cảnh báo phóng to, cỡ hiển thị, job
   * sau đó) lại chạy theo một con số KHÁC hẳn cái người dùng đang nhìn. Ở đây ô
   * vẫn hiện đúng chữ đang gõ, nhưng kèm lỗi rõ và `proj` không hề đổi.
   *
   * PUT nằm ở blur/Enter chứ KHÔNG ở mỗi phím. Gõ "1080" mà PUT theo từng phím
   * thì "108" cũng là số hợp lệ trong biên 64..4096 - server lưu 108 trước, rồi
   * 1080; gõ "12" vào ô Số ảnh thì "1" hợp lệ nên server lưu 1 rồi mới báo lỗi
   * ở "12", tức lưu đúng cái người dùng KHÔNG định đặt. Tệ hơn: hai PUT chạy
   * song song, cái cũ về sau thì `proj` đọng lại ở giá trị dở dang.
   */
  const [numDraft, setNumDraft] = useState<Partial<Record<NumField, string>>>({});
  /**
   * Bản sao đồng bộ TỨC THÌ của `numDraft`. Handler blur chạy ngay sau change
   * trong cùng một nhịp thì `numDraft` từ closure của lần render trước vẫn là
   * chữ CŨ - đọc ref mới thấy đúng chữ người dùng vừa gõ.
   */
  const numDraftRef = useRef<Partial<Record<NumField, string>>>({});
  /**
   * Lỗi TỪNG Ô, không phải một chuỗi dùng chung: sửa xong ô Số ảnh mà xoá luôn
   * lỗi của ô Chiều rộng là ô rộng còn nguyên "5000" trên màn hình nhưng không
   * còn dòng nào nói nó chưa được lưu.
   */
  const [numErrors, setNumErrors] = useState<Partial<Record<NumField, string>>>({});
  /**
   * Số thứ tự PUT gần nhất. Phản hồi về trễ hơn một PUT mới hơn thì BỎ, không
   * `setProj` - nếu không, một phản hồi cũ ghi đè meta mới và ô lại hiện số đã
   * lỗi thời (đúng triệu chứng UI lệch server ban đầu).
   */
  const numSeqRef = useRef(0);

  function setDraftValue(field: NumField, raw: string) {
    numDraftRef.current = { ...numDraftRef.current, [field]: raw };
    setNumDraft(numDraftRef.current);
  }

  /** Bỏ toàn bộ bản nháp số + lỗi - dùng khi meta vừa bị thay từ ngoài (đổi/bỏ ảnh mẫu). */
  function resetNumDrafts() {
    numDraftRef.current = {};
    setNumDraft({});
    setNumErrors({});
  }

  function clearDraftValues(fields: NumField[]) {
    const next = { ...numDraftRef.current };
    for (const f of fields) delete next[f];
    numDraftRef.current = next;
    setNumDraft(next);
  }

  function setNumError(field: NumField, message: string | null) {
    setNumErrors((e) => {
      if (message === null) {
        if (e[field] === undefined) return e;
        const next = { ...e };
        delete next[field];
        return next;
      }
      if (e[field] === message) return e;
      return { ...e, [field]: message };
    });
  }

  /** Chữ hiện trong ô: bản đang gõ nếu có, không thì lấy từ meta server. */
  function numFieldValue(field: NumField, serverValue: number | null): string {
    const typed = numDraft[field];
    if (typed !== undefined) return typed;
    return serverValue === null ? "" : String(serverValue);
  }

  /** Chữ ĐANG có trong ô, đọc từ ref - dùng trong handler, không phải khi render. */
  function currentText(field: NumField, serverValue: number | null): string {
    const typed = numDraftRef.current[field];
    if (typed !== undefined) return typed;
    return serverValue === null ? "" : String(serverValue);
  }

  /**
   * Kiểm chữ trong ô. Trả `{ value }` khi hợp lệ (null = ô để trống), trả
   * `{ error }` khi không - KHÔNG chạm mạng, dùng chung cho cả onChange (hiện
   * lỗi ngay) lẫn blur (mới PUT).
   */
  function validateNumField(
    raw: string,
    opts: NumFieldOpts
  ): { value: number | null } | { error: string } {
    const vars = { label: t(opts.labelKey), min: opts.min, max: opts.max };
    const text = raw.trim();
    if (text === "") {
      if (!opts.allowEmpty) return { error: tf("imageRef.err.empty", vars) };
      return { value: null };
    }
    // Chặn cả "1e3", "2.5", "-4", " 12px": Number() nuốt hết mấy thứ đó.
    if (!/^\d+$/.test(text)) return { error: tf("imageRef.err.integer", vars) };
    const value = Number(text);
    if (value < opts.min || value > opts.max) {
      return { error: tf("imageRef.err.range", vars) };
    }
    return { value };
  }

  /** Gõ: chỉ giữ chữ + báo lỗi tại chỗ. Không PUT (xem chú thích numDraft). */
  function onNumFieldChange(field: NumField, raw: string, opts: NumFieldOpts) {
    setDraftValue(field, raw);
    const checked = validateNumField(raw, opts);
    setNumError(field, "error" in checked ? checked.error : null);
  }

  /**
   * PUT chung cho cả hai kiểu commit bên dưới. Chỉ gửi ĐÚNG MỘT request, và bỏ
   * phản hồi nếu trong lúc chờ đã có commit mới hơn.
   */
  async function putNumFields(
    patch: {
      angleCount?: number;
      customWidth?: number | null;
      customHeight?: number | null;
    },
    fields: NumField[]
  ) {
    const seq = ++numSeqRef.current;
    try {
      const next = await updateImageProject(imageId, patch);
      if (seq !== numSeqRef.current) return;
      setProj(next);
      // Server đã nhận -> bỏ bản nháp để ô bám lại đúng meta server.
      clearDraftValues(fields);
      for (const f of fields) setNumError(f, null);
    } catch (e) {
      if (seq !== numSeqRef.current) return;
      const message = e instanceof Error ? e.message : String(e);
      for (const f of fields) setNumError(f, message);
    }
  }

  /**
   * MỘT hàng đợi duy nhất cho mọi lần ghi ô số.
   *
   * Bấm nút "Sinh ảnh" khi con trỏ đang ở một ô số thì trình duyệt bắn blur
   * TRƯỚC click: blur khởi chạy commit, click khởi chạy flush. Không nối chuỗi
   * thì hai đường đó chạy đua - hai PUT cùng lúc, và POST generate có thể đi
   * trước khi PUT kịp về, tức job chạy bằng angleCount/cỡ CŨ và đốt quota sai.
   * Nối vào một chuỗi: lần thứ hai chạy sau lần đầu, thấy draft đã sạch thì
   * không PUT lại.
   */
  const numChainRef = useRef<Promise<void>>(Promise.resolve());
  function queueNumCommit(fn: () => Promise<void>): Promise<void> {
    const next = numChainRef.current.then(fn, fn);
    numChainRef.current = next.catch(() => {});
    return next;
  }

  /** Blur/Enter ở ô Số ảnh. */
  function commitAngleCount(): Promise<void> {
    return queueNumCommit(doCommitAngleCount);
  }
  /** Blur rời khỏi cả nhóm hai ô cỡ. */
  function commitCustomSize(): Promise<void> {
    return queueNumCommit(doCommitCustomSize);
  }

  /**
   * Ghi nốt MỌI ô số còn treo trước khi tạo job. Trả false nếu còn ô chưa lưu
   * được (sai giá trị, hoặc server từ chối) - người gọi phải dừng, KHÔNG tạo job.
   *
   * Không có bước này thì runGenerate chỉ await onSaveSilent (prompt/model...),
   * còn số ảnh và cỡ vừa gõ vẫn nằm trong draft: job chạy bằng meta cũ.
   * Đọc numDraftRef sau khi chuỗi chạy xong - commit thành công thì draft bị
   * xoá, nên "không còn draft" chính là "đã lưu hết".
   */
  async function flushNumFields(): Promise<boolean> {
    await queueNumCommit(doCommitAngleCount);
    await queueNumCommit(doCommitCustomSize);
    const d = numDraftRef.current;
    return (
      d.angleCount === undefined &&
      d.customWidth === undefined &&
      d.customHeight === undefined
    );
  }

  /**
   * Rời ô Số ảnh (hoặc Enter): số hợp lệ thì PUT một lần duy nhất. Ngoài biên
   * thì giữ nguyên lỗi và KHÔNG đụng `proj` - server cũng reject chứ không
   * clamp, hai bên phải nói cùng một điều.
   */
  async function doCommitAngleCount() {
    if (numDraftRef.current.angleCount === undefined) return; // chưa gõ gì
    const checked = validateNumField(
      currentText("angleCount", proj?.angleCount ?? null),
      ANGLE_COUNT_OPTS
    );
    if ("error" in checked) {
      setNumError("angleCount", checked.error);
      return;
    }
    // allowEmpty:false nên nhánh null không tồn tại - chốt lại cho kiểu, và để
    // ô rỗng không bao giờ lọt xuống thành PUT.
    if (checked.value === null) return;
    await putNumFields({ angleCount: checked.value }, ["angleCount"]);
  }

  /**
   * Cỡ tuỳ chỉnh là MỘT CẶP, phải ghi nguyên cặp trong đúng một PUT.
   *
   * Lưu từng cạnh một là tự tay tạo ra trạng thái nửa vời trên server: nhập
   * rộng 1080 rồi rời ô là meta có `customWidth: 1080, customHeight: null`.
   * `targetSizeOf` chỉ nhận cỡ tuỳ chỉnh khi ĐỦ CẢ HAI cạnh, nên job vẫn âm
   * thầm chạy theo tỉ lệ trong khi người dùng nhìn thấy 1080 đã "được lưu".
   * Ở đây: cả hai rỗng -> bỏ cỡ tuỳ chỉnh; cả hai hợp lệ -> đặt cả cặp; mọi
   * trạng thái khác (một cạnh, thập phân, ngoài biên) -> báo lỗi, KHÔNG PUT,
   * `proj` không đổi.
   */
  async function doCommitCustomSize() {
    if (
      numDraftRef.current.customWidth === undefined &&
      numDraftRef.current.customHeight === undefined
    ) {
      return; // chưa gõ gì trong nhóm
    }
    const wText = currentText("customWidth", proj?.customWidth ?? null).trim();
    const hText = currentText("customHeight", proj?.customHeight ?? null).trim();

    if (wText === "" && hText === "") {
      await putNumFields({ customWidth: null, customHeight: null }, [
        "customWidth",
        "customHeight",
      ]);
      return;
    }

    const w = validateNumField(wText, { ...WIDTH_OPTS, allowEmpty: false });
    const h = validateNumField(hText, { ...HEIGHT_OPTS, allowEmpty: false });
    const pairHint = t("imageRef.err.pair-hint");
    let bad = false;
    if ("error" in w) {
      setNumError("customWidth", w.error + pairHint);
      bad = true;
    } else {
      setNumError("customWidth", null);
    }
    if ("error" in h) {
      setNumError("customHeight", h.error + pairHint);
      bad = true;
    } else {
      setNumError("customHeight", null);
    }
    if (bad || "error" in w || "error" in h) return;

    await putNumFields({ customWidth: w.value, customHeight: h.value }, [
      "customWidth",
      "customHeight",
    ]);
  }

  // Modal xác nhận xóa dự án ảnh - bắt gõ DELETE (thay window.confirm)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteImageProject(imageId);
      router.push("/images");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  const geminiTooltip = geminiConnected
    ? undefined
    : t("imageDetail.gemini-tooltip");

  // Select model gọn ở cột thiết lập - live list, fallback danh sách tĩnh
  const currentModel = draft?.model ?? proj?.model ?? null;
  const codexCliSelected = currentModel === CODEX_CLI_IMAGE_MODEL_UI;
  const imageProviderReady = geminiConnected || codexCliSelected;
  const imageProviderTooltip = imageProviderReady ? undefined : geminiTooltip;

  /**
   * Dự án có ảnh sản phẩm mẫu chạy MỘT đường khác hẳn: sinh loạt ảnh góc bằng
   * Codex CLI, không có bước nền và không qua Remotion.
   *
   * Vì thế nút "Tạo nền" và "Hoàn thiện" phải TẮT ở đây. Để bật là người dùng
   * bấm một nút ghi "tạo nền" (nghe như một ảnh) trong khi route trả 400
   * PRODUCT_REF_STEP_UNSUPPORTED - trước lúc route chặn thì nó còn xếp cả một
   * loạt tới `angleCount` lượt quota ChatGPT.
   */
  /** Lỗi của ba ô số, theo thứ tự cố định để dòng cảnh báo không nhảy lung tung. */
  const numErrorList = (["angleCount", "customWidth", "customHeight"] as const)
    .map((f) => numErrors[f])
    .filter((m): m is string => Boolean(m));

  const productRefMode = Boolean(proj?.productRef);
  /** Có mẫu mà chưa chọn Codex CLI: route trả 400 PRODUCT_REF_MODEL_UNSUPPORTED. */
  const productRefNeedsCodex = productRefMode && !codexCliSelected;
  const generateAllDisabled =
    genSubmitting ||
    generating ||
    // Còn ô số đang báo lỗi thì chưa có gì để chạy - flushNumFields vẫn là chốt
    // thật, đây chỉ để nút nói trước thay vì để người dùng bấm rồi mới biết.
    numErrorList.length > 0 ||
    (productRefMode ? productRefNeedsCodex : !imageProviderReady);
  const generateAllTooltip = productRefMode
    ? productRefNeedsCodex
      ? tf("imageRef.needs-codex-title", { model: CODEX_CLI_IMAGE_MODEL_UI })
      : tf("imageRef.cta-title", { count: proj?.angleCount ?? 1 })
    : imageProviderTooltip;
  const stepButtonTooltip = productRefMode ? t("imageRef.step-disabled") : undefined;
  const modelOptions = liveModels ?? gemini?.models ?? [];
  const modelMissing =
    currentModel !== null && !modelOptions.some((m) => m.id === currentModel);

  // Tỉ lệ khung của khung ảnh thành phẩm - "9:16" của meta đổi sang cú pháp CSS
  const aspectRatio = (proj?.aspect ?? "9:16").replace(":", " / ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <EditableTitle
            value={proj?.name ?? null}
            fallback={imageId}
            onSave={saveName}
            onError={setRenameError}
            editLabel={t("imageDetail.rename")}
            emptyError={t("imageDetail.name-required")}
            saveLabel={t("common.save")}
            cancelLabel={t("common.cancel")}
          />
        }
        subtitle={
          proj
            ? `${t(KIND_LABEL[proj.kind])} · ${tf("project.updated", { time: formatRelative(proj.updatedAt) })}`
            : undefined
        }
        actions={
          /* QUY ƯỚC NÚT PHÁ HỦY - áp giống hệt ở cả 7 trang chi tiết (Videos
             Project, Images Project, Auto cut, Text to video, Dịch video, Style
             Design, Phong cách dựng). Trang này từng là ví dụ tệ nhất: "Xóa
             project" đứng KẸP GIỮA "Nhân bản" và nút chính "Lưu thay đổi", cùng
             cỡ cùng gap-2 - trượt tay một nút là mất cả project, mà thao tác đó
             không hoàn tác được.
             Luật: mọi nút thường (kể cả nút chính) gom vào MỘT cụm; nút xóa
             đứng CUỐI, ngoài cụm, ngăn bằng một vạch dọc `border-l` + `pl-2`.
             Nó không bao giờ nằm giữa hai nút thường, và con trỏ phải đi qua
             một ranh giới nhìn thấy được mới tới nó.
             Vạch dọc chứ không phải `ml-auto`: hàng actions là flex item co
             theo nội dung trong `justify-between` của PageHeader, không có chỗ
             trống nào cho `auto` margin ăn - `ml-auto` ở đây không đẩy được gì. */
          <>
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/images")}>
                <ArrowLeft size={15} strokeWidth={2} />
                {t("imageDetail.back")}
              </Button>
              {/* Nhân bản KHÔNG bị khóa khi đang generate: bản sao là project
                  khác, chép nền hiện có - không đụng gì tới job đang chạy */}
              <Button
                variant="secondary"
                disabled={!proj}
                title={t("imageDetail.clone-title")}
                onClick={() => setCloneOpen(true)}
              >
                <Copy size={15} strokeWidth={2} />
                {t("clone.action")}
              </Button>
              <Button onClick={onSave} disabled={saving || !draft}>
                <Save size={15} strokeWidth={2} />
                {saving ? t("common.saving") : t("imageDetail.save-changes")}
              </Button>
            </span>
            <span className="flex items-center border-l border-[var(--border)] pl-2">
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={15} strokeWidth={2} />
                {t("imageDetail.delete-project")}
              </Button>
            </span>
          </>
        }
      />

      {proj && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          <ImageStatusBadge status={proj.status} />
          <AspectChip aspect={proj.aspect} />
          <span className="text-meta">ID: {proj.id}</span>
        </div>
      )}

      {renameError && (
        <ErrorBanner message={t("imageDetail.rename-error")} detail={renameError} />
      )}
      {error && (
        <ErrorBanner message={t("imageDetail.load-error")} detail={error} />
      )}
      {saveError && (
        <ErrorBanner message={t("common.save-error")} detail={saveError} />
      )}
      {saved && <Banner tone="success" message={t("common.saved")} />}
      {proj?.status === "error" && proj.error && (
        <ErrorBanner message={t("imageDetail.last-gen-error")} detail={proj.error} />
      )}

      {/* Ba cột theo nhịp làm việc. Số cột do container query trong globals.css
          lo, trang không tự tính pixel và không dùng media query. */}
      <Workspace>
        {/* ================= Cột 1: nội dung ================= */}
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <Card title={t("imageDetail.settings")}>
            {draft ? (
              <div className="flex flex-col gap-3">
                <p className="t-eyebrow">{t("imageDetail.content")}</p>
                {/* Tên KHÔNG còn ở đây - sửa thẳng trên tiêu đề trang, lưu ngay,
                    không phải bấm Lưu chung với prompt/overlay đang sửa dở */}
                <ImageProjectFields
                  value={draft}
                  onChange={(p) => {
                    setDraft((d) => (d ? { ...d, ...p } : d));
                    setSaved(false);
                  }}
                  disabled={saving}
                  idPrefix="image-edit"
                  showModel={false}
                  sectioned
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            )}
          </Card>
        </WorkspaceColumn>

        {/* ============ Cột 2: yêu cầu & thiết lập ============ */}
        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          <Card title={t("imageDetail.generate-card")}>
            <div className="flex flex-col gap-3">
              {genError && (
                <Banner
                  tone="danger"
                  message={t("imageDetail.run-error")}
                  detail={genError}
                />
              )}

              {/* Hành động chính - full-width, một chạm */}
              {/* Có ảnh mẫu thì ĐÂY là lối duy nhất chạy loạt góc - nhãn phải
                  nói rõ sẽ tốn bao nhiêu lượt, vì hai nút bước bên dưới đã tắt. */}
              <span title={generateAllTooltip} className="block">
                <Button
                  className="w-full"
                  disabled={generateAllDisabled}
                  onClick={() => runGenerate("all")}
                >
                  <Zap size={15} strokeWidth={2} />
                  {productRefMode
                    ? tf("imageRef.cta", { count: proj?.angleCount ?? 1 })
                    : t("imageDetail.generate-all")}
                </Button>
              </span>
              {productRefNeedsCodex && (
                <p className="text-meta text-[var(--danger)]">
                  {tf("imageRef.needs-codex", { model: CODEX_CLI_IMAGE_MODEL_UI })}
                </p>
              )}

              {/* Model tạo nền - live list, auto-save khi chọn */}
              <Field
                label={t("imageDetail.bg-model")}
                htmlFor="image-quick-model"
                hint={
                  modelsLoading
                    ? t("images.loading-models")
                    : modelSaving
                      ? t("common.saving")
                      : undefined
                }
              >
                <select
                  id="image-quick-model"
                  className="input"
                  value={currentModel ?? ""}
                  disabled={modelSaving}
                  onFocus={loadModels}
                  onChange={(e) => onModelChange(e.target.value || null)}
                >
                  <option value="">{t("images.model-default")}</option>
                  {modelMissing && (
                    <option value={currentModel!}>{currentModel}</option>
                  )}
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Chạy từng bước riêng lẻ */}
              <div className="grid grid-cols-2 gap-2">
                <span
                  title={stepButtonTooltip ?? imageProviderTooltip}
                  className="min-w-0"
                >
                  <Button
                    variant="secondary"
                    small
                    className="w-full"
                    disabled={
                      genSubmitting || generating || !imageProviderReady || productRefMode
                    }
                    onClick={() => runGenerate("background")}
                  >
                    <Wand2 size={14} strokeWidth={2} />
                    {codexCliSelected
                      ? t("imageDetail.gen-bg-codex")
                      : t("imageDetail.gen-bg")}
                  </Button>
                </span>
                <span
                  className="min-w-0"
                  title={
                    stepButtonTooltip ??
                    (proj?.background ? undefined : t("imageDetail.need-bg"))
                  }
                >
                  <Button
                    variant="secondary"
                    small
                    className="w-full"
                    disabled={
                      genSubmitting || generating || !proj?.background || productRefMode
                    }
                    onClick={() => runGenerate("compose")}
                  >
                    <Layers size={14} strokeWidth={2} />
                    {t("imageDetail.compose")}
                  </Button>
                </span>
              </div>
              {!imageProviderReady && gemini && (
                <p className="text-meta text-[var(--text-muted)]">
                  {t("imageDetail.gemini-hint")}
                </p>
              )}

              {/* Đường vòng khi không có Gemini: tự tải ảnh nền lên. Xóa project
                  đã dọn lên PageHeader cùng chỗ với 5 trang chi tiết khác. */}
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <Button
                  variant="secondary"
                  small
                  disabled={uploadingBg || generating}
                  title={t("imageDetail.upload-bg-title")}
                  onClick={() => bgInputRef.current?.click()}
                >
                  <Upload size={14} strokeWidth={2} />
                  {uploadingBg
                    ? t("imageDetail.uploading-bg")
                    : t("imageDetail.upload-bg")}
                </Button>
              </div>

              <input
                ref={bgInputRef}
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadBackground(f);
                  e.target.value = "";
                }}
              />

              {/* ---- Sinh nhiều góc từ ảnh sản phẩm thật ----
                  Chỉ dùng KHI KHÔNG CÓ ảnh hãng (chủ dự án chốt 01/09): có ảnh
                  thật thì luôn ưu tiên ảnh thật, vừa đúng vừa khỏi tốn quota. */}
              <div className="space-y-2 border-t border-[var(--border)] pt-3">
                <p className="text-meta font-medium">{t("imageRef.section")}</p>

                {proj?.productRef ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Tên file luôn là product-ref.png/.jpg nên thay ảnh mẫu KHÔNG
                        đổi URL: thiếu ?v là trình duyệt hiện ảnh máy cũ trong khi
                        job đã đọc file máy mới. */}
                    <img
                      src={imageFileUrl(imageId, proj.productRef, proj.updatedAt)}
                      alt={t("imageRef.ref-alt")}
                      className="h-12 w-12 rounded border border-[var(--border)] object-cover"
                    />
                    <span className="text-meta text-[var(--text-muted)]">
                      {proj.productRef}
                    </span>
                    {/* Thay ảnh mẫu dùng CHUNG hidden input và chung endpoint
                        POST /product-ref: route tự xoá product-ref.* cũ (cả khi
                        khác đuôi) rồi dọn loạt ảnh của máy cũ. Không có nút này
                        thì muốn đổi máy phải Bỏ rồi Tải lại - hai lần ghi meta
                        và một khoảng project không có mẫu. */}
                    <Button
                      variant="secondary"
                      small
                      disabled={uploadingRef || generating}
                      title={t("imageRef.replace-title")}
                      onClick={() => refInputRef.current?.click()}
                    >
                      <Upload size={14} strokeWidth={2} />
                      {uploadingRef ? t("imageRef.uploading") : t("imageRef.replace")}
                    </Button>
                    <Button
                      variant="secondary"
                      small
                      disabled={uploadingRef || generating}
                      onClick={onRemoveProductRef}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                      {t("imageRef.remove")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    small
                    disabled={uploadingRef || generating}
                    title={t("imageRef.upload-title")}
                    onClick={() => refInputRef.current?.click()}
                  >
                    <Upload size={14} strokeWidth={2} />
                    {uploadingRef ? t("imageRef.uploading") : t("imageRef.upload")}
                  </Button>
                )}

                {proj?.productRef && (
                  <>
                    <Field label={tf("imageRef.count-label", { max: MAX_ANGLE_COUNT_UI })}>
                      <input
                        type="number"
                        className="input"
                        min={1}
                        max={MAX_ANGLE_COUNT_UI}
                        value={numFieldValue("angleCount", proj.angleCount)}
                        disabled={generating}
                        onChange={(e) =>
                          onNumFieldChange("angleCount", e.target.value, ANGLE_COUNT_OPTS)
                        }
                        onBlur={() => void commitAngleCount()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    </Field>
                    <Field label={t("imageRef.size-label")}>
                      {/* onBlur ở KHỐI, không ở từng ô: nhảy từ ô rộng sang ô cao
                          vẫn là đang nhập dở một cặp, chưa được ghi. Chỉ khi tiêu
                          điểm rời hẳn nhóm mới ghi - và ghi nguyên cặp một lần
                          (xem commitCustomSize). */}
                      <div
                        className="flex items-center gap-2"
                        onBlur={(e) => {
                          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                          void commitCustomSize();
                        }}
                      >
                        <input
                          type="number"
                          className="input"
                          placeholder={t("imageRef.width-placeholder")}
                          min={CUSTOM_SIZE_MIN_UI}
                          max={CUSTOM_SIZE_MAX_UI}
                          value={numFieldValue("customWidth", proj.customWidth)}
                          disabled={generating}
                          onChange={(e) =>
                            onNumFieldChange("customWidth", e.target.value, WIDTH_OPTS)
                          }
                          onKeyDown={(e) => {
                            // Chỉ blur - onBlur của KHỐI mới là chỗ ghi, gọi thêm
                            // ở đây là bắn hai PUT trùng nhau cho cùng một cặp.
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                        <span className="text-meta text-[var(--text-muted)]">×</span>
                        <input
                          type="number"
                          className="input"
                          placeholder={t("imageRef.height-placeholder")}
                          min={CUSTOM_SIZE_MIN_UI}
                          max={CUSTOM_SIZE_MAX_UI}
                          value={numFieldValue("customHeight", proj.customHeight)}
                          disabled={generating}
                          onChange={(e) =>
                            onNumFieldChange("customHeight", e.target.value, HEIGHT_OPTS)
                          }
                          onKeyDown={(e) => {
                            // Chỉ blur - onBlur của KHỐI mới là chỗ ghi, gọi thêm
                            // ở đây là bắn hai PUT trùng nhau cho cùng một cặp.
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                      </div>
                    </Field>
                    {/* Số ngoài biên KHÔNG được lưu: nói rõ ra, vì `proj` bên
                        dưới vẫn đang hiện giá trị server chứ không phải số
                        vừa gõ. Lỗi hiện theo TỪNG ô. */}
                    {numErrorList.length > 0 && (
                      <p className="text-meta text-[var(--danger)]">
                        {numErrorList.join(" ")}{" "}
                        {tf("imageRef.err.saved-still", {
                          count: proj.angleCount,
                          size:
                            proj.customWidth && proj.customHeight
                              ? tf("imageRef.size-px", {
                                  width: proj.customWidth,
                                  height: proj.customHeight,
                                })
                              : tf("imageRef.size-by-aspect", { aspect: proj.aspect }),
                        })}
                      </p>
                    )}
                    {/* Chỉ nhập một cạnh là cỡ tuỳ chỉnh KHÔNG có hiệu lực -
                        nói thẳng thay vì để người dùng tưởng đã đặt xong. */}
                    {Boolean(proj.customWidth) !== Boolean(proj.customHeight) && (
                      <p className="text-meta text-[var(--danger)]">
                        {tf("imageRef.warn.one-side", { aspect: proj.aspect })}
                      </p>
                    )}
                    {Boolean(proj.customWidth) &&
                      Boolean(proj.customHeight) &&
                      Math.max(proj.customWidth!, proj.customHeight!) > GPT_NATIVE_EDGE_UI && (
                        <p className="text-meta text-[var(--danger)]">
                          {tf("imageRef.warn.upscale", { edge: GPT_NATIVE_EDGE_UI })}
                        </p>
                      )}
                    <div className="flex flex-wrap gap-1">
                      {PROMPT_PRESETS.map((p) => (
                        <Button
                          key={p.labelKey}
                          variant="secondary"
                          small
                          disabled={generating}
                          onClick={() => onPromptPreset(t(p.textKey))}
                        >
                          {t(p.labelKey)}
                        </Button>
                      ))}
                    </div>
                    {/* Tách ba mảnh vì <strong> nằm GIỮA câu: t() trả chuỗi thuần,
                        nhét thẻ vào chuỗi dịch là mời người dịch sửa nhầm markup. */}
                    <p className="text-meta text-[var(--text-muted)]">
                      {t("imageRef.quota-note")}
                      <strong> {t("imageRef.quota-note-strong")}</strong>
                      {t("imageRef.quota-note-tail")}
                    </p>
                  </>
                )}
              </div>

              <input
                ref={refInputRef}
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadProductRef(f);
                  e.target.value = "";
                }}
              />
            </div>
          </Card>
        </WorkspaceColumn>

        {/* ============ Cột 3: tiến trình & kết quả ============ */}
        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          {/* Khối ĐẦU TIÊN của cột: ảnh thành phẩm. Cùng vai trò với
              <OutputBlock> của trang video, chỉ khác nó dựng ảnh chứ không dựng
              thẻ <video> - vẫn dùng chung khung `.workspace-media`. */}
          <WorkspaceBlock
            id="image-block-output"
            icon={ImageIcon}
            title={t("imageDetail.final-card")}
            summary={proj?.final ?? t("imageDetail.no-final")}
            actions={
              proj?.final ? (
                <>
                  <IconButton
                    label={t("common.zoom")}
                    onClick={() => setPreview(fileOf(proj.final!, "Final"))}
                  >
                    <Maximize2 size={15} strokeWidth={2} />
                  </IconButton>
                  <a
                    href={imageFileUrl(imageId, proj.final, proj.updatedAt)}
                    download
                    title={t("imageDetail.download")}
                    aria-label={t("imageDetail.download")}
                    className="icon-btn"
                  >
                    <Download size={15} strokeWidth={2} />
                  </a>
                </>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-3">
              {(activeJob || generating) && (
                <Panel
                  title={t("imageDetail.progress")}
                  actions={<JobBadge status={activeJob?.status ?? "running"} />}
                >
                  {activeJob ? (
                    <ProgressBar
                      progress={activeJob.progress}
                      step={activeJob.step || undefined}
                    />
                  ) : (
                    <div
                      className="progress-indeterminate"
                      aria-label={t("imageDetail.generating-aria")}
                    />
                  )}
                  {activeJob?.status === "failed" && (
                    <Banner
                      tone="danger"
                      message={t("imageDetail.gen-failed")}
                      detail={proj?.error ?? undefined}
                    />
                  )}
                </Panel>
              )}

              {/* Log KHÔNG còn ở đây - nó nằm trong panel phải của shell, cùng
                  chỗ với Videos Project / Text to video / Dịch video. Để hai
                  bản là cùng một dòng log hiện ở hai nơi. */}

              <div
                className="workspace-media"
                // Tỉ lệ đi qua biến CSS chứ không qua class Tailwind: giá trị
                // đến từ meta.json của project, không phải danh sách biết trước.
                style={{ "--workspace-aspect": aspectRatio } as CSSProperties}
              >
                {proj?.final ? (
                  // Ảnh chính cũng bấm được để xem full - không bắt người dùng
                  // phải tìm ra nút "Phóng to" ở góc khối
                  <ZoomableThumb
                    file={fileOf(proj.final, "Final")}
                    alt={tf("imageDetail.final-alt-name", { name: proj.name })}
                    onOpen={setPreview}
                    className="h-full w-full"
                    imgClassName="h-full w-full object-contain"
                    iconSize={24}
                  />
                ) : generating || activeJob ? (
                  <>
                    <span className="workspace-shimmer" aria-hidden="true" />
                    <div
                      className="relative px-4 text-center"
                      role="status"
                      aria-live="polite"
                    >
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("imageDetail.generating-aria")}
                      </p>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={ImageIcon}
                    description={t("imageDetail.no-final")}
                  />
                )}
              </div>
            </div>
          </WorkspaceBlock>

          {/* Loạt ảnh sinh từ ảnh sản phẩm mẫu. Tách hẳn khỏi ảnh nền/final vì
              chúng KHÔNG qua Remotion và mang cảnh báo riêng về nguồn gốc. */}
          {proj?.angles && proj.angles.length > 0 && (
            <Card title={tf("imageRef.gallery", { count: proj.angles.length })}>
              <p className="text-meta mb-2 text-[var(--text-muted)]">
                {t("imageRef.gallery-note")}
                <strong> {t("imageRef.gallery-note-strong")}</strong>
                {t("imageRef.gallery-note-tail")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {proj.angles.map((file) => (
                  <a
                    key={file}
                    href={imageFileUrl(imageId, file, proj.updatedAt)}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded border border-[var(--border)] p-1"
                    title={tf("imageRef.open-file", { file })}
                  >
                    <img
                      src={imageFileUrl(imageId, file, proj.updatedAt)}
                      alt={file}
                      className="w-full rounded object-contain"
                    />
                    <span className="text-meta text-[var(--text-muted)]">{file}</span>
                  </a>
                ))}
              </div>
            </Card>
          )}

          {/* CHỈ còn ảnh nền. Ảnh final ĐÃ hiện ngay trên đầu cột trong
              `workspace-media` của khối kết quả - để thêm một ô "Final" ở đây là
              cùng một ảnh render hai lần trên cùng màn hình, và nhãn của nó còn
              là chuỗi tiếng Anh gõ tay giữa giao diện tiếng Việt. */}
          <Card title={t("imageDetail.steps")}>
            <StepThumb
              label={t("imageDetail.step-bg")}
              file={
                proj?.background
                  ? fileOf(proj.background, t("imageDetail.step-bg"))
                  : null
              }
              alt={t("imageDetail.bg-alt")}
              onOpen={setPreview}
            />
          </Card>
        </WorkspaceColumn>
      </Workspace>

      {/* Nhật ký AI của job tạo ảnh - panel phải của shell, giống bốn trang chi
          tiết còn lại. Panel LUÔN khai báo (kể cả lúc chưa chạy job nào) để
          người dùng biết chỗ đó có gì; chưa có log thì hiện EmptyState chứ
          không để panel trống trơn. Cây React vẫn nằm ở trang này nên state
          logLines / SSE giữ nguyên, chỉ đổi chỗ vẽ ra màn hình. */}
      <ShellRightPanel title={t("imageDetail.ai-panel")}>
        {activeJob || logLines.length > 0 ? (
          // min-h-0 + flex-1 để <pre> cao bằng panel rồi tự cuộn bên trong
          <Panel
            className="min-h-0 flex-1"
            title={tf("imageDetail.view-log", { n: logLines.length })}
            actions={
              activeJob ? <JobBadge status={activeJob.status} /> : undefined
            }
          >
            {/* Thanh tiến trình KHÔNG lặp lại ở đây - nó đã nằm trong khối kết
                quả ở cột phải của workspace, panel này chỉ lo phần log. */}
            {/* break-anywhere BẮT BUỘC: log của Gemini/Remotion có đường dẫn và
                chuỗi base64 dài không một khoảng trắng, mà `pre-wrap` chỉ ngắt ở
                khoảng trắng nên chúng đẩy toác cả panel. */}
            <pre
              ref={logBoxRef}
              className="min-h-32 min-w-0 flex-1 overflow-auto rounded-[var(--radius)] bg-[var(--surface)] p-2 font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {logLines.length > 0
                ? logLines.join("\n")
                : t("imageDetail.no-log")}
            </pre>
          </Panel>
        ) : (
          <Panel className="min-h-0 flex-1 items-center justify-center">
            <EmptyState
              icon={ScrollText}
              description={t("imageDetail.ai-panel-empty")}
            />
          </Panel>
        )}
      </ShellRightPanel>

      {/* Modal xác nhận xóa dự án ảnh - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("imageDetail.delete-title")}
        description={
          <>
            {t("imageDetail.delete-desc-1")}{" "}
            <span className="font-medium">{proj?.name ?? imageId}</span>? {t("project.delete-desc-2")}{" "}
            <code className="rounded bg-[var(--bg-subtle)] px-1 text-meta">
              image-projects/{imageId}
            </code>{" "}
            {t("project.delete-desc-3")}
          </>
        }
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />

      {/* Nhân bản → mở thẳng bản sao: người ta nhân bản để SỬA bản sao, ở lại
          bản gốc thì lần nào cũng phải tự đi tìm project mới */}
      <CloneProjectModal
        source={cloneOpen ? { id: imageId, name: proj?.name ?? imageId } : null}
        clone={cloneImageProject}
        descriptionKey="clone.image-description"
        onClose={() => setCloneOpen(false)}
        onCloned={(p) => {
          setCloneOpen(false);
          router.push(`/images/${p.id}`);
        }}
      />

      {/* Xem chi tiết ảnh - modal dùng chung toàn app (Esc, mở tab mới, mở file) */}
      <MediaPreviewModal file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
