import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { EXPECTED_CHECK_NAME, EXPECTED_REPOSITORY, PROJECT_ROOT } from
  "../scripts/preview-contract.mjs";
import { verifyWorkflowOnlyPages } from "../scripts/verify-pages-mode.mjs";

const workflow = await readFile(path.join(PROJECT_ROOT, ".github", "workflows",
  "arc-sandbox-preview.yml"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));

test("the Actions workflow is pinned, least-privilege, and workflow-only", () => {
  assert.match(workflow, /^name: ARC sandbox preview$/m);
  assert.match(workflow, new RegExp(`name: ${EXPECTED_CHECK_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch|schedule:/);
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  for (const relative of ["index.html", "services/index.html", "about/index.html",
    "process/index.html", "contact/index.html"]) {
    const escaped = `arc-v11-sandbox-seed-00000000/${relative}`
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal((workflow.match(new RegExp(`- ${escaped}`, "g")) || []).length, 2);
  }
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /needs: validate-five-page/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 4);
  assert.equal((workflow.match(/fetch-depth: 0/g) || []).length, 4);
  assert.equal((workflow.match(/run: npm run verify:event/g) || []).length, 2);
  assert.equal((workflow.match(/run: npm run verify:pages-mode/g) || []).length, 2);
  assert.equal((workflow.match(/GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/g) || []).length, 3);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}\n\s+path: \.trusted-contract/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\n\s+path: \.candidate/);
  assert.match(workflow, /run: node \.trusted-contract\/scripts\/verify-event\.mjs/);
  assert.match(workflow, /node \.trusted-contract\/scripts\/validate-preview\.mjs\n\s+node \.trusted-contract\/scripts\/secret-scan\.mjs\n\s+node \.trusted-contract\/scripts\/build-pages\.mjs --check/);
  assert.doesNotMatch(workflow, /(?:npm|node)\s+(?:--prefix\s+)?\.candidate/);
  assert.match(workflow, /node-version: 22\.23\.2/);
  assert.match(workflow, /name: github-pages\n\s+path: \.pages-dist\n\s+include-hidden-files: true/);
  assert.doesNotMatch(workflow, /path:\s*["']?\.["']?\s*$/m);
  assert.match(workflow, /environment:\n\s+name: github-pages/);
  assert.match(workflow, /deploy-pages:[\s\S]*permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
  assert.doesNotMatch(workflow, /contents: write|packages: write|actions: write/);

  const reviewed = new Map([
    ["actions/checkout", ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1", 4]],
    ["actions/setup-node", ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0", 2]],
    ["actions/configure-pages", ["45bfe0192ca1faeb007ade9deae92b16b8254a0d", "v6.0.0", 1]],
    ["actions/upload-pages-artifact", ["fc324d3547104276b827a68afc52ff2a11cc49c9", "v5.0.0", 1]],
    ["actions/deploy-pages", ["cd2ce8fcbc39b97be8ca5fce6e763baed58fa128", "v5.0.0", 1]],
  ]);
  const uses = [...workflow.matchAll(/^\s*uses:\s+([^@\s]+)@([a-f0-9]{40})\s+#\s+(v\d+\.\d+\.\d+)\s*$/gm)]
    .map((match) => ({ action: match[1], sha: match[2], version: match[3] }));
  assert.equal(uses.length, 9);
  for (const [action, [sha, version, count]] of reviewed) {
    const found = uses.filter((entry) => entry.action === action);
    assert.equal(found.length, count, action);
    assert.ok(found.every((entry) => entry.sha === sha && entry.version === version), action);
  }
});

test("the package has no dependency or lifecycle surface", () => {
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
  assert.equal(Object.hasOwn(packageJson.scripts, "preinstall"), false);
  assert.equal(Object.hasOwn(packageJson.scripts, "postinstall"), false);
  assert.match(packageJson.scripts.test, /^npm run validate &&/);
});

test("Pages settings must read back as workflow-only for the exact repository", async () => {
  let observed;
  const result = await verifyWorkflowOnlyPages({
    repository: EXPECTED_REPOSITORY,
    token: "test-token-not-a-secret",
    fetchImpl: async (url, options) => {
      observed = { url: url.href, options };
      return {
        status: 200,
        json: async () => ({
          build_type: "workflow",
          html_url: "https://arcwebhq-sandbox.github.io/arc-v11-sandbox-previews/",
        }),
      };
    },
  });
  assert.deepEqual(result, {
    build_type: "workflow",
    html_url: "https://arcwebhq-sandbox.github.io/arc-v11-sandbox-previews/",
  });
  assert.equal(observed.url,
    "https://api.github.com/repos/arcwebhq-sandbox/arc-v11-sandbox-previews/pages");
  assert.equal(observed.options.method, "GET");
  assert.equal(observed.options.redirect, "error");
  assert.equal(observed.options.headers["X-GitHub-Api-Version"], "2022-11-28");

  await assert.rejects(verifyWorkflowOnlyPages({
    repository: EXPECTED_REPOSITORY,
    token: "test-token-not-a-secret",
    fetchImpl: async () => ({ status: 200, json: async () => ({
      build_type: "legacy",
      html_url: "https://arcwebhq-sandbox.github.io/arc-v11-sandbox-previews/",
    }) }),
  }), /Actions-only Pages is required/);
});
