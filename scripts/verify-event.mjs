import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_BASE_BRANCH,
  EXPECTED_HEAD_PREFIX,
  EXPECTED_REPOSITORY,
  PROJECT_ROOT,
  PUBLIC_SOURCE_FILES,
  canonicalJson,
  loadManifest,
} from "./preview-contract.mjs";

const HEX_40 = /^[a-f0-9]{40}$/;
const REVISION_BRANCH = new RegExp(
  `^${EXPECTED_HEAD_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-f0-9]{64}$`
);

function assertSha(value, label, { zeroAllowed = false } = {}) {
  if (!HEX_40.test(String(value || "")) ||
      (!zeroAllowed && /^0{40}$/.test(String(value)))) {
    throw new Error(`ARC_SANDBOX_CI_INVALID: ${label}`);
  }
  return value;
}

function repositoryName(value) {
  return value?.full_name;
}

function repositoryId(value) {
  return value?.id;
}

export function validateEventPayload({ eventName, event, env, manifest }) {
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY ||
      repositoryName(event.repository) !== EXPECTED_REPOSITORY ||
      repositoryId(event.repository) !== manifest.repository_id ||
      manifest.repository !== EXPECTED_REPOSITORY ||
      manifest.base_branch !== EXPECTED_BASE_BRANCH) {
    throw new Error("ARC_SANDBOX_CI_INVALID: repository binding");
  }
  if (eventName === "pull_request") {
    if (!["opened", "reopened", "synchronize"].includes(event.action) ||
        !Number.isSafeInteger(event.number) || event.number < 1 ||
        event.pull_request?.base?.ref !== EXPECTED_BASE_BRANCH ||
        repositoryName(event.pull_request?.base?.repo) !== EXPECTED_REPOSITORY ||
        repositoryId(event.pull_request?.base?.repo) !== manifest.repository_id ||
        repositoryName(event.pull_request?.head?.repo) !== EXPECTED_REPOSITORY ||
        repositoryId(event.pull_request?.head?.repo) !== manifest.repository_id ||
        env.GITHUB_BASE_REF !== EXPECTED_BASE_BRANCH ||
        env.GITHUB_HEAD_REF !== event.pull_request?.head?.ref ||
        !REVISION_BRANCH.test(String(event.pull_request?.head?.ref || ""))) {
      throw new Error("ARC_SANDBOX_CI_INVALID: pull request source/base/head binding");
    }
    const baseSha = assertSha(event.pull_request.base.sha, "pull request base SHA");
    const headSha = assertSha(event.pull_request.head.sha, "pull request head SHA");
    if (baseSha === headSha) {
      throw new Error("ARC_SANDBOX_CI_INVALID: empty pull request");
    }
    return Object.freeze({ eventName, baseSha, headSha,
      headBranch: event.pull_request.head.ref });
  }
  if (eventName === "push") {
    const after = assertSha(event.after, "push after SHA");
    const before = assertSha(event.before, "push before SHA", { zeroAllowed: true });
    if (event.deleted === true || event.ref !== `refs/heads/${EXPECTED_BASE_BRANCH}` ||
        env.GITHUB_REF !== event.ref || env.GITHUB_SHA !== after) {
      throw new Error("ARC_SANDBOX_CI_INVALID: push source/base/head binding");
    }
    return Object.freeze({ eventName, baseSha: before, headSha: after, headBranch: null,
      bootstrap: before === manifest.bootstrap_source_sha });
  }
  throw new Error("ARC_SANDBOX_CI_INVALID: unsupported event");
}

function defaultGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1_000_000,
  }).trim();
}

export function validateCheckedOutGitState({ context, manifest, root = PROJECT_ROOT,
  git = defaultGit }) {
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== context.headSha) {
    throw new Error("ARC_SANDBOX_CI_INVALID: checked-out head SHA");
  }
  git(root, ["cat-file", "-e", `${context.headSha}^{commit}`]);
  if (context.eventName === "pull_request") {
    git(root, ["cat-file", "-e", `${context.baseSha}^{commit}`]);
    const parents = git(root, ["show", "-s", "--format=%P", context.headSha])
      .split(/\s+/).filter(Boolean);
    if (canonicalJson(parents) !== canonicalJson([context.baseSha])) {
      throw new Error("ARC_SANDBOX_CI_INVALID: revision must have the exact source parent");
    }
    const count = git(root, ["rev-list", "--count", `${context.baseSha}..${context.headSha}`]);
    if (count !== "1") {
      throw new Error("ARC_SANDBOX_CI_INVALID: revision must contain exactly one commit");
    }
    const changes = git(root, ["diff", "--name-status", "--no-renames",
      context.baseSha, context.headSha]).split("\n").filter(Boolean).map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 2) {
        throw new Error("ARC_SANDBOX_CI_INVALID: malformed changed path");
      }
      return { status: fields[0], path: fields[1] };
    });
    const allowed = new Set(manifest.revision.repository_page_paths);
    if (manifest.revision.repository_page_paths.length !== 5 || changes.length < 1 ||
        changes.length > manifest.revision.repository_page_paths.length ||
        changes.some((change) => change.status !== "M" || !allowed.has(change.path)) ||
        new Set(changes.map((change) => change.path)).size !== changes.length ||
        canonicalJson(changes.map((change) => change.path)) !==
          canonicalJson([...changes.map((change) => change.path)].sort())) {
      throw new Error("ARC_SANDBOX_CI_INVALID: revision changed paths escaped the five-page authority");
    }
  } else {
    git(root, ["cat-file", "-e", `${context.baseSha}^{commit}`]);
    const parents = git(root, ["show", "-s", "--format=%P", context.headSha])
      .split(/\s+/).filter(Boolean);
    if (canonicalJson(parents) !== canonicalJson([context.baseSha]) ||
        git(root, ["rev-list", "--count", `${context.baseSha}..${context.headSha}`]) !== "1") {
      throw new Error("ARC_SANDBOX_CI_INVALID: main push must be one commit from the exact prior head");
    }
    const changes = git(root, ["diff", "--name-status", "--no-renames",
      context.baseSha, context.headSha]).split("\n").filter(Boolean).map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 2) {
        throw new Error("ARC_SANDBOX_CI_INVALID: malformed main changed path");
      }
      return { status: fields[0], path: fields[1] };
    });
    if (context.bootstrap) {
      const expected = PUBLIC_SOURCE_FILES.map((entry) => ({
        status: entry === "index.html" ? "M" : "A",
        path: entry,
      }));
      if (canonicalJson(changes) !== canonicalJson(expected)) {
        throw new Error("ARC_SANDBOX_CI_INVALID: bootstrap tree is not the exact public seed");
      }
    } else {
      const allowed = new Set(manifest.revision.repository_page_paths);
      if (changes.length < 1 || changes.length > allowed.size ||
          changes.some((change) => change.status !== "M" || !allowed.has(change.path)) ||
          new Set(changes.map((change) => change.path)).size !== changes.length ||
          canonicalJson(changes.map((change) => change.path)) !==
            canonicalJson([...changes.map((change) => change.path)].sort())) {
        throw new Error("ARC_SANDBOX_CI_INVALID: main push escaped the five-page authority");
      }
    }
  }
  return Object.freeze({ headSha: head });
}

export async function verifyGitHubEvent({ root = PROJECT_ROOT, manifestRoot = PROJECT_ROOT,
  env = process.env, eventPayload, git = defaultGit } = {}) {
  const manifest = (await loadManifest(manifestRoot)).value;
  let event = eventPayload;
  if (event === undefined) {
    const eventPath = env.GITHUB_EVENT_PATH;
    if (typeof eventPath !== "string" || !path.isAbsolute(eventPath)) {
      throw new Error("ARC_SANDBOX_CI_INVALID: GITHUB_EVENT_PATH");
    }
    const metadata = await lstat(eventPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 ||
        metadata.size > 1_000_000) {
      throw new Error("ARC_SANDBOX_CI_INVALID: event payload file");
    }
    const bytes = await readFile(await realpath(eventPath));
    try { event = JSON.parse(bytes.toString("utf8")); } catch {
      throw new Error("ARC_SANDBOX_CI_INVALID: event payload JSON");
    }
  }
  const context = validateEventPayload({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    env,
    manifest,
  });
  validateCheckedOutGitState({ context, manifest, root, git });
  return context;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/verify-event.mjs");
  const root = process.env.ARC_CANDIDATE_ROOT
    ? path.resolve(process.env.ARC_CANDIDATE_ROOT) : PROJECT_ROOT;
  const manifestRoot = process.env.ARC_TRUSTED_CONTRACT_ROOT
    ? path.resolve(process.env.ARC_TRUSTED_CONTRACT_ROOT) : PROJECT_ROOT;
  const context = await verifyGitHubEvent({ root, manifestRoot });
  process.stdout.write(
    `ARC sandbox CI context passed: ${context.eventName} ${context.headSha}.\n`
  );
}
