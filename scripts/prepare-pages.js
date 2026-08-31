import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicationRef = "refs/heads/gh-pages";

export async function preparePages({ projectRoot = defaultRoot, message = "Publish demos and polyfill documentation" } = {}) {
  const root = await realpath(projectRoot);
  const git = async (args, options = {}) => {
    try {
      const { stdout } = await exec("git", args, { cwd: root, encoding: "utf8", ...options });
      return stdout.trim();
    } catch (error) {
      throw new Error(error.stderr?.trim() || error.message, { cause: error });
    }
  };
  if (await realpath(await git(["rev-parse", "--show-toplevel"])) !== root) {
    throw new Error("Run Pages preparation from this project's Git repository, not a parent repository.");
  }
  const siteDirectory = join(root, "dist/site");
  for (const required of ["index.html", ".nojekyll", "examples/index.html", "src/core.js"]) {
    try {
      await stat(join(siteDirectory, required));
    } catch (error) {
      throw new Error("Build the Pages site first with npm run build:pages.", { cause: error });
    }
  }
  const assertBranchAvailable = async () => {
    const worktrees = await git(["worktree", "list", "--porcelain"]);
    if (worktrees.split("\n").includes(`branch ${publicationRef}`)) {
      throw new Error("gh-pages is checked out in a worktree. Switch that worktree to another branch before preparing Pages.");
    }
  };
  await assertBranchAvailable();
  const findRef = async ref => {
    try {
      return await git(["rev-parse", "--verify", "--quiet", ref]);
    } catch (error) {
      if (error.cause?.code === 1) return null;
      throw error;
    }
  };
  const previous = await findRef(publicationRef);
  // A fresh clone may have only the remote-tracking branch. Keep that history.
  const parent = previous ?? await findRef("refs/remotes/origin/gh-pages");
  const gitDirectory = await git(["rev-parse", "--absolute-git-dir"]);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "reference-target-pages-"));
  try {
    const options = { env: { ...process.env, GIT_INDEX_FILE: join(temporaryDirectory, "index") } };
    const publicationGit = args => git(["--git-dir", gitDirectory, "--work-tree", siteDirectory, ...args], options);
    // Only the temporary index and generated site are involved; the source
    // checkout, its index, and any uncommitted work are never changed.
    await publicationGit(["read-tree", "--empty"]);
    await publicationGit(["-c", "core.autocrlf=false", "add", "--all", "--force", "--", "."]);
    const tree = await publicationGit(["write-tree"]);
    const previousTree = parent && await git(["rev-parse", `${parent}^{tree}`]);
    const changed = tree !== previousTree;
    const commit = changed
      ? await git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message])
      : parent;
    if (commit !== previous) {
      await assertBranchAvailable();
      // Compare-and-swap refuses to overwrite a branch moved by another process.
      await git(["update-ref", "-m", message, publicationRef, commit, previous ?? ""]);
    }
    console.log(changed
      ? `Prepared gh-pages at ${commit.slice(0, 12)}. Publish with: git push origin gh-pages`
      : `gh-pages already matches dist/site (${commit.slice(0, 12)}).`);
    return { branch: "gh-pages", commit, changed };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await preparePages();
  } catch (error) {
    console.error(`Could not prepare gh-pages: ${error.message}`);
    process.exitCode = 1;
  }
}
