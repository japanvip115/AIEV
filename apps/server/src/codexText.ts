import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { addTokenUsage } from "./db.js";
import { repoRoot } from "./config.js";
import { HttpError } from "./util.js";

export interface CodexTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function codexCliPath(): string {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const local = home ? path.join(home, ".local", "bin", "codex") : "";
  return local && fs.existsSync(local) ? local : "codex";
}

function tokenCount(output: string): number {
  const match = /tokens used\s*\r?\n\s*([\d,]+)/i.exec(output);
  return match ? Number(match[1].replace(/,/g, "")) || 0 : 0;
}

/**
 * Sinh văn bản bằng Codex CLI đang đăng nhập ChatGPT trên máy.
 * `--ignore-user-config` + `--ignore-rules` tránh nạp plugin/skill cá nhân vào
 * một request biên tập thuần văn bản, giúp giảm token nền và giữ output ổn định.
 */
export async function generateCodexText(input: {
  prompt: string;
  usageTag: string;
  projectId?: string | null;
  timeoutMs?: number;
  model?: string | null;
}): Promise<CodexTextResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiev-codex-text-"));
  const outputFile = path.join(tempDir, "last-message.txt");
  const model = input.model || process.env.CODEX_CLI_TEXT_MODEL || "gpt-5.6-sol";
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "-m",
    model,
    "-C",
    repoRoot,
    "--output-last-message",
    outputFile,
    input.prompt,
  ];
  let combined = "";
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(codexCliPath(), args, {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const capture = (chunk: Buffer) => {
        combined = (combined + chunk.toString("utf8")).slice(-40_000);
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(combined.trim() || `Codex CLI thoát với mã ${code ?? "không xác định"}`));
      });
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Quá ${Math.round((input.timeoutMs ?? 5 * 60_000) / 60_000)} phút chưa có kết quả`));
      }, input.timeoutMs ?? 5 * 60_000);
    });
    const text = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8").trim() : "";
    if (!text) throw new Error("Codex CLI không trả về nội dung");
    const totalTokens = tokenCount(combined);
    if (totalTokens > 0) {
      try {
        // CLI chỉ trả tổng token; ghi vào input để tổng usage vẫn chính xác, không bịa tách in/out.
        addTokenUsage(`${input.usageTag}_${nanoid(8)}`, input.projectId ?? null, totalTokens, 0, 0, "openai", model);
      } catch {
        // Thống kê là phụ, không chặn nội dung.
      }
    }
    return { text, inputTokens: totalTokens, outputTokens: 0, costUsd: 0 };
  } catch (error) {
    throw new HttpError(
      500,
      "CODEX_AI_FAILED",
      `Gọi GPT qua Codex CLI thất bại: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
