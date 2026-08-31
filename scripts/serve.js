import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.RT_PORT ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".map": "application/json" };

function acceptsGzip(header = "") {
  const encodings = new Map(header.split(",").map(entry => {
    const [name, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find(parameter => parameter.trim().startsWith("q="));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return (encodings.get("gzip") ?? encodings.get("*") ?? 0) > 0;
}

createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const documentation = new Map([
      ["/", "/dist/site/index.html"],
      ["/docs.css", "/dist/site/docs.css"],
      ["/LICENSE", "/dist/site/LICENSE"],
      ["/README.md", "/dist/site/README.md"],
      ["/REFERENCE-TARGET-PROPOSAL.md", "/dist/site/REFERENCE-TARGET-PROPOSAL.md"],
    ]);
    const source = pathname.startsWith("/source/");
    if (source) pathname = pathname.slice("/source".length);
    if (!documentation.has(pathname) && !/^\/(examples|src|tests|dist)\//.test(pathname)) {
      response.writeHead(404).end("Not found");
      return;
    }
    // Public demos use their real independent production bundles, so the sizes
    // displayed on the page describe the JavaScript visitors actually request.
    const servedPath = documentation.get(pathname) ?? (!source && pathname.startsWith("/examples/") ? `/dist${pathname}` : pathname);
    let file = resolve(project, `.${servedPath}`);
    if (!file.startsWith(project + sep) || pathname.split("/").some(part => part.startsWith("."))) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const headers = { "Content-Type": types[extname(file)] ?? "text/plain; charset=utf-8", "Cache-Control": "no-store" };
    let body;
    if (extname(file) === ".js") {
      headers.Vary = "Accept-Encoding";
      if (acceptsGzip(request.headers["accept-encoding"])) {
        try {
          body = await readFile(`${file}.gz`);
          headers["Content-Encoding"] = "gzip";
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    body ??= await readFile(file);
    headers["Content-Length"] = body.length;
    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 400).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Consumption guide: http://127.0.0.1:${port}/`);
  console.log(`Demo: http://127.0.0.1:${port}/examples/`);
  console.log(`Bundle report: http://127.0.0.1:${port}/examples/bundle-sizes.json`);
  console.log(`Browser tests: http://127.0.0.1:${port}/tests/browser.html`);
});
