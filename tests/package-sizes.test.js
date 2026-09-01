import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { test } from "node:test";
import { build } from "esbuild";

const exec = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const entries = {
  surface: {
    source: 'export * from "./src/detect/surface.js";',
    budget: { bytes: 200, gzipBytes: 180, brotliBytes: 160 },
  },
  detect: {
    source: 'export * from "./src/detect.js";',
    budget: { bytes: 1100, gzipBytes: 500, brotliBytes: 450 },
  },
  core: {
    source: 'export { installReferenceTarget } from "./src/core.js";',
    budget: { bytes: 17000, gzipBytes: 5900, brotliBytes: 5400 },
  },
  labels: {
    source: 'import { installReferenceTarget } from "./src/core.js"; import { labels } from "./src/adapters/labels.js"; export { installReferenceTarget }; export const adapters = [labels({ activation: "focus", naming: true })];',
    budget: { bytes: 22000, gzipBytes: 7700, brotliBytes: 6700 },
  },
  "popover-targets": {
    source: 'import { installReferenceTarget } from "./src/core.js"; import { popoverTargets } from "./src/adapters/popover-targets.js"; export { installReferenceTarget }; export const adapters = [popoverTargets()];',
    budget: { bytes: 20000, gzipBytes: 7000, brotliBytes: 6100 },
  },
  "dialog-commands": {
    source: 'import { installReferenceTarget } from "./src/core.js"; import { dialogCommands } from "./src/adapters/dialog-commands.js"; export { installReferenceTarget }; export const adapters = [dialogCommands()];',
    budget: { bytes: 20500, gzipBytes: 7150, brotliBytes: 6500 },
  },
  "popover-commands": {
    source: 'import { installReferenceTarget } from "./src/core.js"; import { popoverCommands } from "./src/adapters/popover-commands.js"; export { installReferenceTarget }; export const adapters = [popoverCommands()];',
    budget: { bytes: 20500, gzipBytes: 7100, brotliBytes: 6450 },
  },
  "text-names": {
    source: 'import { installReferenceTarget } from "./src/core.js"; import { textNames } from "./src/adapters/text-names.js"; export { installReferenceTarget }; export const adapters = [textNames({ getText() { return null; } })];',
    budget: { bytes: 23000, gzipBytes: 8000, brotliBytes: 7300 },
  },
  "form-targets": {
    source: 'import { installReferenceTarget } from "./src/core.js"; import { formTargets } from "./src/adapters/form-targets.js"; export { installReferenceTarget }; export const adapters = [formTargets()];',
    budget: { bytes: 20500, gzipBytes: 7100, brotliBytes: 6450 },
  },
  "all-public-apis": {
    source: [
      'export * from "./src/core.js";',
      'export * from "./src/detect.js";',
      'export * from "./src/adapters/labels.js";',
      'export * from "./src/adapters/popover-targets.js";',
      'export * from "./src/adapters/dialog-commands.js";',
      'export * from "./src/adapters/popover-commands.js";',
      'export * from "./src/adapters/text-names.js";',
      'export * from "./src/adapters/form-targets.js";',
    ].join("\n"),
    budget: { bytes: 36000, gzipBytes: 11750, brotliBytes: 10700 },
  },
};

async function bundle(source, name) {
  const result = await build({
    absWorkingDir: projectRoot,
    stdin: { contents: source, resolveDir: projectRoot, sourcefile: `${name}.size-entry.js` },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    metafile: true,
    write: false,
  });
  const javascript = result.outputFiles;
  assert.equal(javascript.length, 1, `${name} stays within one JavaScript request when bundled`);
  const body = javascript[0].contents;
  return {
    bytes: body.byteLength,
    gzipBytes: gzipSync(body, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(body, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

test("public runtime compositions stay within explicit minified, gzip, Brotli, and request budgets", async t => {
  const measurements = {};
  for (const [name, { source, budget }] of Object.entries(entries)) {
    const measured = await bundle(source, name);
    measurements[name] = measured;
  }
  t.diagnostic(JSON.stringify(measurements));
  const violations = [];
  for (const [name, measured] of Object.entries(measurements)) {
    for (const metric of ["bytes", "gzipBytes", "brotliBytes"]) {
      const limit = entries[name].budget[metric];
      if (measured[metric] > limit) {
        violations.push(`${name} ${metric} grew to ${measured[metric]} bytes; budget is ${limit} bytes`);
      }
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("the dry-run package archive stays bounded and contains every exported runtime module", async t => {
  const directory = await mkdtemp(join(tmpdir(), "reference-target-pack-budget-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await exec("npm", [
    "pack", "--dry-run", "--json", "--cache", join(directory, "cache"),
  ], { cwd: projectRoot, encoding: "utf8", maxBuffer: 2_000_000 });
  const [archive] = JSON.parse(stdout);
  assert.ok(archive.size <= 45000, `packed archive grew to ${archive.size} bytes; budget is 45000 bytes`);
  assert.ok(archive.unpackedSize <= 155000,
    `unpacked archive grew to ${archive.unpackedSize} bytes; budget is 155000 bytes`);
  const manifest = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const files = new Set(archive.files.map(file => file.path));
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    const targets = typeof conditions === "string"
      ? [conditions]
      : [conditions.types, conditions.default].filter(Boolean);
    for (const target of targets) {
      assert.ok(files.has(target.replace(/^\.\//, "")), `${subpath} contains exported file ${target}`);
    }
  }
  const runtimeRequests = archive.files.filter(file => file.path.startsWith("src/") && file.path.endsWith(".js"));
  assert.ok(runtimeRequests.length <= 12,
    `raw self-hosting now needs ${runtimeRequests.length} runtime module requests; budget is 12`);
  t.diagnostic(JSON.stringify({
    packedBytes: archive.size,
    unpackedBytes: archive.unpackedSize,
    files: archive.entryCount,
    rawRuntimeRequests: runtimeRequests.length,
  }));
});
