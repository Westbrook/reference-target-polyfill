import { managePopoverFocus } from "../popover-focus.js";

// Application behavior only. The bootstrap has already selected any fallback.
const section = document.getElementById("popover-targets");
const host = document.getElementById("pt-host");
const root = host?.shadowRoot;
if (!root) throw new Error("The popover-targets example requires Declarative Shadow DOM.");

const panel = root.getElementById("pt-panel");
const output = document.getElementById("pt-observation");
const supported = typeof panel.showPopover === "function" && typeof panel.hidePopover === "function";
let toggles = 0;

function update() {
  const state = supported ? panel.matches(":popover-open") ? "open" : "closed" : "Popover API unavailable";
  const reflected = document.getElementById("pt-toggle").popoverTargetElement;
  const message = `panel: ${state} · toggle events: ${toggles} · reflected target: ${reflected ? `#${reflected.id}` : "null"}`;
  if (output.textContent !== message) output.textContent = message;
}

panel.addEventListener("toggle", () => { toggles += 1; update(); });
managePopoverFocus(panel, [
  document.getElementById("pt-toggle"),
  document.getElementById("pt-show"),
]);
// Reading after dispatch observes either native or fallback activation. These
// listeners never open the panel on behalf of the outside controls.
section.addEventListener("click", () => queueMicrotask(update));
panel.hidden = !supported;
for (const button of section.querySelectorAll("button")) button.disabled = !supported;
for (const button of root.querySelectorAll("button")) button.disabled = !supported;
update();
