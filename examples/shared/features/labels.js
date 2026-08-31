const section = document.getElementById("labels");
const cases = [
  ["lj-checkbox-host", "lj-checkbox-label", "lj-checkbox-observation"],
  ["lj-wrapped-host", "lj-wrapping-label", "lj-wrapped-observation"],
].map(([hostId, labelId, outputId]) => {
  const host = document.getElementById(hostId);
  if (!host?.shadowRoot) {
    throw new Error("The label examples require parser-created Declarative Shadow DOM.");
  }
  return {
    checkbox: host.shadowRoot.getElementById("control"),
    label: document.getElementById(labelId),
    output: document.getElementById(outputId),
  };
});

function update() {
  for (const { checkbox, label, output } of cases) {
    const control = label.control;
    const publicControl = control ? `#${control.id || control.localName}` : "null";
    const outwardLabels = checkbox.ariaLabelledByElements?.length ?? 0;
    const text = `checked: ${checkbox.checked} · label.control: ${publicControl} · inner .labels: ${checkbox.labels.length} · outward ARIA label elements: ${outwardLabels}`;
    if (output.textContent !== text) output.textContent = text;
  }
}

// These listeners only display native DOM state. The selected adapter or the
// browser supplies label behavior; the application does not synthesize it.
for (const { checkbox } of cases) {
  checkbox.addEventListener("change", update);
  new MutationObserver(update).observe(checkbox, {
    attributes: true,
    attributeFilter: ["aria-labelledby"],
  });
}
section.addEventListener("click", () => queueMicrotask(update));
for (const { checkbox } of cases) checkbox.disabled = false;
update();
