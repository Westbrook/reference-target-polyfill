import { managePopoverFocus } from "../popover-focus.js";

const section = document.getElementById("popover-commands");
const host = document.getElementById("pc-host");
const root = host?.shadowRoot;
if (!root) throw new Error("The popover-commands example requires Declarative Shadow DOM.");

const panel = root.getElementById("pc-panel");
const cancellation = document.getElementById("pc-cancel");
const output = document.getElementById("pc-observation");
const supported = typeof panel.showPopover === "function" && typeof panel.hidePopover === "function";
let commands = 0;
let canceled = 0;
let lastCommand = "none";

function update() {
  const state = supported ? panel.matches(":popover-open") ? "open" : "closed" : "Popover API unavailable";
  const message = `panel: ${state} · commands: ${commands} · last command: ${lastCommand} · canceled commands: ${canceled}`;
  if (output.textContent !== message) output.textContent = message;
}

panel.addEventListener("command", (event) => {
  commands += 1;
  lastCommand = event.command;
  if (cancellation.checked) {
    event.preventDefault();
    cancellation.checked = false;
    canceled += 1;
  }
  queueMicrotask(update);
});
panel.addEventListener("toggle", update);
managePopoverFocus(panel, [
  document.getElementById("pc-toggle"),
  document.getElementById("pc-show"),
]);
// This component-owned close button provides a native escape route even when
// the outside Reference Target connection is unavailable in Browser alone.
root.getElementById("pc-close").addEventListener("click", () => panel.hidePopover());
section.addEventListener("click", () => queueMicrotask(update));
panel.hidden = !supported;
for (const control of section.querySelectorAll("button, input")) control.disabled = !supported;
for (const button of root.querySelectorAll("button")) button.disabled = !supported;
update();
