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
  function optionalEntryPoint(pathname) {
    const expected = resolve(projectRoot, pathname);
    return [...outputs].find(([, output]) =>
      output.entryPoint && resolve(projectRoot, output.entryPoint) === expected)?.[0];
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
  // The full behavioral probe is discovered only when an auto-mode visit sees
  // the native property surface. It is mutually exclusive with the fallback.
  const nativeProbeEntry = optionalEntryPoint("src/detect.js");
  const nativeProbe = nativeProbeEntry ? staticClosure([nativeProbeEntry]) : new Set();
  for (const pathname of baseline) fallback.delete(pathname);
  for (const pathname of baseline) nativeProbe.delete(pathname);
  const routeShared = new Set([...fallback].filter(pathname => nativeProbe.has(pathname)));
  const classified = new Set([...baseline, ...fallback, ...nativeProbe]);
  for (const pathname of outputs.keys()) {
    if (javascript(pathname) && !classified.has(pathname)) {
      throw new Error(`Unclassified JavaScript output in ${page.id}: ${pathname}`);
    }
  }
  const files = [];
  for (const pathname of [...classified].sort()) {
    const path = portable(relative(outputsRoot, pathname));
    if (path.startsWith("../") || isAbsolute(path)) throw new Error(`Output outside examples directory: ${pathname}`);
    const body = await readFile(pathname);
    files.push({
      path, bytes: body.length, gzipBytes: gzipSync(body).length,
      delivery: baseline.has(pathname) ? "baseline"
        : routeShared.has(pathname) ? "route-shared"
          : fallback.has(pathname) ? "fallback" : "native-probe",
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
    fallback: measure(files.filter(file => file.delivery === "fallback" || file.delivery === "route-shared")),
    nativeProbe: measure(files.filter(file => file.delivery === "native-probe" || file.delivery === "route-shared")),
    total: measure(files.filter(file => file.delivery !== "native-probe")),
    nativeTotal: measure(files.filter(file => file.delivery !== "fallback")),
    files,
  };
}

export function renderBundleSummary(report, { prefix = "./" } = {}) {
  const cards = [
    ["baseline", "Functional page JavaScript", "Always loaded."],
    ["fallback", "Fallback additional", "Core + selected adapters."],
    ["total", "Fallback route total", "Always-loaded and fallback files; shared files counted once."],
  ].map(([kind, title, explanation]) => {
    const size = report[kind];
    return `<article class="size-card" data-size-kind="${kind}" data-bytes="${size.bytes}" data-gzip-bytes="${size.gzipBytes}">
      <h3>${title}</h3>
      <strong data-size="bytes" data-bytes="${size.bytes}">${kb(size.bytes)}</strong>
      <span data-size="gzip" data-bytes="${size.gzipBytes}">${kb(size.gzipBytes)} gzip</span>
      <p>${explanation}</p>
    </article>`;
  }).join("\n");
  const nativeCard = report.nativeProbe?.bytes ? `<article class="size-card" data-optional-size="native-probe" data-bytes="${report.nativeTotal.bytes}" data-gzip-bytes="${report.nativeTotal.gzipBytes}">
      <h3>Native-surface route total</h3>
      <strong>${kb(report.nativeTotal.bytes)}</strong>
      <span>${kb(report.nativeTotal.gzipBytes)} gzip</span>
      <p>Includes ${kb(report.nativeProbe.bytes)} (${kb(report.nativeProbe.gzipBytes)} gzip) of behavioral probes requested only after the property surface is present.</p>
    </article>` : "";
  const delivery = report.delivery;
  const deliveryCards = delivery ? `<section class="delivery-context" aria-labelledby="${escapeHTML(report.id)}-delivery-title">
    <h3 id="${escapeHTML(report.id)}-delivery-title">Whole-page delivery context</h3>
    <div class="size-grid">
      <article class="size-card" data-delivery-kind="document" data-bytes="${delivery.document.bytes}">
        <h4>HTML document</h4>
        <strong>${kb(delivery.document.bytes)}</strong>
        <span>1 request</span>
        <p>Generated markup, including these measurements.</p>
      </article>
      <article class="size-card" data-delivery-kind="supporting" data-bytes="${delivery.supporting.bytes}">
        <h4>Initial supporting assets</h4>
        <strong>${kb(delivery.supporting.bytes)} raw</strong>
        <span>${kb(delivery.supporting.localTransferBytes)} local transfer · ${delivery.supporting.requests} requests</span>
        <p>Styles, icon, and the highlighting scheduler; functional JS is separate above.</p>
      </article>
      <article class="size-card" data-delivery-kind="initial-with-fallback" data-bytes="${delivery.initialWithFallback.bytes}">
        <h4>Initial page with fallback</h4>
        <strong>${kb(delivery.initialWithFallback.bytes)} raw</strong>
        <span>${kb(delivery.initialWithFallback.localTransferBytes)} local transfer · ${delivery.initialWithFallback.requests} requests</span>
        <p>Document + functional fallback path + initial supporting assets, with unique files counted once.</p>
      </article>
      <article class="size-card" data-delivery-kind="decoration" data-bytes="${delivery.decoration.bytes}">
        <h4>Deferred highlighting</h4>
        <strong>${kb(delivery.decoration.bytes)} raw</strong>
        <span>${kb(delivery.decoration.localTransferBytes)} local transfer · ${delivery.decoration.requests} requests</span>
        <p>Engine, theme, and this page’s grammar closure, requested after a source disclosure opens or during idle time.</p>
      </article>
    </div>
    <p class="metric-note">“Local transfer” matches the included development server: gzip JavaScript sidecars, but uncompressed HTML, CSS, and SVG. GitHub Pages, browser caching, HTTP headers, and production compression can change transferred bytes and request scheduling. Module preloads fetch functional modules early without evaluating the app and do not add duplicate transfers.</p>
  </section>` : "";
  const rows = report.files.map(file => `<tr data-file-path="${escapeHTML(file.path)}" data-delivery="${file.delivery}">
      <td><a data-bundle-file="${escapeHTML(file.path)}" href="${escapeHTML(prefix + file.path)}"><code>${escapeHTML(file.path)}</code></a></td>
      <td>${file.delivery === "baseline" ? "Page" : file.delivery === "fallback" ? "Fallback additional" : file.delivery === "route-shared" ? "Fallback / native probe shared" : "Native-surface probe"}</td>
      <td data-size="bytes" data-bytes="${file.bytes}">${kb(file.bytes)}</td>
      <td data-size="gzip" data-bytes="${file.gzipBytes}">${kb(file.gzipBytes)}</td>
    </tr>`).join("\n");
  return `<section class="metrics-panel" data-bundle-id="${escapeHTML(report.id)}" aria-label="JavaScript and page delivery sizes">
    <h2>Functional JavaScript sizes</h2>
    <div class="size-grid">${cards}${nativeCard}</div>
    <p class="metric-note">Minified / gzip. 1 KB = 1,000 bytes. Demo-only syntax highlighting is excluded from the functional totals and reported separately below.</p>
    ${deliveryCards}
    <details>
      <summary>Inspect the ${report.files.length} generated JavaScript files</summary>
      <p class="metric-note">Selected adapters: ${report.adapters.map(adapter => `<code>${escapeHTML(adapter)}</code>`).join(", ")}.</p>
      <p class="metric-note">Gzip totals sum each compressed file. The fallback and native-probe routes are mutually exclusive. Separate CSS files, HTML, JSON, source maps, HTTP headers, and Microlighter assets are excluded. Component styles embedded in JavaScript are included. Transfer sizes depend on compression and caching. <a href="${escapeHTML(prefix + "shared/microlighter/LICENSE")}">Microlighter MIT license</a>.</p>
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
