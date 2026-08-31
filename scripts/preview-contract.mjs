import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
export const MANIFEST_PATH = "config/public-preview-manifest.json";
export const EXPECTED_REPOSITORY = "arcwebhq-sandbox/arc-v11-sandbox-previews";
export const EXPECTED_REPOSITORY_ID = 1351889100;
export const EXPECTED_BASE_BRANCH = "main";
export const EXPECTED_BOOTSTRAP_SOURCE_SHA =
  "af590c1ae9d40b97bebc4645e6a0921baacce3e2";
export const EXPECTED_PREVIEW_FOLDER = "arc-v11-sandbox-seed-00000000";
export const EXPECTED_HEAD_PREFIX = "arc-v11-sandbox/revision/";
export const EXPECTED_CHECK_NAME = "ARC sandbox preview five-page contract";
export const TRUSTED_INLINE_SCRIPT_SHA256 =
  "45ade959420903058cd2ca3845a8ed4d21bcf8db0294d602a2404237f65b24cc";
export const LOGICAL_PAGE_PATHS = Object.freeze([
  "index.html",
  "services/index.html",
  "about/index.html",
  "process/index.html",
  "contact/index.html",
]);
export const BINDING_PAGE_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "index.html",
  "process/index.html",
  "services/index.html",
]);
export const PAGE_KEYS = Object.freeze([
  "home", "services", "about", "process", "contact",
]);
export const PAGE_LABELS = Object.freeze([
  "Home", "Services", "About", "Process", "Contact",
]);
export const PUBLIC_SOURCE_FILES = Object.freeze([
  ".github/workflows/arc-sandbox-preview.yml",
  ".gitignore",
  ".nojekyll",
  ".nvmrc",
  "README.md",
  `${EXPECTED_PREVIEW_FOLDER}/about/index.html`,
  `${EXPECTED_PREVIEW_FOLDER}/contact/index.html`,
  `${EXPECTED_PREVIEW_FOLDER}/index.html`,
  `${EXPECTED_PREVIEW_FOLDER}/process/index.html`,
  `${EXPECTED_PREVIEW_FOLDER}/services/index.html`,
  "config/public-preview-manifest.json",
  "index.html",
  "package.json",
  "scripts/build-pages.mjs",
  "scripts/preview-contract.mjs",
  "scripts/secret-scan.mjs",
  "scripts/validate-preview.mjs",
  "scripts/verify-event.mjs",
  "scripts/verify-pages-mode.mjs",
  "tests/event-contract.test.mjs",
  "tests/preview-seed.test.mjs",
  "tests/workflow-contract.test.mjs",
]);

const HEX_64 = /^[a-f0-9]{64}$/;
const PREVIEW_FOLDER = /^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/;

export function asciiSort(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value) && Object.keys(value).length === value.length) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype) {
    return `{${asciiSort(Object.keys(value)).map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("ARC_SANDBOX_PREVIEW_INVALID: canonical JSON value");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      canonicalJson(asciiSort(Object.keys(value))) !== canonicalJson(asciiSort(expected))) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} fields`);
  }
  return value;
}

function exactArray(actual, expected, label) {
  if (!Array.isArray(actual) || canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label}`);
  }
  return actual;
}

export async function readRegularFile(root, relative) {
  const normalized = path.posix.normalize(relative);
  if (typeof relative !== "string" || normalized !== relative || !relative ||
      relative.startsWith("../") || path.isAbsolute(relative) || relative.includes("\\")) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: unsafe path ${String(relative)}`);
  }
  const absolute = path.join(root, ...relative.split("/"));
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${relative} is not a regular file`);
  }
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(absolute);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${relative} escaped the repository`);
  }
  return readFile(resolved);
}

export async function loadManifest(root = PROJECT_ROOT) {
  const bytes = await readRegularFile(root, MANIFEST_PATH);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: manifest JSON");
  }
  exactKeys(manifest,
    ["schema", "repository", "repository_id", "base_branch", "bootstrap_source_sha",
      "pages", "revision"],
    "manifest");
  exactKeys(manifest.pages,
    ["artifact_directory", "artifact_name", "build_type", "environment", "public_base_url"],
    "Pages manifest");
  exactKeys(manifest.revision,
    ["binding_page_paths", "head_branch_prefix", "lead_route_mode",
      "logical_page_paths", "preview_folder", "repository_page_paths",
      "required_check_name", "trusted_inline_script_sha256"], "revision manifest");
  const expectedRepositoryPaths = BINDING_PAGE_PATHS.map((entry) =>
    `${EXPECTED_PREVIEW_FOLDER}/${entry}`);
  if (manifest.schema !== "arc-v11-sandbox-public-preview-manifest-v1" ||
      manifest.repository !== EXPECTED_REPOSITORY ||
      manifest.repository_id !== EXPECTED_REPOSITORY_ID ||
      manifest.base_branch !== EXPECTED_BASE_BRANCH ||
      manifest.bootstrap_source_sha !== EXPECTED_BOOTSTRAP_SOURCE_SHA ||
      manifest.pages.build_type !== "workflow" ||
      manifest.pages.artifact_directory !== ".pages-dist" ||
      manifest.pages.artifact_name !== "github-pages" ||
      manifest.pages.environment !== "github-pages" ||
      manifest.pages.public_base_url !==
        "https://arcwebhq-sandbox.github.io/arc-v11-sandbox-previews" ||
      manifest.revision.head_branch_prefix !== EXPECTED_HEAD_PREFIX ||
      manifest.revision.required_check_name !== EXPECTED_CHECK_NAME ||
      manifest.revision.preview_folder !== EXPECTED_PREVIEW_FOLDER ||
      !PREVIEW_FOLDER.test(manifest.revision.preview_folder) ||
      manifest.revision.lead_route_mode !== "not_required" ||
      manifest.revision.trusted_inline_script_sha256 !== TRUSTED_INLINE_SCRIPT_SHA256) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: immutable manifest binding");
  }
  exactArray(manifest.revision.logical_page_paths, LOGICAL_PAGE_PATHS,
    "logical page vector");
  exactArray(manifest.revision.binding_page_paths, BINDING_PAGE_PATHS,
    "source binding page vector");
  exactArray(manifest.revision.repository_page_paths, expectedRepositoryPaths,
    "repository page vector");
  return Object.freeze({
    value: manifest,
    bytes,
    sha256: sha256(bytes),
  });
}

function exactlyOneMatch(text, expression, label) {
  const matches = [...text.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label}`);
  }
  return matches[0];
}

function metaContent(html, name, label) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return exactlyOneMatch(html,
    new RegExp(`<meta\\s+name="${escaped}"\\s+content="([^"]*)"\\s*\/?>`, "gi"),
    `${label} ${name} meta`)[1];
}

function expectedNavigation(pageKey) {
  const currentIndex = PAGE_KEYS.indexOf(pageKey);
  return PAGE_KEYS.map((target, index) => {
    let href;
    if (currentIndex === 0) href = index === 0 ? "./" : `./${target}/`;
    else if (index === 0) href = "../";
    else href = index === currentIndex ? "./" : `../${target}/`;
    return { href, label: PAGE_LABELS[index], current: index === currentIndex };
  });
}

function validateCsp(html, label, { generatedPage = false } = {}) {
  const content = exactlyOneMatch(html,
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/gi,
    `${label} CSP`)[1];
  const observed = content.split(";").map((value) => value.trim()).filter(Boolean);
  const expected = generatedPage ? [
    "default-src 'none'", "img-src 'self' data: https:", "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'", "script-src-attr 'none'", "connect-src 'none'",
    "font-src 'self' data:", "media-src 'none'", "object-src 'none'",
    "frame-src 'none'", "worker-src 'none'", "manifest-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'",
  ] : [
    "default-src 'none'", "style-src 'unsafe-inline'", "img-src 'self' data:",
    "script-src 'none'", "connect-src 'none'", "object-src 'none'",
    "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
    "frame-ancestors 'none'",
  ];
  if (canonicalJson(observed) !== canonicalJson(expected) ||
      new Set(observed.map((entry) => entry.split(/\s+/, 1)[0])).size !== observed.length) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} CSP is not exact`);
  }
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num);/gi,
      (_, name) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">",
        colon: ":", sol: "/", period: ".", commat: "@", percnt: "%", num: "#" })
        [name.toLowerCase()]);
}

function recursivelyDecode(value) {
  let current = String(value ?? "");
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodeEntities(current);
    try { next = decodeURIComponent(next.replace(/\+/g, "%20")); } catch {}
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
}

function exactBoundAssetUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const prefix = `/arc-v11-sandbox-previews/${EXPECTED_PREVIEW_FOLDER}/assets/`;
  return url.protocol === "https:" && !url.username && !url.password &&
    url.origin === "https://arcwebhq-sandbox.github.io" &&
    url.pathname.startsWith(prefix) && !url.search && !url.hash &&
    /^[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname.slice(prefix.length));
}

function validateNoActiveSurface(html, label, { allowBoundPagesAssets = false } = {}) {
  const decode = (value) => recursivelyDecode(value)
    .replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  const remote = (value) => /^(?:https?:)?\/\//i.test(decode(value));
  const safeLocal = (value) => {
    const decoded = decode(value);
    return /^\/(?!\/)[^\\\s]*$/.test(decoded) ||
      /^\.?\.\/(?!\/)[^\\\s:]*$/.test(decoded) ||
      /^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=@%/-]*$/.test(decoded) ||
      /^#[A-Za-z0-9_.:-]*$/.test(decoded);
  };
  const activeSurface = /\son[a-z]+\s*=|data-netlify|mailto:|javascript:/iu;
  if (activeSurface.test(recursivelyDecode(html))) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has an active surface`);
  }
  for (const tag of html.match(/<[A-Za-z][^>]*>/g) || []) {
    const tagName = tag.match(/^<\s*([A-Za-z][A-Za-z0-9:-]*)/)?.[1].toLowerCase() || "";
    if (["base", "embed", "iframe", "object", "portal"].includes(tagName) ||
        tagName === "meta" && /\bhttp-equiv\s*=\s*["']?refresh/i.test(
          recursivelyDecode(tag))) {
      throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has a navigation primitive`);
    }
    const attributes = [...tag.matchAll(
      /\b(srcset|src|poster|data|action|formaction|href|xlink:href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)];
    const declared = (tag.match(
      /\b(?:srcset|src|poster|data|action|formaction|href|xlink:href|style)\s*=/gi) || []).length;
    if (attributes.length !== declared) {
      throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has a malformed URL attribute`);
    }
    for (const match of attributes) {
      const attribute = match[1].toLowerCase();
      const raw = match[2] ?? match[3] ?? match[4] ?? "";
      if (attribute === "style") {
        if (/@import\b|url\s*\(/i.test(decode(raw))) {
          throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has a CSS resource`);
        }
        continue;
      }
      const values = attribute === "srcset"
        ? decode(raw).split(",").map((candidate) =>
          candidate.trim().split(/\s+/, 1)[0]).filter(Boolean)
        : [decode(raw)];
      if (!values.length) {
        throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has an empty URL`);
      }
      for (const value of values) {
        if (remote(value)) {
          if (!allowBoundPagesAssets || !["img", "source"].includes(tagName) ||
              !["src", "srcset"].includes(attribute) || !exactBoundAssetUrl(value)) {
            throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has an unbound remote dependency`);
          }
        } else if (!safeLocal(value)) {
          throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has an unsafe local URL`);
        }
      }
    }
  }
  for (const style of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []) {
    if (/@import\b|url\s*\(/i.test(recursivelyDecode(style))) {
      throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has a CSS resource`);
    }
  }
  const scripts = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join("\n");
  const forbiddenScript = [
    /\bfetch\s*\(/i, /\bXMLHttpRequest\b/i, /\bWebSocket\s*\(/i,
    /\bEventSource\s*\(/i, /\bsendBeacon\s*\(/i, /\bserviceWorker\b/i,
    /\bimportScripts\s*\(/i, /\bnew\s+Image\s*\(/i,
    /\.(?:src|srcset|poster)\s*=/i,
    /\.setAttribute\s*\(\s*["'](?:src|srcset|poster)["']/i,
  ];
  if (forbiddenScript.some((expression) => expression.test(scripts))) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} has executable egress`);
  }
}

function validateTrustedInlineScript(html, label) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  if (scripts.length !== 1 || (html.match(/<script\b/gi) || []).length !== 1 ||
      sha256(scripts[0][1]) !== TRUSTED_INLINE_SCRIPT_SHA256) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} trusted preview script`);
  }
}

function validateRootIndex(html) {
  if (!/^<!doctype html>\n/i.test(html) ||
      (html.match(/<main\b/gi) || []).length !== 1 ||
      (html.match(/<h1\b/gi) || []).length !== 1 ||
      !html.includes(`href="./${EXPECTED_PREVIEW_FOLDER}/"`)) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: root index structure");
  }
  const robots = metaContent(html, "robots", "root index").split(",")
    .map((value) => value.trim().toLowerCase());
  if (!robots.includes("noindex") || !robots.includes("nofollow")) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: root index robots");
  }
  validateCsp(html, "root index");
  validateNoActiveSurface(html, "root index");
}

function validatePage(html, pagePath, pageKey) {
  const label = `${EXPECTED_PREVIEW_FOLDER}/${pagePath}`;
  if (!/^<!doctype html>\n/i.test(html) ||
      (html.match(/<main\b/gi) || []).length !== 1 ||
      (html.match(/<h1\b/gi) || []).length !== 1 ||
      (html.match(/<nav\s+class="nav-links"/gi) || []).length !== 1 ||
      (html.match(/<form\b/gi) || []).length !== 0 ||
      !new RegExp(`<body[^>]*data-arc-site-mode="preview"[^>]*data-arc-page="${pageKey}"`, "i").test(html)) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} structure`);
  }
  const expectedMetas = new Map([
    ["arc-template-version", "11.0"],
    ["arc-site-contract", "arc-five-page-site-v1"],
    ["arc-page-key", pageKey],
    ["arc-page-path", pagePath],
  ]);
  for (const [name, expected] of expectedMetas) {
    if (metaContent(html, name, label) !== expected) {
      throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} ${name}`);
    }
  }
  const robots = metaContent(html, "robots", label).split(",")
    .map((value) => value.trim().toLowerCase());
  if (!robots.includes("noindex") || !robots.includes("nofollow")) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} robots`);
  }
  const title = exactlyOneMatch(html, /<title>([^<]+)<\/title>/gi,
    `${label} title`)[1];
  if (metaContent(html, "arc-page-title", label) !== title) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} page title binding`);
  }
  validateCsp(html, label, { generatedPage: true });
  validateTrustedInlineScript(html, label);
  validateNoActiveSurface(html, label, { allowBoundPagesAssets: true });
  const nav = exactlyOneMatch(html,
    /<nav\s+class="nav-links"[^>]*>([\s\S]*?)<\/nav>/gi, `${label} navigation`)[1];
  const anchors = [...nav.matchAll(
    /<a\s+href="([^"]+)"(\s+aria-current="page")?>([^<]+)<\/a>/gi)]
    .map((match) => ({ href: match[1], current: Boolean(match[2]), label: match[3] }));
  if (canonicalJson(anchors) !== canonicalJson(expectedNavigation(pageKey))) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label} route vector`);
  }
}

async function assertExactPreviewTree(root) {
  const previewRoot = path.join(root, EXPECTED_PREVIEW_FOLDER);
  const rootEntries = await readdir(previewRoot, { withFileTypes: true });
  const observed = asciiSort(rootEntries.map((entry) => entry.name));
  const expected = ["about", "contact", "index.html", "process", "services"];
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: preview subtree");
  }
  for (const entry of rootEntries) {
    if (entry.isSymbolicLink() ||
        (entry.name === "index.html" ? !entry.isFile() : !entry.isDirectory())) {
      throw new Error("ARC_SANDBOX_PREVIEW_INVALID: preview subtree entry type");
    }
    if (entry.name !== "index.html") {
      const children = await readdir(path.join(previewRoot, entry.name),
        { withFileTypes: true });
      if (children.length !== 1 || children[0].name !== "index.html" ||
          !children[0].isFile() || children[0].isSymbolicLink()) {
        throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${entry.name} subtree`);
      }
    }
  }
}

export async function validatePreviewRepository({ root = PROJECT_ROOT } = {}) {
  const manifest = await loadManifest(root);
  await assertExactPreviewTree(root);
  const rootBytes = await readRegularFile(root, "index.html");
  if (rootBytes.length < 1 || rootBytes.length > 50_000 ||
      !rootBytes.equals(Buffer.from(rootBytes.toString("utf8"), "utf8"))) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: root index bytes");
  }
  validateRootIndex(rootBytes.toString("utf8"));
  let totalBytes = 0;
  const pages = [];
  const headings = new Set();
  const titles = new Set();
  const descriptions = new Set();
  for (let index = 0; index < LOGICAL_PAGE_PATHS.length; index += 1) {
    const pagePath = LOGICAL_PAGE_PATHS[index];
    const relative = `${EXPECTED_PREVIEW_FOLDER}/${pagePath}`;
    const bytes = await readRegularFile(root, relative);
    if (bytes.length < 1 || bytes.length > 150_000 ||
        !bytes.equals(Buffer.from(bytes.toString("utf8"), "utf8"))) {
      throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${relative} bytes`);
    }
    const html = bytes.toString("utf8");
    validatePage(html, pagePath, PAGE_KEYS[index]);
    headings.add(exactlyOneMatch(html, /<h1\b[^>]*>([^<]+)<\/h1>/gi,
      `${relative} heading`)[1]);
    titles.add(exactlyOneMatch(html, /<title>([^<]+)<\/title>/gi,
      `${relative} title`)[1]);
    descriptions.add(metaContent(html, "description", relative));
    totalBytes += bytes.length;
    pages.push(Object.freeze({
      path: pagePath,
      repository_path: relative,
      size_bytes: bytes.length,
      sha256: sha256(bytes),
      bytes,
    }));
  }
  if (headings.size !== 5 || titles.size !== 5 || descriptions.size !== 5 ||
      totalBytes > 500_000) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: five-page aggregate");
  }
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const bindingPages = BINDING_PAGE_PATHS.map((pagePath) => byPath.get(pagePath));
  if (bindingPages.some((page) => !page) ||
      bindingPages.some((page, index) =>
        page.repository_path !== manifest.value.revision.repository_page_paths[index])) {
    throw new Error("ARC_SANDBOX_PREVIEW_INVALID: page binding order");
  }
  return Object.freeze({ manifest, rootBytes, pages: Object.freeze(pages),
    bindingPages: Object.freeze(bindingPages), totalBytes });
}

export function assertHex64(value, label) {
  if (!HEX_64.test(String(value || ""))) {
    throw new Error(`ARC_SANDBOX_PREVIEW_INVALID: ${label}`);
  }
  return value;
}
