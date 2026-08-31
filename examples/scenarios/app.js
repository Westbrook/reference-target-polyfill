// All roots in this example were created by the HTML parser. Application code
// uses their public open roots and native element-reference APIs only.
const ids = [
  "checkbox-host", "popover-host", "label-host", "host-label-negative",
  "outward-negative-host", "outward-positive-host",
];
const hosts = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
if (ids.some(id => !hosts[id].shadowRoot)) {
  throw new Error("This example requires parser-created Declarative Shadow DOM.");
}

class ScenarioLabel extends HTMLElement {
  connectedCallback() {
    // The component owns this explicit, plain-text fallback contract. Its
    // provider receives only the host, not a shadow-tree element.
    const text = this.shadowRoot.getElementById("label").textContent;
    if (this.getAttribute("data-label-text") !== text) this.setAttribute("data-label-text", text);
  }
}

class ScenarioOutwardPositive extends HTMLElement {
  connectedCallback() {
    const button = this.shadowRoot.getElementById("button");
    const panel = document.getElementById(this.getAttribute("popovertarget"));
    if ("popoverTargetElement" in button) button.popoverTargetElement = panel;
  }
}

customElements.define("rt-scenario-label", ScenarioLabel);
customElements.define("rt-scenario-outward-positive", ScenarioOutwardPositive);

const checkbox = hosts["checkbox-host"].shadowRoot.getElementById("control");
const label = document.getElementById("checkbox-label");
const panel = hosts["popover-host"].shadowRoot.getElementById("panel");
const namedInput = document.getElementById("name-input");
const hostLabelButton = hosts["host-label-negative"].shadowRoot.getElementById("control");
const outwardNegativeButton = hosts["outward-negative-host"].shadowRoot.getElementById("button");
const outwardStringButton = hosts["outward-negative-host"].shadowRoot.getElementById("string-button");
const outwardPositiveButton = hosts["outward-positive-host"].shadowRoot.getElementById("button");
const outsidePanel = document.getElementById("outside-popover");
const explicitPanel = document.getElementById("explicit-popover");
const hasPopover = typeof HTMLElement.prototype.showPopover === "function"
  && typeof HTMLElement.prototype.togglePopover === "function";
const hasElementReflection = "popoverTargetElement" in HTMLButtonElement.prototype;

function setObservation(id, value) {
  const output = document.getElementById(id);
  if (output.textContent !== value) output.textContent = value;
}

function referenceName(element) {
  return element ? `#${element.id || element.localName}` : "null";
}

function popoverState(element) {
  return hasPopover ? (element.matches(":popover-open") ? "open" : "closed") : "API unavailable";
}

function updateObservations() {
  const outwardLabels = checkbox.ariaLabelledByElements;
  setObservation("checkbox-observation",
    `checked: ${checkbox.checked} · label.control: ${referenceName(label.control)} · inner .labels: ${checkbox.labels.length} · outward label elements: ${outwardLabels?.length ?? 0}`);
  setObservation("popover-observation",
    `panel: ${popoverState(panel)} · reflected target: ${referenceName(document.getElementById("popover-button").popoverTargetElement)}`);
  const referenceIds = namedInput.getAttribute("aria-labelledby") ?? "(absent)";
  const proxies = (referenceIds.match(/[^\t\n\f\r ]+/g) ?? [])
    .map(id => document.getElementById(id))
    .filter(element => element?.hasAttribute("data-reference-target-text"));
  setObservation("name-observation",
    `aria-labelledby: ${referenceIds} · text proxy: ${proxies.length ? proxies.map(proxy => proxy.textContent).join(" ") : "none"}`);
  setObservation("host-label-observation",
    `host aria-label: ${hosts["host-label-negative"].getAttribute("aria-label")} · inner aria-label: ${hostLabelButton.getAttribute("aria-label") ?? "absent"} · inner aria-labelledby: ${hostLabelButton.getAttribute("aria-labelledby") ?? "absent"}`);
  setObservation("outward-negative-observation",
    `outside panel: ${popoverState(outsidePanel)} · first button attribute: ${outwardNegativeButton.getAttribute("popovertarget") ?? "absent"} · string target resolved: ${referenceName(outwardStringButton.popoverTargetElement)}`);
  setObservation("outward-positive-observation",
    `outside panel: ${popoverState(explicitPanel)} · explicit target: ${referenceName(outwardPositiveButton.popoverTargetElement)}${hasElementReflection ? "" : " · element reflection unavailable"}`);
}

// Listeners only read public DOM state; they do not emulate the six behaviors.
checkbox.addEventListener("change", updateObservations);
for (const popover of [panel, outsidePanel, explicitPanel]) {
  popover.addEventListener("toggle", updateObservations);
}
document.addEventListener("click", () => queueMicrotask(updateObservations));
new MutationObserver(updateObservations).observe(namedInput, {
  attributes: true, attributeFilter: ["aria-labelledby"],
});

// All authored controls start disabled, so parser-created native roots cannot
// activate a case while the fallback is still being selected and hydrated.
checkbox.disabled = false;
namedInput.disabled = false;
hostLabelButton.disabled = false;
outwardNegativeButton.disabled = !hasPopover;
outwardStringButton.disabled = !hasPopover;
outwardPositiveButton.disabled = !(hasPopover && hasElementReflection);
document.getElementById("popover-button").disabled = !hasPopover;
for (const popover of [panel, outsidePanel, explicitPanel]) {
  popover.hidden = !hasPopover;
  for (const button of popover.querySelectorAll("button")) button.disabled = !hasPopover;
}
updateObservations();
