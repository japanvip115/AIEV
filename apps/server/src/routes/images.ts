import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import { broadcast } from "../events.js";
import {
  ANGLE_FILE_RE,
  IMAGE_ASPECTS,
  IMAGE_GEN_STEPS,
  IMAGE_KINDS,
  CUSTOM_SIZE_MAX,
  CUSTOM_SIZE_MIN,
  MAX_ANGLE_COUNT,
  clampAngleCount,
  defaultOverlay,
  imageDirOf,
  newImageProjectId,
  normOverlay,
  readImageMeta,
  scanImageProjects,
  writeImageMeta,
  type ImageAspect,
  type ImageGenStep,
  type ImageKind,
  type ImageProject,
  type ImageStatus,
} from "../imageMeta.js";
import { CODEX_CLI_IMAGE_MODEL, IMAGE_MODELS } from "../gemini.js";
import { getPrefs, prefBool, prefString, rememberPrefs } from "../prefs.js";
import { styleExists } from "../styles.js";
import { queue } from "../queue.js";
import {
  HttpError,
  ensureDir,
  isKebabCase,
  listFilesRecursive,
  moveFile,
  nowIso,
} from "../util.js";

/**
 * Image Projects - tạo ảnh AI (Gemini nền + Remotion hoàn thiện).
 * CRUD + upload nền thủ công + POST /:id/generate (queue job "image-gen").
 * Xem docs/API.md mục "Image Projects".
 */

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) => cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function parseImageModel(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined || raw === null || raw === "") return raw === undefined ? fallback : null;
  // Chấp nhận cả model mới từ danh sách live của Google (không chỉ IMAGE_MODELS tĩnh) -
  // miễn là id hợp lệ và có "image" trong tên
  if (
    typeof raw !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{2,80}$/i.test(raw) ||
    !raw.includes("image")
  ) {
    throw new HttpError(
      400,
      "INVALID_MODEL",
      `model không hợp lệ - vd: ${IMAGE_MODELS.map((m) => m.id).join(", ")}`,
    );
  }
  return raw;
}

/**
 * Số nguyên không âm từ body JSON: nhận số nguyên thật và chuỗi toàn chữ số.
 * Từ chối (null) mọi thứ khác - thập phân, "1e3", true, "", NaN, Infinity.
 *
 * KHÔNG dùng `Math.floor(Number(raw))`: cách đó nuốt "2.7" thành 2 và `true`
 * thành 1, tức server im lặng nhận một con số KHÁC cái người dùng gõ - đúng
 * kiểu lệch UI/server mà ô nhập bên web (regex `^\d+$`) đã cố chặn. Hai bên
 * phải từ chối cùng một tập giá trị.
 */
function parseIntStrict(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) ? raw : null;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

/**
 * Số ảnh sinh từ mẫu: 1..MAX_ANGLE_COUNT, sai thì 400 chứ KHÔNG clamp im lặng.
 * Gõ nhầm "50" mà server tự hiểu thành 8 là người dùng ngồi đợi một loạt khác
 * hẳn cái họ nghĩ mình vừa đặt.
 */
function parseAngleCount(raw: unknown): number {
  const n = parseIntStrict(raw);
  if (n === null || n < 1 || n > MAX_ANGLE_COUNT) {
    throw new HttpError(
      400,
      "INVALID_ANGLE_COUNT",
      `Số ảnh phải là số nguyên từ 1 đến ${MAX_ANGLE_COUNT} - mỗi ảnh tốn một lượt quota ChatGPT.`,
    );
  }
  return n;
}

/**
 * Cỡ tuỳ chỉnh là MỘT CẶP, không phải hai trường rời.
 *
 * `targetSizeOf` (imageMeta.ts) chỉ nhận cỡ tuỳ chỉnh khi ĐỦ CẢ HAI cạnh, nên
 * meta chỉ có một cạnh là trạng thái vô nghĩa: job âm thầm quay về cỡ theo tỉ lệ
 * trong khi meta vẫn khai một con số. Trước đây hai cạnh được parse và gán ĐỘC
 * LẬP, nên `PUT {"customWidth":1080}` từ một client khác (hoặc curl) ghi thẳng
 * ra meta nửa cặp - UI mới chặn được ở trình duyệt, không chặn được ở đây.
 *
 * Luật: gửi một key thì phải gửi cả hai. Chấp nhận đúng hai dạng - cả hai rỗng
 * (bỏ cỡ tuỳ chỉnh) hoặc cả hai là số nguyên trong biên. Trả `null` khi body
 * không đụng tới cặp này; ném 400 TRƯỚC KHI gọi hàm này gán bất cứ thứ gì.
 *
 * ĐỌC vẫn khoan dung với meta.json cũ đã lỡ nửa cặp: normCustomSide giữ nguyên
 * từng cạnh và targetSizeOf fallback về tỉ lệ, nên project cũ vẫn mở được.
 */
function parseCustomSizePair(
  body: Record<string, unknown>,
): { width: number | null; height: number | null } | null {
  const hasW = "customWidth" in body;
  const hasH = "customHeight" in body;
  if (!hasW && !hasH) return null;
  if (hasW !== hasH) {
    throw new HttpError(
      400,
      "INVALID_CUSTOM_SIZE",
      "Cỡ tuỳ chỉnh phải gửi CẢ HAI cạnh customWidth và customHeight - gửi lẻ một cạnh sẽ tạo cỡ nửa vời mà job không dùng được.",
    );
  }

  const side = (raw: unknown, name: string): number | null => {
    if (raw === null || raw === "") return null;
    const n = parseIntStrict(raw);
    if (n === null || n < CUSTOM_SIZE_MIN || n > CUSTOM_SIZE_MAX) {
      throw new HttpError(
        400,
        "INVALID_CUSTOM_SIZE",
        `${name} phải là số nguyên từ ${CUSTOM_SIZE_MIN} đến ${CUSTOM_SIZE_MAX} px, hoặc để trống CẢ HAI cạnh để dùng cỡ theo tỉ lệ.`,
      );
    }
    return n;
  };

  const width = side(body.customWidth, "customWidth");
  const height = side(body.customHeight, "customHeight");
  // Một cạnh rỗng một cạnh có số: đúng cái trạng thái nửa vời cần chặn.
  if ((width === null) !== (height === null)) {
    throw new HttpError(
      400,
      "INVALID_CUSTOM_SIZE",
      "Cỡ tuỳ chỉnh phải có ĐỦ cả hai cạnh, hoặc để trống cả hai để quay lại cỡ theo tỉ lệ.",
    );
  }
  return { width, height };
}

/** styleId: null/"" = dùng style default; string phải là style tồn tại */
function parseStyleId(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined) return fallback;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new HttpError(400, "INVALID_STYLE_ID", "styleId phải là string hoặc null");
  }
  const id = raw.trim();
  if (!id) return null;
  if (!styleExists(id)) {
    throw new HttpError(400, "STYLE_NOT_FOUND", `Không tìm thấy style "${id}"`);
  }
  return id;
}

/**
 * Tên project ảnh: bắt buộc, tối đa 120 ký tự - cùng giới hạn với video project
 * (PUT /api/projects/:id/name). Tên dài hơn thế sinh ra tên thư mục dài, và
 * Windows vẫn còn giới hạn 260 ký tự cho cả đường dẫn.
 */
function parseName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) {
    throw new HttpError(400, "INVALID_NAME", "Tên project không được để trống");
  }
  if (name.length > 120) {
    throw new HttpError(400, "INVALID_NAME", "Tên project tối đa 120 ký tự");
  }
  return name;
}

function parseKind(raw: unknown, fallback: ImageKind): ImageKind {
  if (raw === undefined) return fallback;
  if (!IMAGE_KINDS.includes(raw as ImageKind)) {
    throw new HttpError(400, "INVALID_KIND", `kind phải là một trong: ${IMAGE_KINDS.join(", ")}`);
  }
  return raw as ImageKind;
}

function parseAspect(raw: unknown, fallback: ImageAspect): ImageAspect {
  if (raw === undefined) return fallback;
  if (!IMAGE_ASPECTS.includes(raw as ImageAspect)) {
    throw new HttpError(
      400,
      "INVALID_ASPECT",
      `aspect phải là một trong: ${IMAGE_ASPECTS.join(", ")}`,
    );
  }
  return raw as ImageAspect;
}

// GET /api/images → ImageProject[]
router.get("/", (_req, res) => {
  res.json(scanImageProjects());
});

// POST /api/images - { name, prompt, kind, aspect, overlay? } → 201 (id sinh từ name)
router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "INVALID_NAME", "Thiếu name");
  if ("prompt" in body && typeof body.prompt !== "string") {
    throw new HttpError(400, "INVALID_PROMPT", "prompt phải là string");
  }

  /*
   * Mặc định = lựa chọn LẦN TRƯỚC. Người làm mười tấm ảnh cho cùng một chiến
   * dịch thì chín lần sau vẫn 9:16, vẫn style ấy, vẫn model ấy - bắt chọn lại
   * từng lần là bắt làm lại một việc đã làm.
   *
   * KHÔNG nhớ `prompt` và phần chữ: đó là NỘI DUNG của một tấm ảnh cụ thể, nhớ
   * lại chỉ tổ đẻ ra ảnh mới mang chữ của ảnh cũ. Riêng "có đóng logo không" và
   * vị trí khối chữ thì là bố cục, nhớ được.
   */
  const pref = getPrefs("image");
  const base = defaultOverlay();
  const prefOverlay = {
    ...base,
    showLogo: prefBool(pref, "showLogo") ?? base.showLogo,
    position: prefString(pref, "position") ?? base.position,
  };

  const now = nowIso();
  const meta: ImageProject = {
    id: newImageProjectId(name),
    name,
    prompt: typeof body.prompt === "string" ? body.prompt.trim() : "",
    kind: parseKind(body.kind, (prefString(pref, "kind") as ImageKind) ?? "background"),
    aspect: parseAspect(body.aspect, (prefString(pref, "aspect") as ImageAspect) ?? "9:16"),
    status: "draft",
    model: parseImageModel(body.model, prefString(pref, "model") ?? null),
    styleId: parseStyleId(body.styleId, prefString(pref, "styleId") ?? null),
    overlay: normOverlay(body.overlay, normOverlay(prefOverlay, base)),
    background: null,
    final: null,
    productRef: null,
    // Có gửi thì validate y hệt PUT (gửi 50 phải bị chặn, không phải lặng lẽ
    // thành 1); không gửi thì clamp cho ra mặc định 1 - client cũ không biết
    // trường này nên không bao giờ rơi vào nhánh 400.
    angleCount: "angleCount" in body ? parseAngleCount(body.angleCount) : clampAngleCount(undefined),
    customWidth: null,
    customHeight: null,
    angles: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  writeImageMeta(meta.id, meta);
  res.status(201).json(readImageMeta(meta.id));
});

// GET /api/images/:id → ImageProject
router.get("/:id", (req, res) => {
  res.json(readImageMeta(req.params.id));
});

// PUT /api/images/:id - partial (name/prompt/kind/aspect/overlay) → ImageProject
router.put("/:id", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  const body = (req.body ?? {}) as Record<string, unknown>;

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, "INVALID_NAME", "name phải là string không rỗng");
    }
    meta.name = parseName(body.name);
  }
  if ("prompt" in body) {
    if (typeof body.prompt !== "string") {
      throw new HttpError(400, "INVALID_PROMPT", "prompt phải là string");
    }
    meta.prompt = body.prompt;
  }
  meta.kind = parseKind(body.kind, meta.kind);
  meta.aspect = parseAspect(body.aspect, meta.aspect);
  if ("model" in body) meta.model = parseImageModel(body.model, meta.model);
  if ("styleId" in body) meta.styleId = parseStyleId(body.styleId, meta.styleId);
  if ("overlay" in body) {
    if (!body.overlay || typeof body.overlay !== "object" || Array.isArray(body.overlay)) {
      throw new HttpError(400, "INVALID_OVERLAY", "overlay phải là object");
    }
    meta.overlay = normOverlay(body.overlay, meta.overlay);
  }
  if ("angleCount" in body) meta.angleCount = parseAngleCount(body.angleCount);
  // Cỡ tuỳ chỉnh đi theo CẶP - validate xong xuôi rồi mới gán (xem parseCustomSizePair).
  const sizePair = parseCustomSizePair(body);
  if (sizePair) {
    meta.customWidth = sizePair.width;
    meta.customHeight = sizePair.height;
  }

  writeImageMeta(meta.id, meta);

  // Nhớ "gu" cho ảnh sau - chỉ thứ lặp lại giữa các ảnh, không nhớ nội dung.
  // Đặt SAU khi ghi thành công: lựa chọn bị 400 thì không đáng được nhớ.
  rememberPrefs("image", {
    kind: "kind" in body ? meta.kind : undefined,
    aspect: "aspect" in body ? meta.aspect : undefined,
    model: "model" in body ? meta.model : undefined,
    styleId: "styleId" in body ? meta.styleId : undefined,
    showLogo: "overlay" in body ? meta.overlay.showLogo : undefined,
    position: "overlay" in body ? meta.overlay.position : undefined,
  });

  res.json(meta);
});

// DELETE /api/images/:id → 204
router.delete("/:id", (req, res) => {
  const id = req.params.id;
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_IMAGE_ID", `Image project id không hợp lệ: ${id}`);
  }
  if (!fs.existsSync(imageDirOf(id))) {
    throw new HttpError(404, "IMAGE_NOT_FOUND", `Không tìm thấy image project "${id}"`);
  }
  fs.rmSync(imageDirOf(id), { recursive: true, force: true });
  res.status(204).end();
});

/**
 * POST /api/images/:id/clone - { name? } → nhân bản thành project ảnh mới (201)
 *
 * GIỮ ẢNH NỀN, BỎ ẢNH HOÀN THIỆN. Lý do: nền là NGUYÊN LIỆU (Gemini sinh ra, hoặc
 * người dùng tự tải lên) còn final.png là SẢN PHẨM của bước compose. Người ta nhân
 * bản để đổi chữ/logo trên cùng một nền - chép nền sang là bản sao compose lại được
 * ngay, không phải trả tiền Gemini lần nữa. Muốn nền mới thì bấm tạo lại nền, một
 * nút thôi; còn nếu bỏ nền thì không có đường nào lấy lại nền cũ.
 *
 * Không đụng tới id của bản gốc - đây là THÊM project mới, không phải di trú.
 */
router.post("/:id/clone", (req, res) => {
  const src = readImageMeta(req.params.id); // ném 404 nếu không có
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name =
    body.name === undefined || body.name === null || body.name === ""
      ? `${src.name} (bản sao)`
      : parseName(body.name);

  const newId = newImageProjectId(name);
  const dstDir = imageDirOf(newId);
  ensureDir(dstDir);

  /*
   * CHỈ CHÉP ĐÚNG FILE NỀN ĐANG DÙNG - danh sách cho phép, không phải danh sách
   * loại trừ. Thư mục project chạy lâu ngày còn đọng lại bản final cũ
   * ("final-v3.png") và props của lần stage trước ("thumb.props.json"): loại trừ
   * theo tên thì bỏ sót đúng những thứ đó, và bản sao mang theo vài MB rác kèm
   * một tấm ảnh cũ chẳng ai tham chiếu tới.
   */
  let background = src.background;
  if (background) {
    const srcFile = path.join(imageDirOf(src.id), background);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(dstDir, background));
    } else {
      // meta nói có nền mà file đã bị xóa tay → đừng nói dối: để null, giao diện
      // hiện "chưa có nền" thay vì một ô ảnh vỡ
      background = null;
    }
  }

  // Ảnh sản phẩm mẫu là ĐẦU VÀO nên đáng chép sang bản sao (nhân bản để đổi
  // prompt/tỉ lệ mà vẫn cùng một cái máy). Cùng luật với nền: file mất thì để null.
  let productRef = src.productRef;
  if (productRef) {
    const srcFile = path.join(imageDirOf(src.id), productRef);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(dstDir, productRef));
    } else {
      productRef = null;
    }
  }

  const now = nowIso();
  const meta: ImageProject = {
    ...src,
    id: newId,
    name,
    background,
    productRef,
    // Ảnh đã sinh là ĐẦU RA, không chép sang - bản sao chưa chạy job nào.
    // Bê nguyên mảng qua là meta khai có 8 ảnh mà thư mục trống trơn.
    angles: [],
    status: "draft", // bản gốc có thể đang generating - bản sao thì chưa có job nào
    final: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  writeImageMeta(newId, meta);

  res.status(201).json(readImageMeta(newId));
});

// POST /api/images/:id/background - multipart, tự upload nền (không cần Gemini) → ImageProject
router.post("/:id/background", upload.single("file"), (req, res) => {
  const uploaded = req.file;
  try {
    // multer đổi generic của handler → req.params.id bị suy ra string|string[], ép về string
    const meta = readImageMeta(String(req.params.id)); // ném 404 nếu không có
    if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

    let ext = path.extname(uploaded.originalname).toLowerCase();
    if (ext === ".jpeg") ext = ".jpg";
    if (ext !== ".png" && ext !== ".jpg") {
      throw new HttpError(400, "INVALID_BACKGROUND", "Ảnh nền phải là PNG hoặc JPG");
    }

    // Xóa nền cũ (có thể khác đuôi) rồi ghi background.<ext>
    for (const old of ["background.png", "background.jpg"]) {
      const abs = path.join(imageDirOf(meta.id), old);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    }
    const fileName = `background${ext}`;
    moveFile(uploaded.path, path.join(imageDirOf(meta.id), fileName));

    meta.background = fileName;
    if (meta.status === "error") meta.status = "draft";
    meta.error = null;
    writeImageMeta(meta.id, meta);
    res.json(meta);
  } catch (err) {
    if (uploaded?.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
});

/**
 * Ảnh mẫu là ĐẦU VÀO mà job đọc lại ở MỖI ảnh trong loạt, không phải copy một
 * lần lúc bắt đầu. Đổi/xoá nó giữa chừng thì Codex CLI mất file ngay giữa loạt
 * và vẽ tiếp bằng trí tưởng tượng - ra một mớ ảnh sai sản phẩm mà chẳng có lỗi
 * nào báo ra. Chặn như junk/clean đã chặn.
 */
/**
 * Xóa loạt ảnh đã sinh từ ảnh mẫu CŨ - file trên đĩa lẫn danh sách trong meta.
 *
 * Bắt buộc khi đổi hoặc bỏ ảnh mẫu: angle-*.png là ảnh vẽ theo ĐÚNG cái máy
 * trong ảnh mẫu cũ. Giữ lại là web hiện thumbnail máy mới nằm ngay trên loạt
 * ảnh của máy cũ - người dùng lấy nhầm ảnh sai sản phẩm mà không hề biết.
 *
 * Chỉ xóa file khớp ANGLE_FILE_RE (allowlist dùng chung với job). product-ref,
 * background, final, meta.json không bao giờ khớp nên không bị đụng tới.
 * Hàm ĐỔI TẠI CHỖ `meta.angles`; người gọi vẫn phải writeImageMeta.
 */
function clearAngleOutputs(meta: ImageProject): void {
  const dir = imageDirOf(meta.id);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (ANGLE_FILE_RE.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
  }
  meta.angles = [];
}

/**
 * Trạng thái ĐÚNG sau khi loạt ảnh vừa bị dọn (đổi/bỏ ảnh mẫu).
 *
 * `clearAngleOutputs` xoá sạch angle-*.png, nên một project đang "done" NHỜ loạt
 * ảnh đó mà vẫn giữ badge Done là badge nói dối: angles rỗng, đĩa trống. Chỉ giữ
 * "done" khi còn một sản phẩm THẬT của đường Remotion cũ - file final còn nằm
 * trên đĩa. Không còn thì về "draft".
 *
 * Cũng dọn luôn "generating" mắc kẹt (server chết giữa job): tới đây
 * assertNoActiveJob đã bảo đảm không còn job nào chạy/chờ.
 */
function statusAfterAngleReset(meta: ImageProject): ImageStatus {
  if (meta.final && fs.existsSync(path.join(imageDirOf(meta.id), meta.final))) return "done";
  return "draft";
}

function assertNoActiveJob(id: string): void {
  if (db.hasActiveJobForProject(id)) {
    throw new HttpError(
      409,
      "JOB_RUNNING",
      "Image project đang có job chạy/chờ trong hàng đợi - đợi xong rồi mới đổi ảnh sản phẩm mẫu",
    );
  }
}

/**
 * POST /api/images/:id/product-ref - multipart, tải ảnh SẢN PHẨM THẬT làm mẫu.
 *
 * Khác hẳn /background: nền là ĐẦU RA, còn cái này là ĐẦU VÀO cho GPT vẽ thêm
 * góc. Có mẫu thì job đi đường sinh nhiều góc và bỏ qua Remotion.
 */
router.post("/:id/product-ref", upload.single("file"), (req, res) => {
  const uploaded = req.file;
  try {
    const meta = readImageMeta(String(req.params.id));
    assertNoActiveJob(meta.id);
    if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

    let ext = path.extname(uploaded.originalname).toLowerCase();
    if (ext === ".jpeg") ext = ".jpg";
    if (ext !== ".png" && ext !== ".jpg") {
      throw new HttpError(400, "INVALID_PRODUCT_REF", "Ảnh sản phẩm mẫu phải là PNG hoặc JPG");
    }

    for (const old of ["product-ref.png", "product-ref.jpg"]) {
      const abs = path.join(imageDirOf(meta.id), old);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    }
    const fileName = `product-ref${ext}`;
    moveFile(uploaded.path, path.join(imageDirOf(meta.id), fileName));

    meta.productRef = fileName;
    // Ảnh mẫu mới -> loạt ảnh cũ là của cái máy khác, dọn sạch (xem clearAngleOutputs).
    clearAngleOutputs(meta);
    meta.status = statusAfterAngleReset(meta);
    meta.error = null;
    writeImageMeta(meta.id, meta);
    res.json(meta);
  } catch (err) {
    if (uploaded?.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
});

/** DELETE /api/images/:id/product-ref - bỏ ảnh mẫu, quay lại đường sinh ảnh thường. */
router.delete("/:id/product-ref", (req, res) => {
  const meta = readImageMeta(String(req.params.id));
  assertNoActiveJob(meta.id);
  for (const old of ["product-ref.png", "product-ref.jpg"]) {
    const abs = path.join(imageDirOf(meta.id), old);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  }
  meta.productRef = null;
  // Bỏ mẫu thì loạt ảnh sinh từ nó cũng hết chỗ dựa - dọn luôn, đừng để lại
  // một mớ ảnh mồ côi mà giao diện vẫn hiện.
  clearAngleOutputs(meta);
  // Cùng luật với POST: badge phải nói đúng thứ còn lại trên đĩa.
  meta.status = statusAfterAngleReset(meta);
  meta.error = null;
  writeImageMeta(meta.id, meta);
  res.json(meta);
});

// ---------------------------------------------------------------- File rác
// File trung gian của bước compose - xóa được an toàn, KHÔNG đụng file nguồn
// (background.png/.jpg, final.png, meta.json). Pattern y hệt junk của video project.

/**
 * File TẠM của bước cắt khổ trong loạt ảnh góc: "angle-3.png.fit.tmp.png".
 *
 * HẸP HƠN HẲN `ANGLE_FILE_RE` và đó là điểm mấu chốt: ANGLE_FILE_RE khớp CẢ
 * "angle-3.png" (ảnh thành phẩm người dùng vừa tốn quota để sinh ra). Dùng nhầm
 * nó ở đây là nút "Dọn file rác" xoá sạch cả loạt ảnh. Regex dưới đây bắt buộc
 * phải có đuôi ".fit.tmp.png".
 *
 * Chép tay thay vì import từ imageMeta.ts vì hai regex phục vụ hai mục đích
 * NGƯỢC nhau - một cái dọn cả loạt khi đổi ảnh mẫu, một cái chỉ dọn rác - gộp
 * lại là mở đường cho đúng lỗi vừa mô tả.
 *
 * fitToAspect (jobs/imageGen.ts) đã xoá tmp trong finally, nên file chỉ sót khi
 * tiến trình chết hẳn giữa chừng (hết đĩa, kill -9, mất điện).
 */
const ANGLE_TMP_FILE_RE = /^angle-\d+\.png\.fit\.tmp\.png$/;

interface JunkItem {
  /** relPath từ repo root, dấu /; thư mục kết thúc bằng "/" */
  relPath: string;
  size: number;
}

function collectImageJunk(id: string): { items: JunkItem[]; totalBytes: number } {
  const items: JunkItem[] = [];

  // File tạm .fit.tmp.png còn sót của lần ffmpeg chết giữa chừng. readdirSync trả
  // BASENAME, và regex neo hai đầu nên không có tên nào mang "/" hay ".." lọt qua
  // để ghép thành đường dẫn thoát khỏi thư mục project. `id` cũng đã qua
  // isKebabCase trong readImageMeta trước khi tới đây.
  const dir = imageDirOf(id);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!ANGLE_TMP_FILE_RE.test(f)) continue;
      const abs = path.join(dir, f);
      // Chỉ file thường - thư mục hay symlink trùng tên thì bỏ qua, đừng rmSync đệ quy.
      //
      // lstat có thể ném ENOENT: giữa readdirSync và lstatSync, một job vừa xong
      // (fitToAspect xoá tmp trong finally) hoặc một lần /junk/clean song song đã
      // xoá đúng file này. Đó là chuyện BÌNH THƯỜNG của thư mục đang có job chạy,
      // không phải lỗi máy chủ - để nó nổi lên là GET /junk trả 500 và trang web
      // mất hẳn khối "file rác".
      //
      // KHÔNG dùng existsSync làm chốt: nó chỉ thu hẹp cửa sổ race chứ không đóng
      // được (file vẫn có thể biến mất giữa existsSync và lstat). Bắt lỗi ở đúng
      // chỗ mới là chốt thật.
      //
      // Chỉ nuốt ENOENT. EACCES/EPERM/EIO là hỏng thật - nuốt luôn thì người dùng
      // thấy "không có file rác" trong khi đĩa đầy rác không đọc nổi.
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      if (!st.isFile()) continue;
      items.push({ relPath: `image-projects/${id}/${f}`, size: st.size });
    }
  }

  // props.json - PosterProps đã stage cho Remotion (sản phẩm của lần compose)
  const propsFile = path.join(imageDirOf(id), "props.json");
  if (fs.existsSync(propsFile)) {
    items.push({
      relPath: `image-projects/${id}/props.json`,
      size: fs.statSync(propsFile).size,
    });
  }

  // Staging hardlink cho Remotion - img-<id>
  const staging = path.join(paths.stagingDir, `img-${id}`);
  if (fs.existsSync(staging)) {
    items.push({
      relPath: `engines/remotion/public/staging/img-${id}/`,
      size: listFilesRecursive(staging).reduce((sum, f) => sum + f.size, 0),
    });
  }

  return { items, totalBytes: items.reduce((sum, i) => sum + i.size, 0) };
}

// GET /api/images/:id/junk - liệt kê file rác (file trung gian) + tổng dung lượng
router.get("/:id/junk", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  res.json(collectImageJunk(meta.id));
});

// POST /api/images/:id/junk/clean - xóa file rác; job running/queued của project → 409
router.post("/:id/junk/clean", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "JOB_RUNNING",
      "Image project đang có job chạy/chờ trong hàng đợi - đợi xong rồi mới dọn file rác",
    );
  }
  const { items, totalBytes } = collectImageJunk(meta.id);
  for (const item of items) {
    // relPath dạng repo-relative dấu / (thư mục có "/" cuối) - path.join tự chuẩn hóa
    fs.rmSync(path.join(repoRoot, item.relPath), { recursive: true, force: true });
  }
  res.json({ freedBytes: totalBytes, deleted: items.length });
});

// POST /api/images/:id/generate - { step? } → 202 Job (queue type "image-gen")
router.post("/:id/generate", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  const body = (req.body ?? {}) as Record<string, unknown>;
  const step = body.step === undefined ? "all" : body.step;
  if (!IMAGE_GEN_STEPS.includes(step as ImageGenStep)) {
    throw new HttpError(
      400,
      "INVALID_STEP",
      `step phải là một trong: ${IMAGE_GEN_STEPS.join(", ")}`,
    );
  }

  // Dự án có ảnh mẫu đi đường sinh loạt góc, KHÔNG có bước nền/Hoàn thiện.
  // Chặn ở đây, trước createJob: để job vào hàng đợi rồi mới fail trong runner
  // thì người dùng đã mất một suất hàng đợi và một dòng job đỏ, còn nút "Tạo
  // nền" thì mang nghĩa hoàn toàn khác cái nó chạy.
  if (meta.productRef && step !== "all") {
    throw new HttpError(
      400,
      "PRODUCT_REF_STEP_UNSUPPORTED",
      `Dự án đang dùng ảnh sản phẩm mẫu nên chỉ chạy được cả loạt (step "all") - không có bước "${step}". Bỏ ảnh mẫu nếu muốn quay lại đường nền + hoàn thiện.`,
    );
  }
  // Cùng lý do: model sai thì runner cũng throw, nhưng phải nói ngay lúc bấm
  // chứ không phải sau khi job chạy tới lượt.
  if (meta.productRef && meta.model !== CODEX_CLI_IMAGE_MODEL) {
    throw new HttpError(
      400,
      "PRODUCT_REF_MODEL_UNSUPPORTED",
      `Sinh ảnh từ mẫu chỉ chạy với GPT Image 2 (Codex CLI). Chọn model "${CODEX_CLI_IMAGE_MODEL}" trong ô "Model tạo nền".`,
    );
  }

  // Hai tab (hoặc hai request) cùng bấm Tạo ảnh thì xếp hai batch song song:
  // đốt gấp đôi quota và cùng ghi đè angle-*.png + meta của một project.
  // genSubmitting bên web chỉ chặn trong một tab, chốt thật phải nằm ở đây.
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "JOB_RUNNING",
      "Image project đang có job chạy/chờ trong hàng đợi - đợi xong rồi mới tạo ảnh tiếp",
    );
  }

  // sceneId của job "image-gen" mang step cần chạy (all | background | compose)
  const job = db.createJob({
    id: `job_${nanoid()}`,
    projectId: meta.id,
    type: "image-gen",
    sceneId: step as ImageGenStep,
  });
  broadcast("job", db.jobToApi(job));
  queue.enqueue(job.id);
  res.status(202).json(db.jobToApi(job));
});

export default router;
