const section = document.getElementById("boundaries");
const host = document.getElementById("bd-host-name");
const negativeHost = document.getElementById("bd-negative-host");
const positiveHost = document.getElementById("bd-positive-host");
if ([host, negativeHost, positiveHost].some(element => !element?.shadowRoot)) {
  throw new Error("The boundary examples require parser-created Declarative Shadow DOM.");
}
const namedButton = host.shadowRoot.getElementById("control");
const inheritedButton = negativeHost.shadowRoot.getElementById("button");
const stringButton = negativeHost.shadowRoot.getElementById("string-button");
const explicitButton = positiveHost.shadowRoot.getElementById("button");
const negativePanel = document.getElementById("bd-negative-panel");
const positivePanel = document.getElementById("bd-positive-panel");
const hasPopover = typeof HTMLElement.prototype.showPopover === "function"
  && typeof HTMLElement.prototype.togglePopover === "function";
const hasReflection = "popoverTargetElement" in explicitButton;
let innerClicks = 0;

// Ordinary component wiring supplies this outward relationship. It makes no
// call into the fallback and also runs when no adapter was loaded.
if (hasReflection) explicitButton.popoverTargetElement = positivePanel;

function panelState(panel) {
  return hasPopover ? (panel.matches(":popover-open") ? "open" : "closed") : "Popover API unavailable";
}

function targetName(target) {
  return target ? `#${target.id || target.localName}` : "null";
}

function observe(id, text) {
  const output = document.getElementById(id);
  if (output.textContent !== text) output.textContent = text;
}

function update() {
  observe("bd-host-observation", `host aria-label: ${host.getAttribute("aria-label")} · inner aria-label: ${namedButton.getAttribute("aria-label") ?? "absent"} · inner aria-labelledby: ${namedButton.getAttribute("aria-labelledby") ?? "absent"} · inner clicks: ${innerClicks}`);
  observe("bd-negative-observation", `outside panel: ${panelState(negativePanel)} · first button target attribute: ${inheritedButton.getAttribute("popovertarget") ?? "absent"} · string target resolved: ${targetName(stringButton.popoverTargetElement)}`);
  observe("bd-positive-observation", `outside panel: ${panelState(positivePanel)} · explicit target: ${targetName(explicitButton.popoverTargetElement)}${hasReflection ? "" : " · element reflection unavailable"}`);
}

namedButton.addEventListener("click", () => { innerClicks += 1; update(); });
for (const panel of [negativePanel, positivePanel]) panel.addEventListener("toggle", update);
section.addEventListener("click", () => queueMicrotask(update));

namedButton.disabled = false;
inheritedButton.disabled = !hasPopover;
stringButton.disabled = !hasPopover;
explicitButton.disabled = !(hasPopover && hasReflection);
for (const panel of [negativePanel, positivePanel]) {
  panel.hidden = !hasPopover;
  for (const button of panel.querySelectorAll("button")) button.disabled = !hasPopover;
}
update();
