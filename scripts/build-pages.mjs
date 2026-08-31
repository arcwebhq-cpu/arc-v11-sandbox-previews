import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECT_ROOT,
  asciiSort,
  canonicalJson,
  sha256,
  validatePreviewRepository,
} from "./preview-contract.mjs";

export async function createPagesArtifact({ root = PROJECT_ROOT, write = false } = {}) {
  const result = await validatePreviewRepository({ root });
  const files = new Map([
    [".nojekyll", Buffer.alloc(0)],
    ["index.html", result.rootBytes],
    ...result.pages.map((page) => [page.repository_path, page.bytes]),
  ]);
  const fileRecords = asciiSort([...files.keys()]).map((relative) => {
    const bytes = files.get(relative);
    return Object.freeze({ path: relative, size_bytes: bytes.length, sha256: sha256(bytes) });
  });
  const artifactManifest = Object.freeze({
    schema: "arc-v11-sandbox-pages-artifact-v1",
    source_manifest_sha256: result.manifest.sha256,
    repository: result.manifest.value.repository,
    repository_id: result.manifest.value.repository_id,
    base_branch: result.manifest.value.base_branch,
    build_type: result.manifest.value.pages.build_type,
    preview_folder: result.manifest.value.revision.preview_folder,
    file_count: fileRecords.length,
    files: fileRecords,
    files_sha256: sha256(canonicalJson(fileRecords)),
  });
  const artifactManifestBytes = Buffer.from(`${canonicalJson(artifactManifest)}\n`, "utf8");

  if (write) {
    const output = path.resolve(root, result.manifest.value.pages.artifact_directory);
    if (output !== path.join(path.resolve(root), ".pages-dist") ||
        output === path.parse(output).root) {
      throw new Error("ARC_SANDBOX_PREVIEW_INVALID: unsafe Pages output directory");
    }
    await rm(output, { recursive: true, force: true });
    for (const relative of asciiSort([...files.keys()])) {
      const target = path.join(output, ...relative.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, files.get(relative), { flag: "wx" });
    }
  }
  return Object.freeze({
    artifactManifest,
    artifactManifestBytes,
    files: Object.freeze(new Map(files)),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const checkOnly = process.argv.includes("--check");
  if (process.argv.length > (checkOnly ? 3 : 2) ||
      process.argv.slice(2).some((argument) => argument !== "--check")) {
    throw new Error("Usage: node scripts/build-pages.mjs [--check]");
  }
  const root = process.env.ARC_PUBLIC_SEED_ROOT
    ? path.resolve(process.env.ARC_PUBLIC_SEED_ROOT) : PROJECT_ROOT;
  const result = await createPagesArtifact({ root, write: !checkOnly });
  process.stdout.write(
    `${checkOnly ? "Checked" : "Built"} deterministic Pages artifact: ` +
    `${result.artifactManifest.file_count} public files, ` +
    `${result.artifactManifest.files_sha256}.\n`
  );
}
