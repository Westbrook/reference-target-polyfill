import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { pages, renderers } from "../examples/pages.js";
import { buildStencilExamples } from "./build-stencil.js";
import { buildAngularExamples } from "./build-angular.js";
import { exampleBuildOptions } from "./example-build-options.js";
import { analyzePageBundles, renderBundleSummary, renderCapabilitySizes } from "./bundle-sizes.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputsRoot = join(projectRoot, "dist/examples");
const portable = pathname => pathname.split(sep).join("/");
await buildStencilExamples();
await buildAngularExamples();
await rm(outputsRoot, { recursive: true, force: true });
await mkdir(outputsRoot, { recursive: true });

const reports = [];
const metafile = { inputs: {}, outputs: {} };
const preloads = new Map();
// Each page still has an independent metafile/accounting boundary. Content-
// hashed chunks share one output directory so identical bytes can be cached
// across page navigation instead of being copied under every page directory.
for (const page of pages) {
  const source = join(projectRoot, "examples", page.directory);
  const destination = join(outputsRoot, page.directory);
  await mkdir(destination, { recursive: true });
  const result = await build({
    absWorkingDir: projectRoot, entryPoints: [join(source, "main.js")],
    outbase: join(projectRoot, "examples"), outdir: outputsRoot,
    entryNames: "[dir]/[name]", chunkNames: "shared/chunks/[name]-[hash]",
    bundle: true, splitting: true, format: "esm", platform: "browser",
    target: "es2022", minify: true, sourcemap: "external", sourcesContent: false,
    metafile: true,
    ...exampleBuildOptions(page),
  });
  const report = await analyzePageBundles({ page, metafile: result.metafile, outputsRoot, projectRoot });
  reports.push(report);
  const mainEntry = Object.entries(result.metafile.outputs).find(([, output]) =>
    output.entryPoint && resolve(projectRoot, output.entryPoint) === join(source, "main.js"));
  if (!mainEntry) throw new Error(`Missing main.js entry point for ${page.id}`);
  const mainPath = relative(outputsRoot, resolve(projectRoot, mainEntry[0])).split(sep).join("/");
  preloads.set(page.id, report.baseline.files.filter(pathname => pathname !== mainPath));
  for (const file of await readdir(source, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".css")) {
      const css = await transform(await readFile(join(source, file.name), "utf8"), {
        loader: "css", minify: true,
      });
      await writeFile(join(destination, file.name), css.code);
    }
  }
  Object.assign(metafile.inputs, result.metafile.inputs);
  Object.assign(metafile.outputs, result.metafile.outputs);
}

async function deduplicateFunctionalChunks() {
  const candidates = Object.keys(metafile.outputs).map(pathname => resolve(projectRoot, pathname))
    .filter(pathname => pathname.endsWith(".js") && portable(relative(outputsRoot, pathname)).startsWith("shared/chunks/"));
  const groups = new Map();
  for (const pathname of candidates) {
    const body = await readFile(pathname);
    const digest = createHash("sha256").update(body).digest("hex");
    const key = `${body.length}:${digest}`;
    const group = groups.get(key) ?? { body, digest, paths: [] };
    if (!group.body.equals(body)) throw new Error(`JavaScript content hash collision for ${pathname}`);
    group.paths.push(pathname);
    groups.set(key, group);
  }

  const replacements = new Map();
  for (const { body, digest, paths } of groups.values()) {
    if (paths.length < 2) continue;
    const first = [...paths].sort()[0];
    const stem = basename(first).replace(/-[A-Z0-9]{8}\.js$/, "");
    const canonical = join(dirname(first), `${stem}-${digest.slice(0, 8).toUpperCase()}.js`);
    if (canonical !== first) {
      await writeFile(canonical, body);
      await copyFile(`${first}.map`, `${canonical}.map`);
    }
    const canonicalPath = portable(relative(outputsRoot, canonical));
    for (const pathname of paths) replacements.set(portable(relative(outputsRoot, pathname)), canonicalPath);
  }
  if (!replacements.size) return;

  const names = [...replacements].filter(([from, to]) => from !== to)
    .map(([from, to]) => [basename(from), basename(to)]);
  const javascript = new Set([
    ...Object.keys(metafile.outputs).filter(pathname => pathname.endsWith(".js")).map(pathname => resolve(projectRoot, pathname)),
    ...[...replacements.values()].map(pathname => join(outputsRoot, pathname)),
  ]);
  for (const pathname of javascript) {
    let source = await readFile(pathname, "utf8");
    for (const [from, to] of names) source = source.replaceAll(from, to);
    await writeFile(pathname, source);
  }
  for (const [from, to] of replacements) {
    if (from === to) continue;
    await rm(join(outputsRoot, from), { force: true });
    await rm(`${join(outputsRoot, from)}.map`, { force: true });
  }
  for (const path of new Set(replacements.values())) {
    const expected = basename(path).match(/-([A-F0-9]{8})\.js$/)?.[1];
    const actual = createHash("sha256").update(await readFile(join(outputsRoot, path)))
      .digest("hex").slice(0, 8).toUpperCase();
    if (expected !== actual) throw new Error(`Deduplicated chunk is not content-addressed: ${path}`);
  }

  // Keep the aggregate diagnostic metafile aligned with the rewritten files.
  // A canonical output can represent several page-local dynamic entry points.
  function remapOutput(pathname) {
    const absolute = resolve(projectRoot, pathname);
    const path = portable(relative(outputsRoot, absolute));
    const sourceMap = path.endsWith(".js.map");
    const javascript = sourceMap ? path.slice(0, -4) : path;
    const mapped = replacements.get(javascript);
    return mapped ? portable(relative(projectRoot, join(outputsRoot, `${mapped}${sourceMap ? ".map" : ""}`))) : pathname;
  }
  const updatedOutputs = {};
  for (const [pathname, output] of Object.entries(metafile.outputs)) {
    const target = remapOutput(pathname);
    const next = {
      ...output,
      imports: output.imports?.map(imported => imported.external
        ? imported : { ...imported, path: remapOutput(imported.path) }),
    };
    const current = updatedOutputs[target];
    if (!current) {
      updatedOutputs[target] = next;
      continue;
    }
    const entryPoints = [...new Set([
      ...(current.entryPoints ?? []), current.entryPoint,
      ...(next.entryPoints ?? []), next.entryPoint,
    ].filter(Boolean))];
    updatedOutputs[target] = { ...current, ...next, entryPoints };
    delete updatedOutputs[target].entryPoint;
  }
  metafile.outputs = updatedOutputs;

  function metric(files) {
    return {
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
      files: files.map(file => file.path),
    };
  }
  for (const report of reports) {
    report.files = await Promise.all(report.files.map(async file => {
      const path = replacements.get(file.path) ?? file.path;
      const body = await readFile(join(outputsRoot, path));
      return { ...file, path, bytes: body.length, gzipBytes: gzipSync(body).length };
    }));
    report.files.sort((left, right) => left.path.localeCompare(right.path));
    report.baseline = metric(report.files.filter(file => file.delivery === "baseline"));
    report.fallback = metric(report.files.filter(file => file.delivery === "fallback" || file.delivery === "route-shared"));
    report.nativeProbe = metric(report.files.filter(file => file.delivery === "native-probe" || file.delivery === "route-shared"));
    report.total = metric(report.files.filter(file => file.delivery !== "native-probe"));
    report.nativeTotal = metric(report.files.filter(file => file.delivery !== "fallback"));
    preloads.set(report.id, preloads.get(report.id).map(pathname => replacements.get(pathname) ?? pathname));
  }
  metafile.deduplicatedOutputs = Object.fromEntries(replacements);
}

await deduplicateFunctionalChunks();

await mkdir(join(outputsRoot, "shared"), { recursive: true });
for (const filename of ["styles.css", "components.css"]) {
  const css = await transform(await readFile(join(projectRoot, "examples/shared", filename), "utf8"), {
    loader: "css", minify: true,
  });
  await writeFile(join(outputsRoot, "shared", filename), css.code);
}
const highlighterLoader = await transform(await readFile(join(projectRoot, "examples/shared/code-highlighting.js"), "utf8"), {
  loader: "js", minify: true, target: "es2022", legalComments: "none",
});
await writeFile(join(outputsRoot, "shared/code-highlighting.js"), highlighterLoader.code);
await copyFile(join(projectRoot, "examples/shared/favicon.svg"), join(outputsRoot, "shared/favicon.svg"));

// Highlighting is an independent demo asset, excluded from the measured page builds.
const microlighterRoot = dirname(fileURLToPath(import.meta.resolve("microlighter")));
const { createGrammarLoader } = await import(pathToFileURL(join(microlighterRoot, "grammar-dependencies.js")).href);
const loadGrammars = createGrammarLoader(async language => {
  const grammar = await import(pathToFileURL(join(microlighterRoot, "grammars", `${language}.js`)).href);
  return grammar.default;
});
const { languages } = await loadGrammars(["html", "javascript", "css", "json", "tsx", "svelte"]);
const microlighterDestination = join(outputsRoot, "shared/microlighter");
for (const filename of [
  "index.js", "highlight.js", "grammar-dependencies.js",
  ...Object.keys(languages).map(language => `grammars/${language}.js`),
]) {
  const destination = join(microlighterDestination, filename);
  await mkdir(dirname(destination), { recursive: true });
  const result = await transform(await readFile(join(microlighterRoot, filename), "utf8"), {
    loader: "js", minify: true, target: "es2022", legalComments: "none",
  });
  await writeFile(destination, result.code);
}
const theme = await transform(await readFile(join(microlighterRoot, "themes/github.css"), "utf8"), {
  loader: "css", minify: true,
});
await mkdir(join(microlighterDestination, "themes"), { recursive: true });
await writeFile(join(microlighterDestination, "themes/github.css"), theme.code);
await copyFile(join(microlighterRoot, "../LICENSE"), join(microlighterDestination, "LICENSE"));

const escapeHTML = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
async function measureFiles(paths) {
  const files = [];
  for (const path of [...new Set(paths)].sort()) {
    const body = await readFile(join(outputsRoot, path));
    const gzipBytes = gzipSync(body).length;
    files.push({
      path, bytes: body.length, gzipBytes,
      // scripts/serve.js has gzip sidecars for JavaScript. HTML, CSS and SVG
      // are intentionally counted as uncompressed for this local comparison.
      localTransferBytes: extname(path) === ".js" ? gzipBytes : body.length,
    });
  }
  return {
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    localTransferBytes: files.reduce((sum, file) => sum + file.localTransferBytes, 0),
    requests: files.length, files,
  };
}

function staticReferences(html, page) {
  const base = new URL(`https://examples.invalid/${page.directory ? `${page.directory}/` : ""}`);
  const values = [];
  for (const tag of html.match(/<(?:link|script)\b[^>]*>/gi) ?? []) {
    const match = tag.match(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/i);
    if (!match) continue;
    const target = new URL(match[2].replaceAll("&amp;", "&"), base);
    if (target.origin !== base.origin) continue;
    values.push(decodeURIComponent(target.pathname.slice(1)));
  }
  return values;
}

async function highlightingFiles(html) {
  const requested = [...html.matchAll(/\blanguage-([a-z0-9_-]+)/g)].map(([, language]) => language);
  if (!requested.length) return [];
  const loader = createGrammarLoader(async language => {
    try {
      const grammar = await import(pathToFileURL(join(microlighterRoot, "grammars", `${language}.js`)).href);
      return grammar.default;
    } catch {
      return null;
    }
  });
  const loaded = await loader(requested);
  return [
    "shared/microlighter/index.js",
    "shared/microlighter/highlight.js",
    "shared/microlighter/grammar-dependencies.js",
    "shared/microlighter/themes/github.css",
    ...Object.keys(loaded.languages).map(language => `shared/microlighter/grammars/${language}.js`),
  ];
}

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
      const language = filename.endsWith(".svelte") ? "svelte"
        : filename.endsWith(".tsx") ? "tsx"
          : filename.endsWith(".ts") ? "typescript" : "javascript";
      samples.push(`<h3>${escapeHTML(filename)}</h3><pre><code class="language-${language}" data-code-sample>${escapeHTML(source)}</code></pre>`);
    }
    html = html.replace("<!-- renderer-source -->", () => `<details class="reading-notes"><summary>Component source</summary>${samples.join("\n")}</details>`);
    html = html.replace("<!-- renderer-navigation -->", () => renderers.map(renderer =>
      `<a href="${prefix}${renderer.id}/"${renderer.id === page.renderer.id ? ' aria-current="page"' : ""}>${escapeHTML(renderer.title)}</a>`
    ).join("\n          "));
  }
  html = html.replace("<!-- renderer-links -->", () => `<section class="metrics-panel" id="renderers" aria-labelledby="renderers-title">
    <h2 id="renderers-title">Rendered by a library</h2>
    <p>Try the same label, checkbox replacement, and popover examples in ${renderers.length} independent pages.</p>
    <nav class="jump-links" aria-label="Renderer examples">${renderers.map(renderer => `<a href="${prefix}${renderer.id}/">${escapeHTML(renderer.title)}</a>`).join(" ")}</nav>
  </section>`);
  const summaryMarker = "<!-- generated-bundle-summary -->";
  if (html.includes("<!-- bundle-summary -->")) {
    html = html.replace("<!-- bundle-summary -->", summaryMarker);
  } else {
    // Keep the older scenario page useful without maintaining duplicate metrics markup.
    if (!html.includes("</main>")) throw new Error(`${page.id} has no insertion point for its size report`);
    html = html.replace("</main>", () => `${summaryMarker}\n</main>`);
    html = html.replace("<head>", `<head>\n<link rel="stylesheet" href="${assets}/styles.css">`);
  }
  html = html.replace("<!-- capability-sizes -->", () => renderCapabilitySizes(reports, { prefix }));
  const preloadMarkup = preloads.get(page.id).map(pathname =>
    `<link rel="modulepreload" href="${prefix}${pathname}">`).join("\n");
  const mainScript = '<script type="module" src="./main.js"></script>';
  if (!html.includes(mainScript)) throw new Error(`${page.id} has no main module script`);
  html = html.replace(mainScript, () => `${preloadMarkup}\n${mainScript}`);
  html = html.replace("</head>", () => `<link rel="icon" type="image/svg+xml" href="${assets}/favicon.svg">\n</head>`);
  const hasCodeSamples = html.includes("data-code-sample");
  if (hasCodeSamples) {
    html = html.replace("</body>", () => `<script type="module" src="${assets}/code-highlighting.js"></script>\n</body>`);
  }

  const functional = new Set(report.total.files);
  const supportingPaths = staticReferences(html, page).filter(pathname => !functional.has(pathname));
  const supporting = await measureFiles(supportingPaths);
  const decoration = await measureFiles(hasCodeSamples ? await highlightingFiles(html) : []);
  report.delivery = {
    basis: "raw source bytes and local-server transfer (gzip JavaScript; uncompressed HTML, CSS, and SVG)",
    document: { bytes: 0, requests: 1 }, supporting, decoration,
    initialWithFallback: { bytes: 0, localTransferBytes: 0, requests: 1 + report.total.files.length + supporting.requests },
  };

  // The size summary contains the document byte count. Iterate until the
  // rendered digit width settles so the manifest and visible number are exact.
  let rendered;
  for (let pass = 0; pass < 8; pass += 1) {
    rendered = html.replace(summaryMarker, () => renderBundleSummary(report, { prefix }));
    const documentBytes = Buffer.byteLength(rendered);
    const previous = report.delivery.document.bytes;
    report.delivery.document.bytes = documentBytes;
    report.delivery.initialWithFallback.bytes = documentBytes + report.total.bytes + supporting.bytes;
    report.delivery.initialWithFallback.localTransferBytes = documentBytes + report.total.gzipBytes + supporting.localTransferBytes;
    if (documentBytes === previous) break;
  }
  rendered = html.replace(summaryMarker, () => renderBundleSummary(report, { prefix }));
  await writeFile(join(outputsRoot, page.directory, "index.html"), rendered);
}

async function filesWithin(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithin(pathname));
    else if (entry.isFile()) files.push(pathname);
  }
  return files;
}

// The local server negotiates gzip for every JavaScript asset, including the
// independently loaded highlighter. Pages publishing filters these sidecars.
for (const pathname of await filesWithin(outputsRoot)) {
  if (extname(pathname) !== ".js") continue;
  const body = await readFile(pathname);
  const gzip = gzipSync(body);
  const path = portable(relative(outputsRoot, pathname));
  const measured = reports.flatMap(report => report.files).find(file => file.path === path);
  if (measured && measured.gzipBytes !== gzip.length) throw new Error(`Gzip size changed while building ${path}`);
  await writeFile(`${pathname}.gz`, gzip);
}

await writeFile(join(outputsRoot, "bundle-sizes.json"), JSON.stringify({
  version: 1, unit: "KB", bytesPerKB: 1000, pages: reports,
}, null, 2) + "\n");
await writeFile(join(projectRoot, "dist/metafile.json"), JSON.stringify(metafile, null, 2) + "\n");
for (const report of reports) {
  console.log(`${report.title}: ${(report.baseline.bytes / 1000).toFixed(3)} KB page JS + ${(report.fallback.bytes / 1000).toFixed(3)} KB fallback = ${(report.total.bytes / 1000).toFixed(3)} KB total (${(report.total.gzipBytes / 1000).toFixed(3)} KB gzip)`);
}
