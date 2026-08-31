import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";
import { pages } from "../examples/pages.js";

test("published entry points import without a DOM or installation side effects", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "no runtime dependencies");
  for (const target of Object.values(manifest.exports)) {
    const module = await import(new URL(`../${target}`, import.meta.url));
    assert.ok(Object.keys(module).length > 0, `${target} exports an API`);
  }
});

test("label activation requires an explicit policy", async () => {
  const { labels } = await import("../src/adapters/labels.js");
  assert.throws(() => labels(), TypeError);
  assert.throws(() => labels({ activation: "toggle-everything" }), TypeError);
  assert.throws(() => labels({ activation: "focus", naming: "yes" }), TypeError);
});

test("browser requirements fail clearly outside a supported realm", async () => {
  const { installReferenceTarget } = await import("../src/core.js");
  assert.throws(() => installReferenceTarget(), /browser with Shadow DOM/);
});

async function assertExampleBundle(directory, selected) {
  const entryPoint = `${directory}/main.js`;
  const result = await build({
    entryPoints: [entryPoint], outdir: "dist/test-build",
    bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    minify: true, metafile: true, write: false,
  });
  const inputs = Object.keys(result.metafile.inputs);
  for (const adapter of ["labels", "text-names", "popover-targets", "dialog-commands", "popover-commands", "form-targets"]) {
    assert.equal(inputs.includes(`src/adapters/${adapter}.js`), selected.includes(adapter),
      `${directory}: ${adapter} should be ${selected.includes(adapter) ? "included" : "omitted"}`);
  }
  const outputs = new Map(Object.entries(result.metafile.outputs).map(([path, output]) => [resolve(path), output]));
  const entry = [...outputs].find(([, output]) => output.entryPoint === entryPoint)[0];
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const output = outputs.get(path);
    assert.ok(output, `output exists: ${path}`);
    for (const input of Object.keys(output.inputs)) {
      assert.ok(!input.startsWith("src/adapters/"), `adapter leaked into eager code: ${input}`);
      assert.notEqual(input, "src/core.js", "installer leaked into eager code");
    }
    for (const imported of output.imports) {
      if (!imported.external && imported.kind !== "dynamic-import") {
        const direct = resolve(imported.path);
        visit(outputs.has(direct) ? direct : resolve(dirname(path), imported.path));
      }
    }
  }
  visit(entry);
  // A native browser still imports app.js; it must not bring setup back in.
  const app = [...outputs].find(([, output]) => output.entryPoint === `${directory}/app.js`);
  assert.ok(app, "application remains a separate import after readiness");
  visit(app[0]);
  const setup = [...outputs.values()].find(output => output.entryPoint === `${directory}/reference-target.setup.js`);
  assert.ok(setup, "side-effectful setup remains a dynamic entry point");
  assert.ok(Object.keys(setup.inputs).includes("src/core.js"), "setup actually installs the shim");
}

for (const page of pages) {
  test(`${page.title}: adapter selection stays behind the readiness boundary`, async () => {
    await assertExampleBundle(`examples${page.directory ? `/${page.directory}` : ""}`, page.adapters);
  });
}
