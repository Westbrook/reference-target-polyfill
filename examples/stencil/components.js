import { defineCustomElements } from "../../dist/stencil/index.js";
import { whenRendererEvent } from "../shared/renderer-readiness.js";

defineCustomElements();

// dist-custom-elements does not expose componentOnReady(); wait for the
// componentDidLoad lifecycle instead of guessing how many frames rendering takes.
export async function whenReady() {
  const hosts = ["renderer-checkbox", "renderer-popover"].map(id => {
    const host = document.getElementById(id);
    if (!host) throw new Error(`Missing Stencil demo host: ${id}`);
    return host;
  });
  await Promise.all(hosts.map(host => whenRendererEvent(host, "Stencil")));
}
