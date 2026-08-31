import { build } from "esbuild";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { pages, renderers } from "../examples/pages.js";
import { buildStencilExamples } from "./build-stencil.js";
import { analyzePageBundles, renderBundleSummary, renderCapabilitySizes } from "./bundle-sizes.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputsRoot = join(projectRoot, "dist/examples");
await buildStencilExamples();
await rm(outputsRoot, { recursive: true, force: true });
await mkdir(outputsRoot, { recursive: true });

const reports = [];
const metafile = { inputs: {}, outputs: {} };
// Each page gets its own build: no dependency on another demo's adapter bundle.
for (const page of pages) {
  const source = join(projectRoot, "examples", page.directory);
  const destination = join(outputsRoot, page.directory);
  await mkdir(destination, { recursive: true });
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: [join(source, "main.js")], outdir: destination,
    bundle: true, splitting: true, format: "esm", platform: "browser",
    target: "es2022", minify: true, sourcemap: true, metafile: true,
    loader: { ".css": "text" },
  });
  const report = await analyzePageBundles({ page, metafile: result.metafile, outputsRoot, projectRoot });
  reports.push(report);
  for (const file of report.files) {
    const pathname = join(outputsRoot, file.path);
    const gzip = gzipSync(await readFile(pathname));
    if (gzip.length !== file.gzipBytes) throw new Error(`Gzip size changed while building ${file.path}`);
    await writeFile(`${pathname}.gz`, gzip);
  }
  for (const file of await readdir(source, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".css")) {
      await copyFile(join(source, file.name), join(destination, file.name));
    }
  }
  Object.assign(metafile.inputs, result.metafile.inputs);
  Object.assign(metafile.outputs, result.metafile.outputs);
}

await mkdir(join(outputsRoot, "shared"), { recursive: true });
for (const filename of ["styles.css", "components.css", "code-highlighting.js"]) {
  await copyFile(join(projectRoot, "examples/shared", filename), join(outputsRoot, "shared", filename));
}

// Highlighting is an independent demo asset, excluded from the measured page builds.
const microlighterRoot = dirname(fileURLToPath(import.meta.resolve("microlighter")));
const { createGrammarLoader } = await import(pathToFileURL(join(microlighterRoot, "grammar-dependencies.js")).href);
const loadGrammars = createGrammarLoader(async language => {
  const grammar = await import(pathToFileURL(join(microlighterRoot, "grammars", `${language}.js`)).href);
  return grammar.default;
});
const { languages } = await loadGrammars(["html", "javascript", "css", "json", "tsx"]);
const microlighterDestination = join(outputsRoot, "shared/microlighter");
for (const filename of [
  "index.js", "highlight.js", "grammar-dependencies.js", "themes/github.css",
  ...Object.keys(languages).map(language => `grammars/${language}.js`),
]) {
  const destination = join(microlighterDestination, filename);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(microlighterRoot, filename), destination);
}
await copyFile(join(microlighterRoot, "../LICENSE"), join(microlighterDestination, "LICENSE"));

const escapeHTML = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

for (const page of pages) {
  const report = reports.find(item => item.id === page.id);
  const prefix = page.directory ? "../".repeat(page.directory.split("/").length) : "./";
  const assets = `${prefix}shared`;
  let html = await readFile(join(projectRoot, "examples", page.directory, "index.html"), "utf8");
  const markers = [...html.matchAll(/<!-- demo:([a-z-]+) -->/g)];
  for (const feature of page.features) {
    if (markers.filter(([, id]) => id === feature).length !== 1) {
      throw new Error(`Expected exactly one ${feature} demo marker in ${page.id}`);
    }
  }
  for (const [marker, feature] of markers) {
    if (!page.features.includes(feature)) throw new Error(`Unexpected demo ${feature} in ${page.id}`);
    const fragment = await readFile(join(projectRoot, "examples/shared/demos", `${feature}.html`), "utf8");
    html = html.replaceAll(marker, () => fragment);
  }
  html = html.replaceAll("{{assets}}", assets);
  if (page.renderer) {
    html = html.replaceAll("{{renderer-id}}", page.renderer.id)
      .replaceAll("{{renderer-name}}", escapeHTML(page.renderer.title))
      .replaceAll("{{renderer-url}}", page.renderer.url);
    const samples = [];
    for (const filename of page.renderer.sources) {
      const source = await readFile(join(projectRoot, "examples", page.directory, filename), "utf8");
      const language = filename.endsWith(".tsx") ? "tsx" : "javascript";
      samples.push(`<h3>${escapeHTML(filename)}</h3><pre><code class="language-${language}" data-code-sample>${escapeHTML(source)}</code></pre>`);
    }
    html = html.replace("<!-- renderer-source -->", () => `<details class="reading-notes"><summary>Component source</summary>${samples.join("\n")}</details>`);
  }
  html = html.replace("<!-- renderer-links -->", () => `<section class="metrics-panel" id="renderers" aria-labelledby="renderers-title">
    <h2 id="renderers-title">Rendered by a library</h2>
    <p>Try the same label, checkbox replacement, and popover examples in four independent pages.</p>
    <nav class="jump-links" aria-label="Renderer examples">${renderers.map(renderer => `<a href="${prefix}${renderer.id}/">${escapeHTML(renderer.title)}</a>`).join(" ")}</nav>
  </section>`);
  const summary = renderBundleSummary(report, { prefix });
  if (html.includes("<!-- bundle-summary -->")) {
    html = html.replace("<!-- bundle-summary -->", () => summary);
  } else {
    // Keep the older scenario page useful without maintaining duplicate metrics markup.
    if (!html.includes("</main>")) throw new Error(`${page.id} has no insertion point for its size report`);
    html = html.replace("</main>", () => `${summary}\n</main>`);
    html = html.replace("<head>", `<head>\n<link rel="stylesheet" href="${assets}/styles.css">`);
  }
  html = html.replace("<!-- capability-sizes -->", () => renderCapabilitySizes(reports, { prefix }));
  html = html.replace("</head>", () => `<link rel="stylesheet" href="${assets}/microlighter/themes/github.css">\n</head>`);
  html = html.replace("</body>", () => `<script type="module" src="${assets}/code-highlighting.js"></script>\n</body>`);
  await writeFile(join(outputsRoot, page.directory, "index.html"), html);
}

await writeFile(join(outputsRoot, "bundle-sizes.json"), JSON.stringify({
  version: 1, unit: "KB", bytesPerKB: 1000, pages: reports,
}, null, 2) + "\n");
await writeFile(join(projectRoot, "dist/metafile.json"), JSON.stringify(metafile, null, 2) + "\n");
for (const report of reports) {
  console.log(`${report.title}: ${(report.baseline.bytes / 1000).toFixed(3)} KB page JS + ${(report.fallback.bytes / 1000).toFixed(3)} KB fallback = ${(report.total.bytes / 1000).toFixed(3)} KB total (${(report.total.gzipBytes / 1000).toFixed(3)} KB gzip)`);
}
