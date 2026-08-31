import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_BASE_BRANCH,
  EXPECTED_BOOTSTRAP_SOURCE_SHA,
  EXPECTED_HEAD_PREFIX,
  EXPECTED_REPOSITORY,
  PUBLIC_SOURCE_FILES,
  loadManifest,
} from "../scripts/preview-contract.mjs";
import {
  validateCheckedOutGitState,
  validateEventPayload,
} from "../scripts/verify-event.mjs";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const operation = "a".repeat(64);
const headBranch = `${EXPECTED_HEAD_PREFIX}${operation}`;
const manifest = (await loadManifest()).value;
const repository = () => ({ full_name: EXPECTED_REPOSITORY, id: manifest.repository_id });

function pullRequestEvent() {
  return {
    action: "synchronize",
    number: 17,
    repository: repository(),
    pull_request: {
      base: { ref: EXPECTED_BASE_BRANCH, sha: baseSha, repo: repository() },
      head: { ref: headBranch, sha: headSha, repo: repository() },
    },
  };
}

function pullRequestEnv() {
  return {
    GITHUB_REPOSITORY: EXPECTED_REPOSITORY,
    GITHUB_BASE_REF: EXPECTED_BASE_BRANCH,
    GITHUB_HEAD_REF: headBranch,
  };
}

function exactGit(overrides = {}) {
  return (_root, args) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return headSha;
    if (args[0] === "cat-file") return "";
    if (command === `show -s --format=%P ${headSha}`) return baseSha;
    if (command === `rev-list --count ${baseSha}..${headSha}`) return "1";
    if (args[0] === "diff") {
      return manifest.revision.repository_page_paths.map((entry) => `M\t${entry}`).join("\n");
    }
    throw new Error(`unexpected git call: ${command}`);
  };
}

test("pull request CI binds numeric repository, source, base, head, and all five paths", () => {
  const context = validateEventPayload({
    eventName: "pull_request",
    event: pullRequestEvent(),
    env: pullRequestEnv(),
    manifest,
  });
  assert.deepEqual(context, {
    eventName: "pull_request", baseSha, headSha, headBranch,
  });
  assert.deepEqual(validateCheckedOutGitState({ context, manifest, git: exactGit() }),
    { headSha });
});

test("cross-repository and wrong-ID pull requests fail closed", () => {
  const crossRepository = pullRequestEvent();
  crossRepository.pull_request.head.repo.full_name = "someone/fork";
  assert.throws(() => validateEventPayload({
    eventName: "pull_request", event: crossRepository,
    env: pullRequestEnv(), manifest,
  }), /source\/base\/head binding/);

  const wrongId = pullRequestEvent();
  wrongId.repository.id += 1;
  assert.throws(() => validateEventPayload({
    eventName: "pull_request", event: wrongId,
    env: pullRequestEnv(), manifest,
  }), /repository binding/);
});

test("non-provider branch names fail closed", () => {
  const wrongBranch = pullRequestEvent();
  wrongBranch.pull_request.head.ref = "feature/manual";
  assert.throws(() => validateEventPayload({
    eventName: "pull_request", event: wrongBranch,
    env: { ...pullRequestEnv(), GITHUB_HEAD_REF: "feature/manual" }, manifest,
  }), /source\/base\/head binding/);

});

test("one changed bound page is accepted while all five remain manifest-bound", () => {
  const context = validateEventPayload({
    eventName: "pull_request", event: pullRequestEvent(),
    env: pullRequestEnv(), manifest,
  });
  assert.equal(manifest.revision.repository_page_paths.length, 5);
  const onePageGit = (_root, args) => {
    if (args[0] === "diff") {
      return `M\t${manifest.revision.repository_page_paths[0]}`;
    }
    return exactGit()(_root, args);
  };
  assert.deepEqual(validateCheckedOutGitState({ context, manifest, git: onePageGit }),
    { headSha });
});

test("zero changed pages and extra paths fail closed", () => {
  const context = validateEventPayload({
    eventName: "pull_request", event: pullRequestEvent(),
    env: pullRequestEnv(), manifest,
  });
  const zeroGit = (_root, args) => args[0] === "diff" ? "" : exactGit()(_root, args);
  assert.throws(() => validateCheckedOutGitState({ context, manifest, git: zeroGit }),
    /escaped the five-page authority/);

  const extraGit = (_root, args) => args[0] === "diff"
    ? `M\t${manifest.revision.repository_page_paths[0]}\nM\tscripts/extra.mjs`
    : exactGit()(_root, args);
  assert.throws(() => validateCheckedOutGitState({ context, manifest, git: extraGit }),
    /escaped the five-page authority/);
});

test("main pushes bind the exact checked-out after SHA", () => {
  const event = {
    ref: `refs/heads/${EXPECTED_BASE_BRANCH}`,
    before: baseSha,
    after: headSha,
    deleted: false,
    repository: repository(),
  };
  const env = {
    GITHUB_REPOSITORY: EXPECTED_REPOSITORY,
    GITHUB_REF: event.ref,
    GITHUB_SHA: headSha,
  };
  const context = validateEventPayload({ eventName: "push", event, env, manifest });
  assert.deepEqual(context, {
    eventName: "push", baseSha, headSha, headBranch: null, bootstrap: false,
  });
  const pushGit = (_root, args) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return headSha;
    if (args[0] === "cat-file") return "";
    if (command === `show -s --format=%P ${headSha}`) return baseSha;
    if (command === `rev-list --count ${baseSha}..${headSha}`) return "1";
    if (args[0] === "diff") return `M\t${manifest.revision.repository_page_paths[0]}`;
    throw new Error(`unexpected git call: ${command}`);
  };
  assert.deepEqual(validateCheckedOutGitState({ context, manifest, git: pushGit }),
  { headSha });
});

test("main pushes reject wrong parents and non-page paths", () => {
  const event = {
    ref: `refs/heads/${EXPECTED_BASE_BRANCH}`,
    before: baseSha,
    after: headSha,
    deleted: false,
    repository: repository(),
  };
  const context = validateEventPayload({
    eventName: "push", event,
    env: { GITHUB_REPOSITORY: EXPECTED_REPOSITORY, GITHUB_REF: event.ref,
      GITHUB_SHA: headSha }, manifest,
  });
  const wrongParentGit = (_root, args) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return headSha;
    if (args[0] === "cat-file") return "";
    if (args[0] === "show") return "3".repeat(40);
    if (args[0] === "rev-list") return "1";
    throw new Error(`unexpected git call: ${command}`);
  };
  assert.throws(() => validateCheckedOutGitState({
    context, manifest, git: wrongParentGit,
  }), /one commit from the exact prior head/);

  const extraPathGit = (_root, args) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return headSha;
    if (args[0] === "cat-file") return "";
    if (args[0] === "show") return baseSha;
    if (args[0] === "rev-list") return "1";
    if (args[0] === "diff") return "M\tscripts/verify-event.mjs";
    throw new Error(`unexpected git call: ${command}`);
  };
  assert.throws(() => validateCheckedOutGitState({
    context, manifest, git: extraPathGit,
  }), /main push escaped the five-page authority/);
});

test("the one-time bootstrap binds the exact prior placeholder and full seed tree", () => {
  const bootstrapHead = "3".repeat(40);
  const event = {
    ref: `refs/heads/${EXPECTED_BASE_BRANCH}`,
    before: EXPECTED_BOOTSTRAP_SOURCE_SHA,
    after: bootstrapHead,
    deleted: false,
    repository: repository(),
  };
  const context = validateEventPayload({
    eventName: "push", event,
    env: { GITHUB_REPOSITORY: EXPECTED_REPOSITORY, GITHUB_REF: event.ref,
      GITHUB_SHA: bootstrapHead }, manifest,
  });
  assert.equal(context.bootstrap, true);
  const bootstrapGit = (_root, args) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return bootstrapHead;
    if (args[0] === "cat-file") return "";
    if (args[0] === "show") return EXPECTED_BOOTSTRAP_SOURCE_SHA;
    if (args[0] === "rev-list") return "1";
    if (args[0] === "diff") return PUBLIC_SOURCE_FILES.map((entry) =>
      `${entry === "index.html" ? "M" : "A"}\t${entry}`).join("\n");
    throw new Error(`unexpected git call: ${command}`);
  };
  assert.deepEqual(validateCheckedOutGitState({
    context, manifest, git: bootstrapGit,
  }), { headSha: bootstrapHead });
});
