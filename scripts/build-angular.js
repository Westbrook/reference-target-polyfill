import { formatDiagnostics, performCompilation, readConfiguration } from "@angular/compiler-cli";
import { needsLinking } from "@angular/compiler-cli/linker";
import linkerPlugin from "@angular/compiler-cli/linker/babel";
import { transformAsync } from "@babel/core";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function checkDiagnostics(diagnostics) {
  if (diagnostics.length) console.log(formatDiagnostics(diagnostics));
  if (diagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error("Angular example compilation failed");
  }
}

export async function buildAngularExamples() {
  const { rootNames, options, errors, emitFlags } = readConfiguration(join(projectRoot, "examples/angular/tsconfig.json"));
  checkDiagnostics(errors);
  await rm(join(projectRoot, "dist/angular"), { recursive: true, force: true });
  const { diagnostics } = performCompilation({ rootNames, options, emitFlags });
  checkDiagnostics(diagnostics);
}

// Angular's npm libraries use partial compilation. Finish them with the official
// linker before esbuild bundles the page, keeping the compiler out of the browser.
export function angularLinkerPlugin() {
  return {
    name: "angular-linker",
    setup(build) {
      build.onLoad({ filter: /[/\\]node_modules[/\\]@angular[/\\].*\.m?js$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        if (!needsLinking(path, source)) return;
        const result = await transformAsync(source, {
          filename: path,
          configFile: false,
          babelrc: false,
          sourceMaps: "inline",
          plugins: [[linkerPlugin, { linkerJitMode: false }]],
        });
        if (!result?.code) throw new Error(`Angular linker did not emit ${path}`);
        return { contents: result.code, loader: "js" };
      });
    },
  };
}
