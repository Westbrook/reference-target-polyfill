import Checkbox from "./checkbox.svelte";
import Popover from "./popover.svelte";

customElements.define("rt-svelte-checkbox", Checkbox.element);
customElements.define("rt-svelte-popover", Popover.element);

function whenRendered(host) {
  if (host.hasAttribute("data-renderer-ready")) return Promise.resolve();
  return new Promise(resolve => host.addEventListener("renderer-ready", resolve, { once: true }));
}

// Svelte mounts its inner component on the next tick after connection. The
// onMount signal waits for that actual render, including its native targets.
export async function whenReady() {
  const hosts = ["renderer-checkbox", "renderer-popover"].map(id => {
    const host = document.getElementById(id);
    if (!host) throw new Error(`Missing Svelte demo host: ${id}`);
    return host;
  });
  await Promise.all(hosts.map(whenRendered));
}
