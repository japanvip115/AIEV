import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { repoRoot } from "./config.js";
import { HttpError } from "./util.js";

function hermesCliPath(): string {
  if (process.env.HERMES_CLI_PATH) return process.env.HERMES_CLI_PATH;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const local = home ? path.join(home, ".local", "bin", "hermes") : "";
  return local && fs.existsSync(local) ? local : "hermes";
}

export async function askHermesCritic(prompt: string, timeoutMs = 5 * 60_000): Promise<string> {
  const provider = process.env.HERMES_CRITIC_PROVIDER || "nous";
  const model = process.env.HERMES_CRITIC_MODEL || "tencent/hy3:free";
  const args = ["--oneshot", prompt, "--ignore-rules", "--provider", provider, "--model", model];
  let stdout = "";
  let stderr = "";
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(hermesCliPath(), args, {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString("utf8")).slice(-200_000); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-40_000); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Hermes thoát với mã ${code ?? "không xác định"}`)));
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Hermes phản biện quá thời gian cho phép"));
      }, timeoutMs);
    });
    const text = stdout.trim();
    if (!text) throw new Error(stderr.trim() || "Hermes không trả về nội dung");
    if (/^HTTP\s+\d{3}:/i.test(text)) throw new Error(text);
    return text;
  } catch (error) {
    throw new HttpError(500, "HERMES_CRITIC_FAILED", `Hermes chấm điểm thất bại: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
