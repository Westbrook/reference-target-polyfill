import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compile } from "svelte/compiler";

function diagnostic(message, filename, source) {
  const start = message.start;
  return {
    text: `${message.code}: ${message.message}`,
    ...(start ? {
      location: {
        file: filename,
        line: start.line,
        column: start.column,
        lineText: source.split(/\r?\n/)[start.line - 1],
      },
    } : {}),
  };
}

// Compile before bundling, keeping the Svelte compiler out of browser assets
// and letting esbuild account for every included runtime module and CSS import.
export function svelteExamplesPlugin() {
  return {
    name: "svelte-examples",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        let compiled;
        try {
          compiled = compile(source, {
            filename: path,
            customElement: true,
            generate: "client",
            dev: false,
          });
        } catch (error) {
          if (!error.code) throw error;
          return { errors: [diagnostic(error, path, source)] };
        }

        return {
          contents: `${compiled.js.code}\n//# sourceMappingURL=${compiled.js.map.toUrl()}\n`,
          loader: "js",
          resolveDir: dirname(path),
          warnings: compiled.warnings.map(warning => diagnostic(warning, path, source)),
          watchFiles: [path],
        };
      });
    },
  };
}
