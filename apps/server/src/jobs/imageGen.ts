import fs from "node:fs";
import path from "node:path";
import { paths, repoRoot } from "../config.js";
import { updateJob } from "../db.js";
import { generateBackgroundWithCodexCli } from "../codexImage.js";
import {
  CODEX_CLI_IMAGE_MODEL,
  geminiApiKey,
  generateBackground,
  buildImagePrompt,
} from "../gemini.js";
import {
  ANGLE_FILE_RE,
  GPT_NATIVE_EDGE,
  IMAGE_GEN_STEPS,
  MAX_ANGLE_COUNT,
  imageDirOf,
  readImageMeta,
  targetSizeOf,
  writeImageMeta,
  type ImageGenStep,
} from "../imageMeta.js";
import type { JobCtx } from "../queue.js";
import { remotionGlArgs } from "../renderSettings.js";
import { getStyle } from "../styles.js";
import { ensureDir, remotionCli } from "../util.js";
import { parseProgressLine, shortenStep } from "./progress.js";

/**
 * Job "image-gen" - pipeline tạo ảnh của image project (docs/API.md mục Image Projects):
 * - step "background": gọi Gemini tạo ảnh nền (prompt trộn Design System) → background.png
 * - step "compose": stage nền + logo bằng hardlink vào engines/remotion/public/staging/img-<id>/,
 *   ghi props.json (PosterProps), chạy `npx remotion still Poster` → final.png
 * - step "all": background rồi compose.
 * Step nằm trong cột sceneId của job. Meta status: generating khi chạy, error + message khi fail.
 */
export async function runImageGen(ctx: JobCtx): Promise<void> {
  const id = ctx.job.projectId;
  const rawStep = ctx.job.sceneId ?? "all";
  const step: ImageGenStep = IMAGE_GEN_STEPS.includes(rawStep as ImageGenStep)
    ? (rawStep as ImageGenStep)
    : "all";

  const meta = readImageMeta(id); // ném lỗi rõ nếu image project đã bị xóa
  meta.status = "generating";
  meta.error = null;
  writeImageMeta(id, meta);

  try {
    // Có ảnh sản phẩm mẫu → đi đường riêng: sinh N ảnh góc khác nhau từ mẫu.
    // KHÔNG qua Remotion vì đây là ảnh sản phẩm thô, không chèn chữ hay logo.
    if (meta.productRef) {
      // CHỈ "all" mới được sinh loạt góc. "background" và "compose" là hai bước
      // của đường nền + Remotion, đường ảnh mẫu không có chúng. Im lặng chạy
      // loạt thay thế là bấm một nút mà người dùng tưởng rẻ (một ảnh nền) rồi
      // đốt tới MAX_ANGLE_COUNT lượt quota ChatGPT.
      // Route đã chặn trước createJob; đây là lớp thứ hai cho job cũ còn nằm
      // trong hàng đợi từ trước khi có luật này, hoặc job xếp qua đường khác.
      if (step !== "all") {
        throw new Error(
          `Dự án đang dùng ảnh sản phẩm mẫu nên không chạy được bước "${step}" (nền/Hoàn thiện là của đường Remotion). Bấm Tạo ảnh để sinh loạt ảnh góc, hoặc bỏ ảnh mẫu để quay lại đường nền + hoàn thiện.`,
        );
      }
      await stepProductAngles(ctx, id);
      const done = readImageMeta(id);
      done.status = "done";
      done.error = null;
      writeImageMeta(id, done);
      return;
    }

    if (step === "all" || step === "background") await stepBackground(ctx, id);
    if (step === "all" || step === "compose") await stepCompose(ctx, id);

    const done = readImageMeta(id);
    // Chỉ chạy background → chưa có final: quay về draft chờ bước Hoàn thiện
    done.status = step === "background" ? "draft" : "done";
    done.error = null;
    writeImageMeta(id, done);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const failed = readImageMeta(id);
      failed.status = "error";
      failed.error = message;
      writeImageMeta(id, failed);
    } catch {
      /* image project có thể đã bị xóa giữa chừng */
    }
    throw err;
  }
}

// ---- step product-angles: sinh N ảnh từ ảnh sản phẩm mẫu ----------------

/**
 * Góc máy mặc định cho từng ảnh trong loạt. Không có cái này thì N lượt gọi
 * cùng một prompt sẽ ra N ảnh gần như giống hệt nhau - phí sạch quota.
 * Prompt người dùng vẫn dẫn dắt (studio hay đặt trong nhà); dòng này chỉ xoay
 * máy quay quanh sản phẩm.
 */
const ANGLE_HINTS = [
  "straight-on front view at eye level",
  "three-quarter view from the front left",
  "three-quarter view from the front right",
  "direct side profile from the left",
  "three-quarter view from the rear right",
  "slightly elevated view looking down at about 30 degrees",
  "low angle looking slightly up",
  "tight close-up on the control panel and upper front",
];

/** Co/cắt ảnh vuông của GPT về đúng khổ tỉ lệ. Dùng ffmpeg - AIEV vốn đã bắt buộc có. */
async function fitToAspect(
  ctx: JobCtx,
  file: string,
  size: { width: number; height: number },
): Promise<void> {
  // Đuôi vẫn phải khớp ANGLE_FILE_RE để lần chạy sau quét dọn được: ffmpeg chết
  // giữa chừng (hết đĩa, ảnh vào hỏng) là file tạm nằm lại vĩnh viễn, mà nó
  // không nằm trong danh sách "file rác" nào cả.
  const tmp = `${file}.fit.tmp.png`;
  const { width: w, height: h } = size;
  try {
    await ctx.exec(
      "ffmpeg",
      [
        "-y",
        "-i",
        file,
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
        tmp,
      ],
      path.dirname(file),
    );
    fs.renameSync(tmp, file);
  } finally {
    // rename thành công thì tmp đã biến mất - rm dư thừa là vô hại.
    fs.rmSync(tmp, { force: true });
  }
}

async function stepProductAngles(ctx: JobCtx, id: string): Promise<void> {
  const meta = readImageMeta(id);
  if (!meta.productRef) throw new Error("Chưa có ảnh sản phẩm mẫu.");
  if (meta.model !== CODEX_CLI_IMAGE_MODEL) {
    throw new Error(
      "Sinh ảnh từ mẫu chỉ chạy với GPT Image 2 (Codex CLI). Chọn model đó trong ô \"Model tạo nền\".",
    );
  }

  const dir = imageDirOf(id);
  const refFile = path.join(dir, meta.productRef);
  if (!fs.existsSync(refFile)) {
    throw new Error(`Không tìm thấy ảnh mẫu ${meta.productRef} - hãy tải lại.`);
  }

  // Xoá loạt cũ TRƯỚC khi chạy: lần trước sinh 5 ảnh, lần này 2 thì angle-3..5
  // nằm lại trên đĩa mà không ai tham chiếu - chạy vài lần là đọng cả trăm MB.
  // Quét cả file tạm .fit.tmp.png của lần ffmpeg chết giữa chừng.
  for (const f of fs.readdirSync(dir)) {
    if (ANGLE_FILE_RE.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
  // Và xoá luôn DANH SÁCH cũ trong meta, không chỉ file trên đĩa. Hỏng ngay ảnh
  // đầu (hết quota, chưa login codex) mà meta vẫn khai 5 ảnh của lần trước là
  // web hiện 5 ô ảnh vỡ, trỏ vào file vừa bị xoá ở ngay trên.
  const cleared = readImageMeta(id);
  cleared.angles = [];
  writeImageMeta(id, cleared);

  const count = Math.min(Math.max(meta.angleCount, 1), MAX_ANGLE_COUNT);
  const size = targetSizeOf(meta);
  const custom = Boolean(meta.customWidth && meta.customHeight);
  // Báo GPT đúng tỉ lệ đang cần. Thực tế nó vẫn trả ảnh vuông nên đây chỉ là
  // gợi ý bố cục - khâu cắt của ffmpeg mới quyết định khổ cuối.
  const aspectHint = custom ? `${size.width}:${size.height}` : meta.aspect;
  const made: string[] = [];

  if (custom && Math.max(size.width, size.height) > GPT_NATIVE_EDGE) {
    ctx.log(
      `[product-angles] cỡ ${size.width}x${size.height} lớn hơn ảnh gốc GPT (~${GPT_NATIVE_EDGE}px) - ảnh sẽ bị phóng to và mềm đi`,
    );
  }

  for (let i = 0; i < count; i++) {
    const outName = `angle-${i + 1}.png`;
    const outFile = path.join(dir, outName);
    const angle = ANGLE_HINTS[i % ANGLE_HINTS.length];
    // 5..85%: chừa đầu/cuối cho khâu chuẩn bị và ghi meta
    const pct = 5 + Math.round((i / count) * 80);
    ctx.progress(pct, `Ảnh ${i + 1}/${count} - ${angle}`);

    const prompt = [
      meta.prompt.trim() || "Clean product photo on a plain white studio background.",
      `Camera angle for this image: ${angle}.`,
    ].join("\n");

    await generateBackgroundWithCodexCli({
      ctx,
      prompt,
      aspect: aspectHint,
      outFile,
      refFile,
      // Giữ thanh tiến độ ở đúng ô ảnh đang chạy thay vì để codexImage kéo ngược
      // về thang một-ảnh của nó.
      onRetry: (turn, maxTurns) =>
        ctx.progress(pct, `Ảnh ${i + 1}/${count} - chờ Codex CLI (lượt ${turn}/${maxTurns})`),
    });
    await fitToAspect(ctx, outFile, size);
    made.push(outName);

    // Ghi dần sau MỖI ảnh: loạt 8 ảnh chạy hơn 10 phút, hỏng ở ảnh thứ 6 mà
    // không ghi thì mất trắng 5 ảnh đã tốn quota.
    const partial = readImageMeta(id);
    partial.angles = made.slice();
    writeImageMeta(id, partial);
  }

  ctx.progress(95, `Xong ${made.length} ảnh`);
  ctx.log(`[product-angles] đã sinh ${made.length} ảnh từ ${meta.productRef}`);
}

// ---- step background: Gemini tạo ảnh nền -------------------------------

async function stepBackground(ctx: JobCtx, id: string): Promise<void> {
  const meta = readImageMeta(id);
  const useCodexCli = meta.model === CODEX_CLI_IMAGE_MODEL;
  if (!useCodexCli && !geminiApiKey()) {
    throw new Error(
      "Chưa có GEMINI_API_KEY. Thêm GEMINI_API_KEY vào .env - lấy tại aistudio.google.com/apikey; hoặc tự upload nền rồi chạy bước Hoàn thiện.",
    );
  }
  const design = getStyle(meta.styleId); // style đã chọn hoặc default

  const outFile = path.join(imageDirOf(id), "background.png");
  if (useCodexCli) {
    ctx.progress(5, "GPT Image 2 tạo ảnh qua Codex CLI");
    const promptUsed = buildImagePrompt({
      prompt: meta.prompt,
      kind: meta.kind,
      aspect: meta.aspect,
      design,
    });
    ctx.log(`[codex-image] kind=${meta.kind} aspect=${meta.aspect}`);
    await generateBackgroundWithCodexCli({ ctx, prompt: promptUsed, aspect: meta.aspect, outFile });
    ctx.log(`[codex-image] prompt: ${promptUsed}`);
  } else {
    ctx.progress(5, "Gemini tạo ảnh nền");
    ctx.log(`[gemini] kind=${meta.kind} aspect=${meta.aspect}`);
    const { promptUsed } = await generateBackground({
      prompt: meta.prompt,
      kind: meta.kind,
      aspect: meta.aspect,
      design,
      outFile,
      usageProjectId: id,
      model: meta.model ?? undefined,
    });
    ctx.log(`[gemini] prompt: ${promptUsed}`);
  }

  const fresh = readImageMeta(id);
  fresh.background = "background.png";
  writeImageMeta(id, fresh);
  ctx.progress(40, "Đã có ảnh nền");
}

// ---- step compose: Remotion still Poster --------------------------------

async function stepCompose(ctx: JobCtx, id: string): Promise<void> {
  const meta = readImageMeta(id);
  const design = getStyle(meta.styleId); // style đã chọn hoặc default

  // 1. Stage nền + logo bằng hardlink (fallback copy) - cùng cơ chế với assemble
  ctx.progress(45, "Stage asset cho Remotion");
  const stagingId = `img-${id}`;
  const stagingAbs = path.join(paths.stagingDir, stagingId);
  fs.rmSync(stagingAbs, { recursive: true, force: true });
  ensureDir(stagingAbs);

  // prefix theo vai trò (bg-/logo-/font-h-/font-b-) để file trùng basename không đè nhau
  const stage = (srcAbs: string, prefix: string): string => {
    // meta/styles do agent hoặc file trên đĩa cung cấp - chặn đường dẫn thoát khỏi repo
    const resolved = path.resolve(srcAbs);
    if (!resolved.startsWith(path.resolve(repoRoot) + path.sep)) {
      throw new Error(`Đường dẫn "${srcAbs}" nằm ngoài repo - từ chối stage`);
    }
    const name = prefix + path.basename(srcAbs);
    const dstAbs = path.join(stagingAbs, name);
    try {
      fs.linkSync(srcAbs, dstAbs); // hardlink - không tốn dung lượng
    } catch {
      fs.copyFileSync(srcAbs, dstAbs); // fallback (khác ổ đĩa / FS không hỗ trợ)
    }
    const publicRel = `staging/${stagingId}/${name}`;
    ctx.log(`[stage] ${srcAbs} -> ${publicRel}`);
    return publicRel;
  };

  let background: string | null = null;
  if (meta.background) {
    const bgAbs = path.join(imageDirOf(id), meta.background);
    if (fs.existsSync(bgAbs)) background = stage(bgAbs, "bg-");
    else ctx.log(`[warn] Không thấy nền ${meta.background} - dùng nền gradient từ design`);
  }

  let logoFile: string | null = null;
  if (design.logoPath) {
    const logoAbs = path.join(repoRoot, design.logoPath);
    if (fs.existsSync(logoAbs)) logoFile = stage(logoAbs, "logo-");
    else ctx.log(`[warn] Không thấy logo ${design.logoPath} - bỏ qua logo`);
  }

  // Font brand (nếu đã upload trong Design System) - Poster nạp để chữ đúng font
  const stageFont = (rel: string | null, prefix: string): string | null => {
    if (!rel) return null;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      ctx.log(`[warn] Không thấy font ${rel} - dùng font fallback hệ thống`);
      return null;
    }
    return stage(abs, prefix);
  };
  const fontFiles = {
    heading: stageFont(design.fontFiles.heading, "font-h-"),
    body: stageFont(design.fontFiles.body, "font-b-"),
  };

  // 2. props.json - PosterProps đúng hợp đồng composition `Poster` (docs/API.md)
  const props = {
    aspect: meta.aspect,
    background,
    design: {
      colors: design.colors,
      fonts: design.fonts,
      fontFiles,
      logoFile,
      effects: design.effects,
      // PosterProps giữ field brandName (hợp đồng Remotion) - StyleDesign dùng name
      brandName: design.name,
    },
    overlay: meta.overlay,
  };
  const propsAbs = path.join(imageDirOf(id), "props.json");
  fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2) + "\n", "utf8");
  ctx.log(`[props] Đã ghi ${propsAbs}`);

  // 3. Remotion still
  const outAbs = path.join(imageDirOf(id), "final.png");
  ctx.progress(50, "Remotion render Poster");
  const args = [
    remotionCli(),
    "still",
    "Poster",
    `--props=${propsAbs}`,
    `--output=${outAbs}`,
    ...remotionGlArgs(),
  ];
  await ctx.exec(process.execPath, args, paths.remotionDir, (line) => {
    const pct = parseProgressLine(line);
    if (pct !== null) ctx.progress(50 + pct / 2, shortenStep(line));
  });

  if (!fs.existsSync(outAbs)) {
    throw new Error("Remotion still xong nhưng không thấy file final.png");
  }

  const fresh = readImageMeta(id);
  fresh.final = "final.png";
  writeImageMeta(id, fresh);
  updateJob(ctx.job.id, { outputPath: `image-projects/${id}/final.png` });
}
