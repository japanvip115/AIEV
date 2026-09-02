#!/usr/bin/env node
/**
 * Regression proof cho image-reference. Chỉ chạy router thật trong sandbox,
 * queue bị stub trước khi router được import nên không job/provider nào chạy.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";

import {
  PROVIDER_ENV_KEYS,
  REPO_ROOT,
  createServerSandbox,
  scrubProviderEnv,
} from "./lib/sandbox.mjs";

scrubProviderEnv();
for (const key of PROVIDER_ENV_KEYS) {
  assert.equal(process.env[key], undefined, `${key} chưa được scrub`);
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Proof cấm network ngoài localhost: ${url.origin}`);
  }
  return realFetch(input, init);
};

const sandbox = createServerSandbox();
const { default: express } = await import("express");
const config = await import(sandbox.moduleUrl("config.js"));
assert.equal(config.repoRoot, sandbox.realRoot, "config.repoRoot phải trỏ vào sandbox");
assert.notEqual(config.repoRoot, fs.realpathSync(REPO_ROOT), "proof đang trỏ vào repo thật");
assert.ok(config.repoRoot.startsWith(fs.realpathSync(path.dirname(sandbox.realRoot))));
assert.equal(fs.existsSync(path.join(sandbox.root, ".env")), false, "sandbox không được có .env");

const { HttpError } = await import(sandbox.moduleUrl("util.js"));
const db = await import(sandbox.moduleUrl("db.js"));
const { queue } = await import(sandbox.moduleUrl("queue.js"));
const enqueued = [];
queue.enqueue = (jobId) => {
  enqueued.push(jobId);
};

// Phải import SAU khi queue.enqueue đã bị thay bằng stub.
const { default: imagesRouter } = await import(sandbox.moduleUrl("routes/images.js"));

const app = express();
app.use(express.json());
app.use("/api/images", imagesRouter);
app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({
    error: { code: "INTERNAL", message: String(error?.message ?? error) },
  });
});

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const BASE = `http://127.0.0.1:${address.port}`;

after(async () => {
  globalThis.fetch = realFetch;
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  sandbox.cleanup();
});

const dirOf = (id) => path.join(config.paths.imageProjectsDir, id);
const metaPath = (id) => path.join(dirOf(id), "meta.json");
const metaOf = (id) => JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
const jobCount = () => db.listJobs(100).length;

function makeProject(id, overrides = {}) {
  const dir = dirOf(id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    id,
    name: id,
    prompt: "p",
    kind: "product",
    aspect: "9:16",
    status: "draft",
    model: "codex-cli-gpt-image-2",
    styleId: null,
    overlay: {
      title: "",
      subtitle: "",
      stats: [],
      cta: "",
      showLogo: true,
      position: "auto",
    },
    background: null,
    final: null,
    productRef: null,
    angleCount: 1,
    customWidth: null,
    customHeight: null,
    angles: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  fs.writeFileSync(metaPath(id), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

function seedWithAngles(id, overrides = {}) {
  const meta = makeProject(id, {
    productRef: "product-ref.png",
    status: "done",
    background: "background.png",
    angles: ["angle-1.png", "angle-2.png"],
    ...overrides,
  });
  const dir = dirOf(id);
  for (const [name, content] of [
    ["product-ref.png", "ref"],
    ["angle-1.png", "a1"],
    ["angle-2.png", "a2"],
    ["angle-3.png.fit.tmp.png", "tmp"],
    ["background.png", "bg"],
    ["props.json", "{}"],
  ]) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return meta;
}

function seedJunk(id) {
  makeProject(id, {
    productRef: "product-ref.png",
    background: "background.png",
    final: "final.png",
    status: "done",
    angles: ["angle-1.png", "angle-2.png"],
  });
  const dir = dirOf(id);
  for (const name of [
    "angle-1.png",
    "angle-2.png",
    "product-ref.png",
    "background.png",
    "final.png",
  ]) {
    fs.writeFileSync(path.join(dir, name), "keep");
  }
  for (const name of ["angle-1.png.fit.tmp.png", "angle-10.png.fit.tmp.png"]) {
    fs.writeFileSync(path.join(dir, name), "tmp");
  }
  fs.writeFileSync(path.join(dir, "props.json"), "{}");
  for (const name of [
    "angle-.png.fit.tmp.png",
    "angle-1.jpg.fit.tmp.png",
    "xangle-1.png.fit.tmp.png",
    "angle-1.png.fit.tmp.png.bak",
    "fit.tmp.png",
  ]) {
    fs.writeFileSync(path.join(dir, name), "trap");
  }
  return dir;
}

const put = (id, body) =>
  fetch(`${BASE}/api/images/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const generate = (id, step = "all") =>
  fetch(`${BASE}/api/images/${id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step }),
  });

test("AIEV image-reference regression proof", async (t) => {
  await t.test("safety: sandbox và provider env bị cô lập", () => {
    assert.equal(config.repoRoot, sandbox.realRoot);
    assert.ok(config.paths.imageProjectsDir.startsWith(sandbox.realRoot));
    for (const key of PROVIDER_ENV_KEYS) assert.equal(process.env[key], undefined);
  });

  await t.test("custom size thiếu một key -> 400 và không ghi meta", async () => {
    makeProject("size-one");
    const before = fs.readFileSync(metaPath("size-one"), "utf8");
    const res = await put("size-one", { customWidth: 1080 });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "INVALID_CUSTOM_SIZE");
    assert.equal(fs.readFileSync(metaPath("size-one"), "utf8"), before);
  });

  await t.test("custom size mixed number/null -> 400 và không ghi", async () => {
    makeProject("size-mixed");
    const before = fs.readFileSync(metaPath("size-mixed"), "utf8");
    for (const body of [
      { customWidth: 1080, customHeight: null },
      { customWidth: null, customHeight: 1920 },
      { customWidth: 1080, customHeight: "" },
    ]) {
      const res = await put("size-mixed", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).error.code, "INVALID_CUSTOM_SIZE");
    }
    assert.equal(fs.readFileSync(metaPath("size-mixed"), "utf8"), before);
  });

  await t.test("custom size null/null và empty/empty xóa nguyên cặp", async () => {
    for (const [id, body] of [
      ["size-null", { customWidth: null, customHeight: null }],
      ["size-empty", { customWidth: "", customHeight: "" }],
    ]) {
      makeProject(id, { customWidth: 1080, customHeight: 1920 });
      const res = await put(id, body);
      assert.equal(res.status, 200);
      const result = await res.json();
      assert.equal(result.customWidth, null);
      assert.equal(result.customHeight, null);
      assert.equal(metaOf(id).customWidth, null);
      assert.equal(metaOf(id).customHeight, null);
    }
  });

  await t.test("custom size 1080x1920 ghi nguyên tử và response khớp disk", async () => {
    makeProject("size-ok");
    const res = await put("size-ok", { customWidth: 1080, customHeight: 1920 });
    assert.equal(res.status, 200);
    const result = await res.json();
    const disk = metaOf("size-ok");
    assert.equal(disk.customWidth, 1080);
    assert.equal(disk.customHeight, 1920);
    assert.equal(disk.updatedAt, result.updatedAt);
  });

  await t.test("custom size từ chối ngoài biên/thập phân, nhận chuỗi số nguyên", async () => {
    makeProject("size-bounds");
    const before = fs.readFileSync(metaPath("size-bounds"), "utf8");
    for (const body of [
      { customWidth: 50, customHeight: 50 },
      { customWidth: 5000, customHeight: 5000 },
      { customWidth: "1080.5", customHeight: "1920" },
    ]) {
      const res = await put("size-bounds", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).error.code, "INVALID_CUSTOM_SIZE");
    }
    assert.equal(fs.readFileSync(metaPath("size-bounds"), "utf8"), before);

    const res = await put("size-bounds", { customWidth: "1080", customHeight: "1920" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.customWidth, 1080);
    assert.equal(result.customHeight, 1920);
  });

  await t.test("angleCount từ chối ngoài biên/thập phân/bool và không ghi", async () => {
    makeProject("angle-bad", { angleCount: 3 });
    const before = fs.readFileSync(metaPath("angle-bad"), "utf8");
    for (const value of [0, 9, 50, 2.7, "x", true]) {
      const res = await put("angle-bad", { angleCount: value });
      assert.equal(res.status, 400, String(value));
      assert.equal((await res.json()).error.code, "INVALID_ANGLE_COUNT");
    }
    assert.equal(fs.readFileSync(metaPath("angle-bad"), "utf8"), before);
  });

  await t.test("angleCount nhận đúng hai biên 1 và 8", async () => {
    makeProject("angle-ok");
    for (const value of [1, 8]) {
      const res = await put("angle-ok", { angleCount: value });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).angleCount, value);
    }
  });

  await t.test("productRef chặn background/compose trước khi tạo job", async () => {
    makeProject("guard-step", { productRef: "product-ref.png" });
    fs.writeFileSync(path.join(dirOf("guard-step"), "product-ref.png"), "ref");
    const before = jobCount();
    for (const step of ["background", "compose"]) {
      const res = await generate("guard-step", step);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, "PRODUCT_REF_STEP_UNSUPPORTED");
    }
    assert.equal(jobCount(), before);
  });

  await t.test("productRef chặn model sai trước khi tạo job", async () => {
    makeProject("guard-model", {
      productRef: "product-ref.png",
      model: "gemini-3.1-flash-image",
    });
    fs.writeFileSync(path.join(dirOf("guard-model"), "product-ref.png"), "ref");
    const before = jobCount();
    const res = await generate("guard-model");
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "PRODUCT_REF_MODEL_UNSUPPORTED");
    assert.equal(jobCount(), before);
  });

  await t.test("active job chặn generate và POST/DELETE product-ref", async () => {
    seedWithAngles("guard-job", { final: null });
    db.createJob({
      id: "proof_guard_job",
      projectId: "guard-job",
      type: "image-gen",
      sceneId: "all",
    });
    for (const state of ["queued", "running"]) {
      if (state === "running") db.updateJob("proof_guard_job", { status: "running" });
      const gen = await generate("guard-job");
      assert.equal(gen.status, 409, state);
      assert.equal((await gen.json()).error.code, "JOB_RUNNING");
      const del = await fetch(`${BASE}/api/images/guard-job/product-ref`, { method: "DELETE" });
      assert.equal(del.status, 409, state);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array([1])]), "x.png");
      const post = await fetch(`${BASE}/api/images/guard-job/product-ref`, {
        method: "POST",
        body: form,
      });
      assert.equal(post.status, 409, state);
    }
    db.updateJob("proof_guard_job", { status: "failed", step: "proof only" });
  });

  await t.test("productRef all hợp lệ trả 202 và stub nhận đúng một enqueue", async () => {
    makeProject("guard-all", {
      productRef: "product-ref.png",
      model: "codex-cli-gpt-image-2",
      angleCount: 8,
    });
    fs.writeFileSync(path.join(dirOf("guard-all"), "product-ref.png"), "ref");
    const before = enqueued.length;
    const res = await generate("guard-all");
    const job = await res.json();
    assert.equal(res.status, 202, JSON.stringify(job));
    assert.equal(enqueued.length, before + 1);
    assert.equal(enqueued.at(-1), job.id);
    db.updateJob(job.id, { status: "failed", step: "proof only" });
  });

  await t.test("junk list chỉ thêm exact fit tmp và giữ file người dùng", async () => {
    seedJunk("junk-list");
    const res = await fetch(`${BASE}/api/images/junk-list/junk`);
    assert.equal(res.status, 200);
    const { items } = await res.json();
    const names = items.map(({ relPath }) => path.basename(relPath)).sort();
    assert.deepEqual(names, [
      "angle-1.png.fit.tmp.png",
      "angle-10.png.fit.tmp.png",
      "props.json",
    ]);
    for (const protectedName of [
      "angle-1.png",
      "product-ref.png",
      "background.png",
      "final.png",
      "meta.json",
    ]) {
      assert.ok(!names.includes(protectedName), `${protectedName} bị coi là junk`);
    }
  });

  await t.test("junk clean giữ toàn bộ trap names và file nguồn/thành phẩm", async () => {
    const dir = seedJunk("junk-clean");
    const res = await fetch(`${BASE}/api/images/junk-clean/junk/clean`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, 3);
    const left = fs.readdirSync(dir);
    for (const name of [
      "angle-.png.fit.tmp.png",
      "angle-1.jpg.fit.tmp.png",
      "xangle-1.png.fit.tmp.png",
      "angle-1.png.fit.tmp.png.bak",
      "fit.tmp.png",
      "angle-1.png",
      "product-ref.png",
      "background.png",
      "final.png",
      "meta.json",
    ]) {
      assert.ok(left.includes(name), `${name} bị xóa oan`);
    }
  });

  await t.test("junk clean giữ biến thể khác hoa/thường trong project riêng", async () => {
    makeProject("junk-case");
    const file = path.join(dirOf("junk-case"), "angle-1.png.FIT.TMP.PNG");
    fs.writeFileSync(file, "trap");
    const res = await fetch(`${BASE}/api/images/junk-case/junk/clean`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, 0);
    assert.ok(fs.existsSync(file), "biến thể hoa/thường bị xóa oan");
  });

  const realLstat = fs.lstatSync.bind(fs);
  await t.test("ENOENT giữa readdir/lstat bị bỏ qua, GET vẫn 200", async () => {
    seedJunk("junk-race");
    let fired = 0;
    fs.lstatSync = (target, ...rest) => {
      if (
        typeof target === "string" &&
        target.endsWith("angle-1.png.fit.tmp.png") &&
        fired === 0
      ) {
        fired += 1;
        fs.rmSync(target, { force: true });
      }
      return realLstat(target, ...rest);
    };
    try {
      const res = await fetch(`${BASE}/api/images/junk-race/junk`);
      assert.equal(fired, 1, "race hook không chạy");
      assert.equal(res.status, 200, await res.text());
    } finally {
      fs.lstatSync = realLstat;
    }
  });

  await t.test("lỗi lstat khác ENOENT vẫn nổi lên 500", async () => {
    seedJunk("junk-eacces");
    let fired = 0;
    fs.lstatSync = (target, ...rest) => {
      if (typeof target === "string" && target.endsWith(".fit.tmp.png") && fired === 0) {
        fired += 1;
        const error = new Error("EACCES: permission denied");
        error.code = "EACCES";
        throw error;
      }
      return realLstat(target, ...rest);
    };
    try {
      const res = await fetch(`${BASE}/api/images/junk-eacces/junk`);
      assert.equal(fired, 1);
      assert.equal(res.status, 500);
      assert.equal((await res.json()).error.code, "INTERNAL");
    } finally {
      fs.lstatSync = realLstat;
    }
  });

  await t.test("collectImageJunk chỉ nuốt ENOENT và không dùng existsSync chốt race", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "apps", "server", "src", "routes", "images.ts"),
      "utf8",
    );
    const start = source.indexOf("function collectImageJunk");
    const end = source.indexOf("// GET /api/images/:id/junk", start);
    assert.ok(start >= 0 && end > start, "không tìm thấy collectImageJunk");
    const body = source.slice(start, end);
    assert.match(body, /code\s*===\s*["']ENOENT["'][\s\S]*?continue/);
    assert.match(body, /throw\s+err/);
    assert.doesNotMatch(body, /existsSync\(abs\)/);
  });

  await t.test("path traversal bị vô hiệu nhưng basename hợp lệ giữ nguyên", async () => {
    makeProject("path-meta", {
      background: "../background.png",
      final: "/tmp/final.png",
      productRef: "..\\..\\product-ref.png",
      angles: ["angle-1.png", "sub/angle-2.png", "../angle-3.png"],
    });
    let res = await fetch(`${BASE}/api/images/path-meta`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.background, null);
    assert.equal(body.final, null);
    assert.equal(body.productRef, null);
    assert.deepEqual(body.angles, ["angle-1.png"]);

    makeProject("path-ok", {
      background: "background.png",
      final: "final.png",
      productRef: "product-ref.png",
      angles: ["angle-1.png"],
    });
    res = await fetch(`${BASE}/api/images/path-ok`);
    body = await res.json();
    assert.equal(body.background, "background.png");
    assert.equal(body.final, "final.png");
    assert.equal(body.productRef, "product-ref.png");
    assert.deepEqual(body.angles, ["angle-1.png"]);
  });

  await t.test("replace productRef dọn angles và đổi updatedAt", async () => {
    seedWithAngles("replace-ref", { final: null });
    const before = metaOf("replace-ref").updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])]), "new.jpg");
    const res = await fetch(`${BASE}/api/images/replace-ref/product-ref`, {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.productRef, "product-ref.jpg");
    assert.deepEqual(body.angles, []);
    assert.equal(body.status, "draft");
    assert.notEqual(body.updatedAt, before);
    const left = fs.readdirSync(dirOf("replace-ref"));
    assert.ok(!left.some((name) => /^angle-\d+\.png(?:\.fit\.tmp\.png)?$/.test(name)));
  });

  await t.test("delete productRef giữ done chỉ khi final thật còn trên disk", async () => {
    seedWithAngles("delete-final", { final: "final.png" });
    fs.writeFileSync(path.join(dirOf("delete-final"), "final.png"), "final");
    let res = await fetch(`${BASE}/api/images/delete-final/product-ref`, { method: "DELETE" });
    assert.equal((await res.json()).status, "done");

    seedWithAngles("delete-draft", { final: "final.png" });
    res = await fetch(`${BASE}/api/images/delete-draft/product-ref`, { method: "DELETE" });
    const body = await res.json();
    assert.equal(body.status, "draft");
    assert.deepEqual(body.angles, []);
  });

  await t.test("chốt an toàn: đúng một enqueue và không job chạy/xong", () => {
    assert.equal(enqueued.length, 1, "proof phải có đúng một safe 202 qua queue stub");
    const unsafe = db
      .listJobs(100)
      .filter(({ status }) => status === "running" || status === "done");
    assert.deepEqual(unsafe, []);
    for (const key of PROVIDER_ENV_KEYS) assert.equal(process.env[key], undefined);
  });
});
