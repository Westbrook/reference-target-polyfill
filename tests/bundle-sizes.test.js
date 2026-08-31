import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { analyzePageBundles, renderBundleSummary, renderCapabilitySizes } from "../scripts/bundle-sizes.js";

test("size reports count actual page/app delivery and fallback files without double-counting shared chunks", async t => {
  const projectRoot = await mkdtemp(join(tmpdir(), "reference-target-sizes-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const source = join(projectRoot, "examples", "labels");
  const outputsRoot = join(projectRoot, "dist/examples");
  await mkdir(source, { recursive: true });
  for (const [filename, contents] of Object.entries({
    "main.js": 'import { shared } from "./shared.js"; window.entryValue = shared; if (!window.nativeSupport) await import("./reference-target.setup.js"); await import("./app.js");',
    "app.js": 'import { shared } from "./shared.js"; window.appValue = shared.repeat(2);',
    "reference-target.setup.js": 'import { shared } from "./shared.js"; window.fallbackValue = shared.repeat(3);',
    "shared.js": 'export const shared = "reference-target-size-fixture-🍊";',
  })) await writeFile(join(source, filename), contents);
  const result = await build({
    absWorkingDir: projectRoot, entryPoints: [join(source, "main.js")],
    outdir: join(outputsRoot, "labels"), bundle: true, splitting: true, format: "esm",
    platform: "browser", target: "es2022", minify: true, charset: "utf8", sourcemap: true, metafile: true,
  });
  const page = { id: "labels", directory: "labels", title: "Labels", adapters: ["labels"] };
  const report = await analyzePageBundles({ page, metafile: result.metafile, outputsRoot, projectRoot });
  const emittedJS = Object.keys(result.metafile.outputs).filter(pathname => pathname.endsWith(".js"));
  const shared = emittedJS.find(pathname => pathname.includes("/chunk-"));
  assert.ok(shared, "fixture emits a shared chunk used by all three entry points");
  const sharedPath = relative(outputsRoot, resolve(projectRoot, shared));
  assert.equal(report.files.length, 4, "main, app, setup, and one shared chunk are counted");
  assert.equal(report.baseline.files.length, 3, "main, always-imported app, and shared chunk are baseline");
  assert.equal(report.fallback.files.length, 1, "setup is the only additional fallback file");
  assert.ok(report.baseline.files.includes(sharedPath));
  assert.ok(!report.fallback.files.includes(sharedPath));
  assert.equal(new Set(report.total.files).size, 4, "shared delivery appears only once");
  assert.ok(report.total.files.every(pathname => pathname.startsWith("labels/") && !pathname.endsWith(".map")));

  const bodies = [];
  let totalBytes = 0;
  let totalGzipBytes = 0;
  for (const file of report.files) {
    const body = await readFile(join(outputsRoot, file.path));
    bodies.push(body);
    assert.equal(file.bytes, body.byteLength, "minified byte count matches the emitted file");
    assert.equal(file.gzipBytes, gzipSync(body).byteLength, "gzip byte count matches a separately compressed file");
    totalBytes += body.byteLength;
    totalGzipBytes += gzipSync(body).byteLength;
  }
  assert.equal(report.total.bytes, totalBytes);
  assert.equal(report.total.gzipBytes, totalGzipBytes);
  assert.equal(report.baseline.bytes + report.fallback.bytes, totalBytes);
  assert.equal(report.baseline.gzipBytes + report.fallback.gzipBytes, totalGzipBytes);
  assert.notEqual(totalGzipBytes, gzipSync(Buffer.concat(bodies)).byteLength, "gzip totals are per request, not a compressed concatenation");

  const html = renderBundleSummary(report, { prefix: "../" });
  assert.match(html, /data-bundle-id="labels"/);
  assert.match(html, new RegExp(`data-size-kind="total" data-bytes="${totalBytes}" data-gzip-bytes="${totalGzipBytes}"`));
  assert.match(html, /1 KB = 1,000 bytes/);
  for (const file of report.files) assert.ok(html.includes(`href="../${file.path}"`), "file link resolves from a feature page");
  assert.ok(html.includes(`${(totalBytes / 1000).toFixed(3)} KB`));
  assert.ok(html.includes('href="../bundle-sizes.json"'));
});

test("the gallery size comparison links only independent single-adapter builds", () => {
  const metric = { bytes: 1500, gzipBytes: 750, files: [] };
  const individual = { id: "form-targets", directory: "forms", title: "Forms & submitters", adapters: ["form-targets"], baseline: metric, fallback: metric, total: { ...metric, bytes: 3000, gzipBytes: 1500 }, files: [] };
  const gallery = { ...individual, id: "all", directory: "", adapters: ["form-targets", "labels"] };
  const legacy = { ...individual, id: "scenarios", directory: "scenarios", adapters: ["labels", "text-names"] };
  const html = renderCapabilitySizes([gallery, individual, legacy]);
  assert.equal((html.match(/data-capability-size=/g) ?? []).length, 1);
  assert.match(html, /data-capability-size="form-targets"/);
  assert.match(html, /href="\.\/forms\/"/);
  assert.match(html, /Forms &amp; submitters/);
  assert.match(html, /3\.000 KB/);
  assert.match(html, /rows are not additive/);
});
