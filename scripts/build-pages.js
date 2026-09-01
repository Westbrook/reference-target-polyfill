import { copyFile, cp, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function filesWithin(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`The Pages artifact contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...await filesWithin(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

// A project site lives below /repository-name/. Catch links that would work on
// localhost's root but fail after publication, as well as missing copied assets.
export async function verifySiteLinks(siteDirectory) {
  const siteRoot = resolve(siteDirectory);
  const baseURL = new URL("https://pages.example.invalid/repository-name/");
  let checked = 0;
  for (const filename of await filesWithin(siteRoot)) {
    if (!filename.endsWith(".html")) continue;
    const pathname = relative(siteRoot, filename).split(sep).join("/");
    const documentURL = new URL(pathname, baseURL);
    const html = await readFile(filename, "utf8");
    for (const [tag] of html.matchAll(/<(?:a|area|link|script|img|source|iframe|video|audio|track|input|embed)\b[^>]*>/gi)) {
      for (const [, , raw] of tag.matchAll(/\b(?:href|src|poster)\s*=\s*(["'])(.*?)\1/gi)) {
        const value = raw.replaceAll("&amp;", "&");
        if (value.startsWith("/") && !value.startsWith("//")) {
          throw new Error(`${pathname}: use a relative URL for the project site: ${value}`);
        }
        const target = new URL(value, documentURL);
        if (target.origin !== baseURL.origin || target.protocol !== baseURL.protocol) continue;
        if (!target.pathname.startsWith(baseURL.pathname)) {
          throw new Error(`${pathname}: URL escapes the project site: ${value}`);
        }
        const targetPath = join(siteRoot, decodeURIComponent(target.pathname.slice(baseURL.pathname.length)));
        try {
          const info = await stat(targetPath);
          if (info.isDirectory()) await lstat(join(targetPath, "index.html"));
          checked += 1;
        } catch (error) {
          throw new Error(`${pathname}: missing local link or asset: ${value}`, { cause: error });
        }
      }
    }
  }
  return checked;
}

export async function assemblePagesSite({ projectRoot = defaultRoot } = {}) {
  const root = resolve(projectRoot);
  const output = join(root, "dist/site");
  // Check required inputs before replacing the previous publication artifact.
  const homepage = await readFile(join(root, "docs/index.html"));
  const stylesheet = await readFile(join(root, "docs/styles.css"));
  await stat(join(root, "dist/examples/index.html"));
  await stat(join(root, "dist/browser/manifest.json"));
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "index.html"), homepage);
  await writeFile(join(output, "docs.css"), stylesheet);
  await cp(join(root, "dist/examples"), join(output, "examples"), {
    recursive: true,
    // Source maps remain useful in the local build, and gzip sidecars are used
    // by scripts/serve.js. Neither belongs in the static Pages artifact.
    filter: pathname => !pathname.endsWith(".map") && !pathname.endsWith(".gz"),
  });
  // This is the optimized direct-browser distribution. Preserve its manifest
  // and exact module layout so documentation links and integrity checks agree.
  await cp(join(root, "dist/browser"), join(output, "browser"), { recursive: true });
  await cp(join(root, "src"), join(output, "src"), { recursive: true });
  for (const filename of ["README.md", "REFERENCE-TARGET-PROPOSAL.md", "LICENSE"]) {
    try {
      await copyFile(join(root, filename), join(output, filename));
    } catch (error) {
      if (error.code !== "ENOENT" || filename !== "LICENSE") throw error;
    }
  }
  await writeFile(join(output, ".nojekyll"), "");
  const checked = await verifySiteLinks(output);
  console.log(`Pages site: dist/site (${checked} local links and assets checked)`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { buildBrowserModules } = await import("./build-browser.js");
  await Promise.all([buildBrowserModules(), import("./build-example.js")]);
  await assemblePagesSite();
}
