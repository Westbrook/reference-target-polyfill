import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const javascript = pathname => pathname.endsWith(".js");
const portable = pathname => pathname.split(sep).join("/");
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const kb = bytes => `${(bytes / 1000).toFixed(3)} KB`;

/** Measure the JavaScript actually emitted for one independently built page. */
export async function analyzePageBundles({ page, metafile, outputsRoot, projectRoot = process.cwd() }) {
  const outputs = new Map(Object.entries(metafile.outputs).map(([pathname, output]) => [resolve(projectRoot, pathname), output]));
  function entryPoint(filename) {
    const expected = resolve(projectRoot, "examples", page.directory, filename);
    const entry = [...outputs].find(([, output]) => output.entryPoint && resolve(projectRoot, output.entryPoint) === expected);
    if (!entry) throw new Error(`Missing ${filename} entry point for ${page.id}`);
    return entry[0];
  }
  function staticClosure(startingPoints) {
    const visited = new Set();
    function visit(pathname) {
      if (visited.has(pathname) || !javascript(pathname)) return;
      const output = outputs.get(pathname);
      if (!output) throw new Error(`Missing emitted import ${pathname}`);
      visited.add(pathname);
      for (const imported of output.imports) {
        if (imported.external || imported.kind === "dynamic-import") continue;
        const direct = resolve(projectRoot, imported.path);
        visit(outputs.has(direct) ? direct : resolve(dirname(pathname), imported.path));
      }
    }
    for (const pathname of startingPoints) visit(pathname);
    return visited;
  }
  // app.js is always dynamically imported after readiness; setup is conditional.
  const baseline = staticClosure([entryPoint("main.js"), entryPoint("app.js")]);
  const fallback = staticClosure([entryPoint("reference-target.setup.js")]);
  for (const pathname of baseline) fallback.delete(pathname);
  const total = new Set([...baseline, ...fallback]);
  for (const pathname of outputs.keys()) {
    if (javascript(pathname) && !total.has(pathname)) {
      throw new Error(`Unclassified JavaScript output in ${page.id}: ${pathname}`);
    }
  }
  const files = [];
  for (const pathname of [...total].sort()) {
    const path = portable(relative(outputsRoot, pathname));
    if (path.startsWith("../") || isAbsolute(path)) throw new Error(`Output outside examples directory: ${pathname}`);
    const body = await readFile(pathname);
    files.push({
      path, bytes: body.length, gzipBytes: gzipSync(body).length,
      delivery: baseline.has(pathname) ? "baseline" : "fallback",
    });
  }
  function measure(selected) {
    return {
      bytes: selected.reduce((sum, file) => sum + file.bytes, 0),
      gzipBytes: selected.reduce((sum, file) => sum + file.gzipBytes, 0),
      files: selected.map(file => file.path),
    };
  }
  return {
    id: page.id, directory: page.directory, title: page.title, adapters: [...page.adapters],
    baseline: measure(files.filter(file => file.delivery === "baseline")),
    fallback: measure(files.filter(file => file.delivery === "fallback")),
    total: measure(files), files,
  };
}

export function renderBundleSummary(report, { prefix = "./" } = {}) {
  const cards = [
    ["baseline", "Page JavaScript", "Always loaded."],
    ["fallback", "Fallback additional", "Core + selected adapters."],
    ["total", "Total with fallback", "Shared files counted once."],
  ].map(([kind, title, explanation]) => {
    const size = report[kind];
    return `<article class="size-card" data-size-kind="${kind}" data-bytes="${size.bytes}" data-gzip-bytes="${size.gzipBytes}">
      <h3>${title}</h3>
      <strong data-size="bytes" data-bytes="${size.bytes}">${kb(size.bytes)}</strong>
      <span data-size="gzip" data-bytes="${size.gzipBytes}">${kb(size.gzipBytes)} gzip</span>
      <p>${explanation}</p>
    </article>`;
  }).join("\n");
  const rows = report.files.map(file => `<tr data-file-path="${escapeHTML(file.path)}" data-delivery="${file.delivery}">
      <td><a data-bundle-file="${escapeHTML(file.path)}" href="${escapeHTML(prefix + file.path)}"><code>${escapeHTML(file.path)}</code></a></td>
      <td>${file.delivery === "baseline" ? "Page" : "Fallback additional"}</td>
      <td data-size="bytes" data-bytes="${file.bytes}">${kb(file.bytes)}</td>
      <td data-size="gzip" data-bytes="${file.gzipBytes}">${kb(file.gzipBytes)}</td>
    </tr>`).join("\n");
  return `<section class="metrics-panel" data-bundle-id="${escapeHTML(report.id)}" aria-label="JavaScript delivery sizes">
    <h2>JavaScript sizes</h2>
    <div class="size-grid">${cards}</div>
    <p class="metric-note">Minified / gzip. 1 KB = 1,000 bytes. Syntax highlighting is excluded.</p>
    <details>
      <summary>Inspect the ${report.files.length} generated JavaScript files</summary>
      <p class="metric-note">Selected adapters: ${report.adapters.map(adapter => `<code>${escapeHTML(adapter)}</code>`).join(", ")}.</p>
      <p class="metric-note">Gzip totals sum each compressed file. Separate CSS files, HTML, JSON, source maps, HTTP headers, and Microlighter assets are excluded. Component styles embedded in JavaScript are included. Transfer sizes depend on compression and caching. <a href="${escapeHTML(prefix + "shared/microlighter/LICENSE")}">Microlighter MIT license</a>.</p>
      <div class="table-scroll"><table class="files-table">
        <caption>Files included in this page’s totals</caption>
        <thead><tr><th scope="col">File</th><th scope="col">Delivery</th><th scope="col">Minified</th><th scope="col">Gzip</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p><a href="${escapeHTML(prefix + "bundle-sizes.json")}">Inspect the size manifest</a></p>
    </details>
  </section>`;
}

export function renderCapabilitySizes(reports, { prefix = "./" } = {}) {
  const capabilities = reports.filter(report => report.directory && report.adapters.length === 1 && report.id === report.adapters[0]);
  const rows = capabilities.map(report => `<tr data-capability-size="${escapeHTML(report.id)}">
      <th scope="row"><a href="${escapeHTML(prefix + report.directory + "/")}">${escapeHTML(report.title)}</a></th>
      <td>${kb(report.baseline.bytes)} <small>(${kb(report.baseline.gzipBytes)} gzip)</small></td>
      <td>${kb(report.fallback.bytes)} <small>(${kb(report.fallback.gzipBytes)} gzip)</small></td>
      <td>${kb(report.total.bytes)} <small>(${kb(report.total.gzipBytes)} gzip)</small></td>
    </tr>`).join("\n");
  return `<section class="metrics-panel" aria-label="Individual capability sizes">
    <h2>One adapter at a time</h2>
    <p>Independent page builds. Each fallback includes the core; the rows are not additive.</p>
    <div class="table-scroll"><table class="size-table">
      <caption>Minified JavaScript and the sum of per-file gzip sizes; 1 KB = 1,000 bytes</caption>
      <thead><tr><th scope="col">Capability</th><th scope="col">Page JavaScript</th><th scope="col">Fallback additional</th><th scope="col">Total with fallback</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}
