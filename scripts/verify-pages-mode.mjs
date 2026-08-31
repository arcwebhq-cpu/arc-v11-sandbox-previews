import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXPECTED_REPOSITORY, PROJECT_ROOT, loadManifest } from "./preview-contract.mjs";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2022-11-28";

export async function verifyWorkflowOnlyPages({
  root = PROJECT_ROOT,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const manifest = (await loadManifest(root)).value;
  if (repository !== EXPECTED_REPOSITORY || repository !== manifest.repository ||
      typeof token !== "string" || token.length < 1 || typeof fetchImpl !== "function") {
    throw new Error("ARC_SANDBOX_PAGES_INVALID: readback authority");
  }
  const url = new URL(`/repos/${repository}/pages`, API_ORIGIN);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "arc-v11-sandbox-pages-contract",
    },
  });
  if (response.status !== 200) {
    throw new Error(`ARC_SANDBOX_PAGES_INVALID: settings HTTP ${response.status}`);
  }
  const site = await response.json();
  if (!site || typeof site !== "object" || Array.isArray(site) ||
      site.build_type !== "workflow" ||
      site.html_url !== `${manifest.pages.public_base_url}/`) {
    throw new Error("ARC_SANDBOX_PAGES_INVALID: GitHub Actions-only Pages is required");
  }
  return Object.freeze({ build_type: site.build_type, html_url: site.html_url });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) {
    throw new Error("Usage: node scripts/verify-pages-mode.mjs");
  }
  const root = process.env.ARC_TRUSTED_CONTRACT_ROOT
    ? path.resolve(process.env.ARC_TRUSTED_CONTRACT_ROOT) : PROJECT_ROOT;
  const result = await verifyWorkflowOnlyPages({ root });
  process.stdout.write(
    `ARC sandbox Pages source passed: ${result.build_type} ${result.html_url}.\n`
  );
}
