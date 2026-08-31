import type { Config } from "@stencil/core";

export const config: Config = {
  namespace: "ReferenceTargetStencil",
  srcDir: "src",
  enableCache: false,
  maxConcurrentWorkers: 0,
  outputTargets: [{
    type: "dist-custom-elements",
    dir: "../../dist/stencil",
    customElementsExportBehavior: "bundle",
    // Specialize the runtime here; esbuild then includes every generated chunk
    // in the standalone page and its bundle-size report.
    externalRuntime: false,
    generateTypeDeclarations: false,
  }],
};
