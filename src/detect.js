/** A surface check only. It does not certify every relationship or accessibility behavior. */
export function hasNativeReferenceTarget(realm = globalThis) {
  return typeof realm.ShadowRoot === "function" &&
    "referenceTarget" in realm.ShadowRoot.prototype;
}

/** Small DOM probes, not a substitute for browser/assistive-technology testing. */
export function probeReferenceTarget(realm = globalThis) {
  const result = { surface: hasNativeReferenceTarget(realm), nullable: false, labels: false };
  if (!result.surface || !realm.document?.documentElement) return Object.freeze(result);
  const document = realm.document;
  const fixture = document.createElement("div");
  fixture.hidden = true;
  const label = document.createElement("label");
  const host = document.createElement("div");
  // A private enclosing tree prevents collisions with page IDs.
  const scope = fixture.attachShadow({ mode: "closed" });
  host.id = "reference-target-probe";
  label.htmlFor = host.id;
  scope.append(label, host);
  try {
    const root = host.attachShadow({ mode: "closed", referenceTarget: "control" });
    const input = document.createElement("input");
    input.id = "control";
    root.append(input);
    document.documentElement.append(fixture);
    const initial = root.referenceTarget === "control" && label.control === host;
    root.referenceTarget = "missing";
    const invalid = label.control === null;
    root.referenceTarget = null;
    result.nullable = root.referenceTarget === null;
    root.referenceTarget = "control";
    result.labels = initial && invalid && label.control === host;
  } finally {
    fixture.remove();
  }
  return Object.freeze(result);
}
