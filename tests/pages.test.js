import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { verifySiteLinks } from "../scripts/build-pages.js";
import { preparePages } from "../scripts/prepare-pages.js";

const exec = promisify(execFile);

test("Pages links work beneath a repository prefix and missing assets fail the build", async t => {
  const directory = await mkdtemp(join(tmpdir(), "reference-target-pages-links-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "examples/labels"), { recursive: true });
  await writeFile(join(directory, "index.html"), '<a href="./examples/labels/?mode=fallback#demo">Labels</a>');
  await writeFile(join(directory, "examples/labels/index.html"), '<a href="../../">Docs</a><script src="./main.js"></script>');
  await writeFile(join(directory, "examples/labels/main.js"), "export {};");
  assert.equal(await verifySiteLinks(directory), 3);
  await writeFile(join(directory, "index.html"), '<a href="/examples/labels/">Labels</a>');
  await assert.rejects(verifySiteLinks(directory), /use a relative URL/);
  await writeFile(join(directory, "index.html"), '<a href="../outside.html">Outside</a>');
  await assert.rejects(verifySiteLinks(directory), /escapes the project site/);
  await writeFile(join(directory, "index.html"), '<script src="./missing.js"></script>');
  await assert.rejects(verifySiteLinks(directory), /missing local link or asset/);
});

test("Pages preparation preserves source work and branch history, and refuses a checked-out branch", async t => {
  const directory = await mkdtemp(join(tmpdir(), "reference-target-pages-git-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "repository");
  await mkdir(root);
  const git = async (...args) => (await exec("git", args, { cwd: root, encoding: "utf8" })).stdout.trim();
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Pages build test");
  await git("config", "user.email", "pages-test@example.invalid");
  await writeFile(join(root, "source.txt"), "original source\n");
  await git("add", "source.txt");
  await git("commit", "-m", "Initial source");
  await writeFile(join(root, "source.txt"), "staged source work\n");
  await git("add", "source.txt");
  await writeFile(join(root, "source.txt"), "unstaged source work\n");
  const sourceHead = await git("rev-parse", "HEAD");
  const sourceIndex = await git("write-tree");
  const site = join(root, "dist/site");
  await mkdir(join(site, "examples"), { recursive: true });
  await mkdir(join(site, "src"), { recursive: true });
  for (const [file, body] of Object.entries({
    "index.html": "<h1>Consumption documentation</h1>",
    "examples/index.html": "<h1>Demos</h1>",
    "src/core.js": "export {};",
    ".nojekyll": "",
    "old.js": "// removed in the next publication\n",
  })) await writeFile(join(site, file), body);
  const first = await preparePages({ projectRoot: root });
  assert.equal(first.changed, true);
  assert.equal(await git("rev-parse", "HEAD"), sourceHead);
  assert.equal(await git("branch", "--show-current"), "main");
  assert.equal(await git("write-tree"), sourceIndex);
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "unstaged source work\n");
  assert.equal((await git("rev-list", "--parents", "-n", "1", "gh-pages")).split(" ").length, 1, "first publication has no source-history parent");
  assert.equal(await git("show", "gh-pages:index.html"), "<h1>Consumption documentation</h1>");
  await assert.rejects(git("show", "gh-pages:source.txt"), "source checkout is not published");

  const unchanged = await preparePages({ projectRoot: root });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.commit, first.commit);
  await rm(join(site, "old.js"));
  await writeFile(join(site, "index.html"), "<h1>Updated documentation</h1>");
  const second = await preparePages({ projectRoot: root });
  assert.equal(second.changed, true);
  assert.equal(await git("rev-parse", "gh-pages^"), first.commit);
  await assert.rejects(git("show", "gh-pages:old.js"), "obsolete generated files are removed");
  assert.equal(await git("write-tree"), sourceIndex);

  await git("worktree", "add", join(directory, "publication"), "gh-pages");
  await writeFile(join(site, "index.html"), "<h1>Must not overwrite the attached branch</h1>");
  await assert.rejects(preparePages({ projectRoot: root }), /gh-pages is checked out in a worktree/);
  assert.equal(await git("rev-parse", "gh-pages"), second.commit);
});
