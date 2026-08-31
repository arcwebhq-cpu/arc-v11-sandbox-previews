import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPagesArtifact } from "../scripts/build-pages.mjs";
import {
  BINDING_PAGE_PATHS,
  EXPECTED_PREVIEW_FOLDER,
  EXPECTED_REPOSITORY,
  EXPECTED_REPOSITORY_ID,
  LOGICAL_PAGE_PATHS,
  PROJECT_ROOT,
  canonicalJson,
  validatePreviewRepository,
} from "../scripts/preview-contract.mjs";
import { scanPublicSeed } from "../scripts/secret-scan.mjs";

test("the public seed is exactly one inert five-page source", async () => {
  const result = await validatePreviewRepository();
  assert.equal(result.manifest.value.repository, EXPECTED_REPOSITORY);
  assert.equal(result.manifest.value.repository_id, EXPECTED_REPOSITORY_ID);
  assert.equal(result.manifest.value.pages.build_type, "workflow");
  assert.deepEqual(result.pages.map((page) => page.path), LOGICAL_PAGE_PATHS);
  assert.deepEqual(result.bindingPages.map((page) => page.path), BINDING_PAGE_PATHS);
  assert.ok(result.pages.every((page) => page.repository_path.startsWith(
    `${EXPECTED_PREVIEW_FOLDER}/`)));
  assert.ok(result.totalBytes > 0 && result.totalBytes <= 500_000);
});

test("the Pages artifact is a deterministic strict allowlist", async () => {
  const first = await createPagesArtifact();
  const second = await createPagesArtifact();
  assert.equal(first.artifactManifestBytes.equals(second.artifactManifestBytes), true);
  assert.equal(first.artifactManifest.files_sha256,
    second.artifactManifest.files_sha256);
  assert.equal(first.artifactManifest.file_count, 7);
  assert.deepEqual([...first.files.keys()].sort(), [
    ".nojekyll",
    `${EXPECTED_PREVIEW_FOLDER}/about/index.html`,
    `${EXPECTED_PREVIEW_FOLDER}/contact/index.html`,
    `${EXPECTED_PREVIEW_FOLDER}/index.html`,
    `${EXPECTED_PREVIEW_FOLDER}/process/index.html`,
    `${EXPECTED_PREVIEW_FOLDER}/services/index.html`,
    "index.html",
  ]);
  const parsed = JSON.parse(first.artifactManifestBytes.toString("utf8"));
  assert.equal(`${canonicalJson(parsed)}\n`, first.artifactManifestBytes.toString("utf8"));
});

test("the public footprint and secret scan are exact", async () => {
  const result = await scanPublicSeed();
  assert.equal(result.fileCount, 22);
});

test("an active surface or extra route fails closed", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "arc-preview-seed-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(PROJECT_ROOT, temporary, {
    recursive: true,
    filter: (source) => ![".pages-dist", ".git", "node_modules"].includes(path.basename(source)),
  });
  const servicePath = path.join(temporary, EXPECTED_PREVIEW_FOLDER,
    "services", "index.html");
  const service = await readFile(servicePath, "utf8");
  await writeFile(servicePath, service.replace("</body>", "<script>void 0</script></body>"));
  await assert.rejects(validatePreviewRepository({ root: temporary }),
    /trusted preview script|active surface/);

  await writeFile(servicePath, service);
  await writeFile(servicePath,
    service.replace("</head>", '<meta http-equiv="refresh" content="0;url=//evil.example">\n</head>'));
  await assert.rejects(validatePreviewRepository({ root: temporary }), /navigation primitive/);

  await writeFile(servicePath,
    service.replace("</main>", '<img src="//evil.example/pixel.png" alt="">\n</main>'));
  await assert.rejects(validatePreviewRepository({ root: temporary }),
    /unbound remote dependency/);

  await writeFile(servicePath, service.replace(
    "img-src 'self' data: https:", "img-src 'self' data: https: *"));
  await assert.rejects(validatePreviewRepository({ root: temporary }), /CSP is not exact/);

  await writeFile(servicePath, service);
  await writeFile(path.join(temporary, EXPECTED_PREVIEW_FOLDER, "extra.txt"), "not allowed\n");
  await assert.rejects(validatePreviewRepository({ root: temporary }), /preview subtree/);
});
