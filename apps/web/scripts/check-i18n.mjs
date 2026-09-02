#!/usr/bin/env node
/**
 * Cổng i18n dùng trong CI. Chạy từ repo root:
 *   node apps/web/scripts/check-i18n.mjs
 *
 * Gate cố ý không kiểm key chưa dùng hoặc bản dịch Anh trùng Việt: cả hai đều
 * có trường hợp hợp lệ. Các lỗi dưới đây đều làm exit 1 vì chúng tạo drift thật.
 */

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(WEB_ROOT, "src");
const LOCALES = join(SRC, "lib", "locales");
const LIMIT = 30;

const localeSources = {
  vi: readFileSync(join(LOCALES, "vi.ts"), "utf8"),
  en: readFileSync(join(LOCALES, "en.ts"), "utf8"),
};

function transformLocale(source, name) {
  const declaration = new RegExp(
    `export\\s+const\\s+${name}\\s*:\\s*Record\\s*<\\s*string\\s*,\\s*string\\s*>\\s*=`,
  );
  if (!declaration.test(source)) {
    throw new Error(`Không nhận ra khai báo locale ${name}.ts`);
  }
  return source.replace(declaration, `export const ${name} =`);
}

async function loadLocales() {
  const dir = mkdtempSync(join(tmpdir(), "aiev-i18n-"));
  try {
    const result = {};
    for (const name of ["vi", "en"]) {
      const file = join(dir, `${name}.mjs`);
      writeFileSync(file, transformLocale(localeSources[name], name), "utf8");
      const module = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
      const dictionary = module[name];
      if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
        throw new Error(`${name}.ts không export object ${name}`);
      }
      for (const [key, value] of Object.entries(dictionary)) {
        if (typeof value !== "string") {
          throw new Error(`${name}.ts: ${key} không phải chuỗi`);
        }
      }
      result[name] = dictionary;
    }
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function duplicateKeys(source, locale) {
  const sourceFile = ts.createSourceFile(
    `${locale}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let dictionary = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === locale &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        dictionary = declaration.initializer;
      }
    }
  }
  if (!dictionary) throw new Error(`Không tìm thấy object locale ${locale}`);

  const seen = new Map();
  const duplicates = [];
  for (const property of dictionary.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name)) continue;
    const key = property.name.text;
    const line = sourceFile.getLineAndCharacterOfPosition(property.name.getStart(sourceFile)).line + 1;
    if (seen.has(key)) {
      duplicates.push({ locale, key, first: seen.get(key), line });
    } else {
      seen.set(key, line);
    }
  }
  return duplicates;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function calledKeys() {
  const calls = [];
  const used = new Set();
  for (const file of walk(SRC)) {
    if (file.startsWith(`${LOCALES}/`) || file.startsWith(`${LOCALES}\\`)) continue;
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "t" || node.expression.text === "tf") &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        used.add(key);
        calls.push({ file: relative(WEB_ROOT, file).replace(/\\/g, "/"), key });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { calls, used };
}

function placeholders(value) {
  return [...new Set([...value.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]))].sort();
}

function printGroup(title, items, render) {
  if (!items.length) return;
  console.error(`\n${title} (${items.length})`);
  for (const item of items.slice(0, LIMIT)) console.error(`  ${render(item)}`);
  if (items.length > LIMIT) console.error(`  … và ${items.length - LIMIT} lỗi nữa`);
}

const { vi, en } = await loadLocales();
const viKeys = Object.keys(vi);
const enKeys = Object.keys(en);
const viSet = new Set(viKeys);
const enSet = new Set(enKeys);
const { calls, used } = calledKeys();

const duplicateList = [
  ...duplicateKeys(localeSources.vi, "vi"),
  ...duplicateKeys(localeSources.en, "en"),
];
const missingViCalls = calls.filter(({ key }) => !viSet.has(key));
const enMissing = viKeys.filter((key) => !enSet.has(key)).sort();
const enExtra = enKeys.filter((key) => !viSet.has(key)).sort();
const placeholderMismatch = viKeys
  .filter((key) => enSet.has(key))
  .map((key) => ({ key, vi: placeholders(vi[key]), en: placeholders(en[key]) }))
  .filter(({ vi: a, en: b }) => JSON.stringify(a) !== JSON.stringify(b));

printGroup(
  "DUPLICATE KEY",
  duplicateList,
  ({ locale, key, first, line }) => `${locale}.ts:${line}  ${key} (lần đầu dòng ${first})`,
);
printGroup(
  "KEY ĐƯỢC GỌI NHƯNG VI THIẾU",
  missingViCalls,
  ({ file, key }) => `${file}  ${key}`,
);
printGroup("EN THIẾU KEY CÓ TRONG VI", enMissing, (key) => key);
printGroup("EN THỪA KEY KHÔNG CÓ TRONG VI", enExtra, (key) => key);
printGroup(
  "PLACEHOLDER VI/EN KHÔNG KHỚP",
  placeholderMismatch,
  ({ key, vi: a, en: b }) => `${key}  vi={${a.join(",")}} en={${b.join(",")}}`,
);

const errorCount =
  duplicateList.length +
  missingViCalls.length +
  enMissing.length +
  enExtra.length +
  placeholderMismatch.length;

console.log(
  `\ni18n: vi=${viKeys.length}, en=${enKeys.length}, called=${used.size}, errors=${errorCount}`,
);
if (errorCount) process.exit(1);
console.log("i18n: sạch.");
