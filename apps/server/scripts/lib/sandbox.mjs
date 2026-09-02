import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const PROVIDER_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "OLLAMA_CLOUD_API_KEY",
];

export function scrubProviderEnv() {
  for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
}

export function createServerSandbox() {
  const sourceDist = join(REPO_ROOT, "apps", "server", "dist");
  const sourceModules = join(REPO_ROOT, "node_modules");
  if (!existsSync(sourceDist)) {
    throw new Error("Thiếu apps/server/dist; chạy npm run build trước proof:image-ref");
  }
  if (!existsSync(sourceModules)) {
    throw new Error("Thiếu node_modules; chạy npm ci trước proof:image-ref");
  }

  const root = mkdtempSync(join(tmpdir(), "aiev-image-ref-proof-"));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(root, { recursive: true, force: true });
  };
  process.once("exit", cleanup);

  try {
    writeFileSync(join(root, "CLAUDE.md"), "# Isolated image-reference proof\n", "utf8");
    mkdirSync(join(root, "apps", "server"), { recursive: true });
    cpSync(sourceDist, join(root, "apps", "server", "dist"), { recursive: true });

    const modulesTarget = join(root, "node_modules");
    try {
      symlinkSync(sourceModules, modulesTarget, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      throw new Error(
        `Không tạo được ${process.platform === "win32" ? "junction" : "symlink"} node_modules cho sandbox: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    mkdirSync(join(root, "image-projects"), { recursive: true });
    if (existsSync(join(root, ".env"))) {
      throw new Error("Sandbox proof không được chứa .env");
    }

    return {
      root,
      realRoot: realpathSync(root),
      dist: join(root, "apps", "server", "dist"),
      moduleUrl(relativePath) {
        return pathToFileURL(join(root, "apps", "server", "dist", relativePath)).href;
      },
      cleanup() {
        process.removeListener("exit", cleanup);
        cleanup();
      },
    };
  } catch (error) {
    process.removeListener("exit", cleanup);
    cleanup();
    throw error;
  }
}
