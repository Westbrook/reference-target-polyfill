import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "esbuild";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = resolve(projectRoot, "dist/browser");
const entryPoints = {
  core: "src/core.js",
  detect: "src/detect.js",
  "detect/surface": "src/detect/surface.js",
  "adapters/labels": "src/adapters/labels.js",
  "adapters/popover-targets": "src/adapters/popover-targets.js",
  "adapters/dialog-commands": "src/adapters/dialog-commands.js",
  "adapters/popover-commands": "src/adapters/popover-commands.js",
  "adapters/text-names": "src/adapters/text-names.js",
  "adapters/form-targets": "src/adapters/form-targets.js",
};

const portable = (pathname) => pathname.split(sep).join("/");

export async function buildBrowserModules() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const buildOptions = {
    absWorkingDir: projectRoot,
    outbase: resolve(projectRoot, "src"),
    outdir: outputRoot,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    treeShaking: true,
    charset: "utf8",
    legalComments: "none",
    sourcemap: false,
    entryNames: "[dir]/[name]",
    chunkNames: "chunks/[name]-[hash]",
    metafile: true,
  };
  // Keep the tiny surface check and the full probe independently loadable.
  // Adapter entries still share their larger action utilities when selected
  // together, while core inlines detection instead of importing a probe chunk.
  const independent = ["core", "detect", "detect/surface"];
  const results = [];
  for (const entry of independent) {
    results.push(await build({
      ...buildOptions,
      entryPoints: [entryPoints[entry]],
      splitting: false,
    }));
  }
  results.push(await build({
    ...buildOptions,
    entryPoints: Object.entries(entryPoints)
      .filter(([entry]) => entry.startsWith("adapters/"))
      .map(([, source]) => source),
    splitting: true,
  }));

  const sourceToEntry = new Map(
    Object.entries(entryPoints).map(([entry, source]) => [source, entry]),
  );
  const files = [];
  const outputs = results.flatMap((result) => Object.entries(result.metafile.outputs));
  for (const [output, metadata] of outputs) {
    if (!output.endsWith(".js")) continue;
    const pathname = resolve(projectRoot, output);
    const body = await readFile(pathname);
    files.push({
      path: portable(relative(outputRoot, pathname)),
      entry: metadata.entryPoint ? sourceToEntry.get(portable(metadata.entryPoint)) : undefined,
      bytes: body.byteLength,
      gzipBytes: gzipSync(body).byteLength,
      brotliBytes: brotliCompressSync(body).byteLength,
      imports: metadata.imports
        .filter(({ external }) => !external)
        .map(({ path }) => portable(relative(outputRoot, resolve(projectRoot, path)))),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const emittedPaths = new Set(files.map(({ path }) => path));
  for (const file of files) {
    for (const imported of file.imports) {
      if (!emittedPaths.has(imported)) {
        throw new Error(`Browser module ${file.path} imports missing output ${imported}`);
      }
    }
  }
  const surfaceFile = files.find(({ entry }) => entry === "detect/surface");
  if (!surfaceFile || surfaceFile.imports.length !== 0) {
    throw new Error("Browser surface detection must remain a self-contained entry");
  }

  const sum = (field) => files.reduce((total, file) => total + file[field], 0);
  const manifest = {
    version: 1,
    format: "esm",
    target: "es2022",
    minified: true,
    sourceMaps: false,
    entries: Object.fromEntries(
      files.filter(({ entry }) => entry).map(({ entry, path }) => [entry, path]),
    ),
    totals: {
      bytes: sum("bytes"),
      gzipBytes: sum("gzipBytes"),
      brotliBytes: sum("brotliBytes"),
      files: files.length,
    },
    files,
  };
  await writeFile(
    resolve(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildBrowserModules();
  console.log(
    `Built ${manifest.totals.files} browser modules: ${manifest.totals.bytes} bytes, ` +
    `${manifest.totals.gzipBytes} gzip, ${manifest.totals.brotliBytes} brotli.`,
  );
}
