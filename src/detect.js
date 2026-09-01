import { hasNativeReferenceTarget } from "./detect/surface.js";

export { hasNativeReferenceTarget } from "./detect/surface.js";

/** Small DOM probes, not a substitute for browser/assistive-technology testing. */
export function probeReferenceTarget(realm = globalThis) {
  const result = { surface: hasNativeReferenceTarget(realm), nullable: false, labels: false };
  if (!result.surface) return Object.freeze(result);
  let fixture;
  try {
    const document = realm.document;
    if (!document?.documentElement) return Object.freeze(result);
    fixture = document.createElement("div");
    fixture.hidden = true;
    const label = document.createElement("label");
    const host = document.createElement("div");
    // A private enclosing tree prevents collisions with page IDs.
    const scope = fixture.attachShadow({ mode: "closed" });
    host.id = "reference-target-probe";
    label.htmlFor = host.id;
    scope.append(label, host);
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
  } catch {
    // An experimental surface may expose the property while rejecting one of
    // its dictionary, getter, setter, or forwarding operations. That is a
    // failed probe, not an exceptional condition for capability detection.
  } finally {
    try {
      fixture?.remove();
    } catch {
      // Capability detection must remain nonthrowing even in a modified realm.
    }
  }
  return Object.freeze(result);
}
