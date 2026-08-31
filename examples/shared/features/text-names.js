const labelHost = document.getElementById("tn-label-host");
const descriptionHost = document.getElementById("tn-description-host");
if (!labelHost?.shadowRoot || !descriptionHost?.shadowRoot) {
  throw new Error("The text examples require parser-created Declarative Shadow DOM.");
}
const input = document.getElementById("tn-input");
const changeButton = document.getElementById("tn-update");
const output = document.getElementById("tn-observation");
const examples = [
  ["Delivery preference", "Tell us where the parcel should be left."],
  ["Collection preference", "Tell us when you would like to collect the parcel."],
];
let selection = 0;

function describe(attribute) {
  const references = input.getAttribute(attribute) ?? "(absent)";
  const proxyTexts = (references.match(/[^\t\n\f\r ]+/g) ?? [])
    .map(id => document.getElementById(id))
    .filter(element => element?.hasAttribute("data-reference-target-text"))
    .map(element => element.textContent);
  return `${attribute}: ${references} · text proxy: ${proxyTexts.length ? proxyTexts.join(" / ") : "none"}`;
}

function update() {
  const text = `${describe("aria-labelledby")}\n${describe("aria-describedby")}`;
  if (output.textContent !== text) output.textContent = text;
}

// Components own these public text values. The setup module's provider reads
// them without receiving or looking up a private shadow-tree target.
changeButton.addEventListener("click", () => {
  selection = (selection + 1) % examples.length;
  const [labelText, descriptionText] = examples[selection];
  labelHost.setAttribute("data-label-text", labelText);
  descriptionHost.setAttribute("data-description-text", descriptionText);
  labelHost.shadowRoot.getElementById("text").textContent = labelText;
  descriptionHost.shadowRoot.getElementById("text").textContent = descriptionText;
  queueMicrotask(update);
});

new MutationObserver(update).observe(input, {
  attributes: true,
  attributeFilter: ["aria-labelledby", "aria-describedby"],
});
// Text updates may leave the proxy IDs unchanged. Observe document text too,
// while writing the readout only when its value changes to keep this stable.
new MutationObserver(update).observe(document.body, {
  subtree: true,
  childList: true,
  characterData: true,
});
input.disabled = false;
changeButton.disabled = false;
update();
