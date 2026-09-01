/** A surface check only. It does not certify any relationship or accessibility behavior. */
export function hasNativeReferenceTarget(realm = globalThis) {
  try {
    const ShadowRoot = realm?.ShadowRoot;
    return typeof ShadowRoot === "function" &&
      "referenceTarget" in ShadowRoot.prototype;
  } catch {
    return false;
  }
}
