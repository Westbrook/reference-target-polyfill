import { svelteExamplesPlugin } from "./build-svelte.js";
import { angularLinkerPlugin } from "./build-angular.js";

/** Production renderer settings shared by page builds and dependency-graph tests. */
export function exampleBuildOptions(page) {
  return {
    loader: { ".css": "text" },
    define: {
      "process.env.NODE_ENV": '"production"',
      __VUE_OPTIONS_API__: "false",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
      ngDevMode: "false",
      ngJitMode: "false",
    },
    plugins: page.renderer?.id === "svelte" ? [svelteExamplesPlugin()]
      : page.renderer?.id === "angular" ? [angularLinkerPlugin()] : [],
  };
}
