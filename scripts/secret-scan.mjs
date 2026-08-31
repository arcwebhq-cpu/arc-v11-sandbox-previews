import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PROJECT_ROOT, PUBLIC_SOURCE_FILES, asciiSort } from "./preview-contract.mjs";

const EXCLUDED_DIRECTORIES = new Set([".git", ".pages-dist", "node_modules", "test-results"]);
const FORBIDDEN_COMPONENTS = new Set([
  ".env", "netlify", "operations", "private-integration", "provider-config",
  "workers", "zapier",
]);
const EXPECTED_FILES = new Set(PUBLIC_SOURCE_FILES);

const SECRET_PATTERNS = Object.freeze([
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["Stripe secret", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/u],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{12,}\b/u],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u],
  ["generic assigned secret", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|deploy[_-]?key|private[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{12,}["']/iu],
]);

async function walk(root, relative = "") {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!relative && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`ARC_SANDBOX_SECRET_SCAN_FAILED: symlink ${relative}/${entry.name}`);
    }
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      files.push(...await walk(root, child));
    } else if (entry.isFile()) {
      files.push(child);
    } else {
      throw new Error(`ARC_SANDBOX_SECRET_SCAN_FAILED: non-regular ${child}`);
    }
  }
  return files;
}

export async function scanPublicSeed({ root = PROJECT_ROOT } = {}) {
  const files = asciiSort(await walk(root));
  const unexpected = files.filter((relative) => !EXPECTED_FILES.has(relative));
  const missing = [...EXPECTED_FILES].filter((relative) => !files.includes(relative));
  if (unexpected.length || missing.length) {
    throw new Error(`ARC_SANDBOX_SECRET_SCAN_FAILED: public file allowlist ` +
      `unexpected=${unexpected.join(",")} missing=${missing.join(",")}`);
  }
  const violations = [];
  for (const relative of files) {
    const components = relative.toLowerCase().split("/");
    if (components.some((component) => FORBIDDEN_COMPONENTS.has(component)) ||
        components.some((component) => component.startsWith(".env")) ||
        /(?:^|\/)(?:id_[re]sa|\.zapierrc|credentials|secrets?)(?:\.|$)/iu.test(relative)) {
      violations.push(`${relative}: forbidden operational path`);
      continue;
    }
    const absolute = path.join(root, ...relative.split("/"));
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 500_000) {
      violations.push(`${relative}: unsafe file type or size`);
      continue;
    }
    const bytes = await readFile(absolute);
    const text = bytes.toString("utf8");
    if (!bytes.equals(Buffer.from(text, "utf8"))) {
      violations.push(`${relative}: non-UTF-8 content`);
      continue;
    }
    for (const [label, expression] of SECRET_PATTERNS) {
      if (expression.test(text)) violations.push(`${relative}: ${label}`);
    }
    const secretReferences = [...text.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)]
      .map((match) => match[1]);
    if (secretReferences.some((name) => name !== "GITHUB_TOKEN")) {
      violations.push(`${relative}: unapproved workflow secret reference`);
    }
  }
  const workflow = await readFile(
    path.join(root, ".github", "workflows", "arc-sandbox-preview.yml"), "utf8");
  if (/pull_request_target|contents:\s*write|packages:\s*write|actions:\s*write/iu.test(workflow)) {
    violations.push(".github/workflows/arc-sandbox-preview.yml: excessive workflow authority");
  }
  if (violations.length) {
    throw new Error(`ARC_SANDBOX_SECRET_SCAN_FAILED:\n${violations.join("\n")}`);
  }
  return Object.freeze({ fileCount: files.length, files: Object.freeze(files) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/secret-scan.mjs");
  const root = process.env.ARC_PUBLIC_SEED_ROOT
    ? path.resolve(process.env.ARC_PUBLIC_SEED_ROOT) : PROJECT_ROOT;
  const result = await scanPublicSeed({ root });
  process.stdout.write(`ARC sandbox public secret scan passed: ${result.fileCount} files.\n`);
}
