const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** Native labelable elements only: form-associated hosts keep their own behavior. */
export function isLabelable(element) {
  if (element?.namespaceURI !== HTML_NAMESPACE) return false;
  if (element.localName === "input") return element.type !== "hidden";
  return /^(button|meter|output|progress|select|textarea)$/.test(element.localName);
}

export function isLabel(element) {
  return element?.namespaceURI === HTML_NAMESPACE && element.localName === "label";
}

export function composedParent(element) {
  const root = element.getRootNode();
  return element.assignedSlot ?? element.parentElement ?? (root.nodeType === 11 ? root.host : null) ?? null;
}

/** The disabled pseudo-class includes a control disabled by its fieldset. */
export function isUnavailable(element) {
  if (!element.isConnected || element.matches(":disabled")) return true;
  for (let ancestor = element; ancestor; ancestor = composedParent(ancestor)) {
    if (ancestor.hasAttribute("inert") || ancestor.hasAttribute("hidden")) return true;
  }
  return false;
}

export function isInteractive(element) {
  if (element?.nodeType !== 1) return false;
  if (element.isContentEditable) return true;
  if (element.namespaceURI !== HTML_NAMESPACE) return false;
  switch (element.localName) {
    case "a":
    case "area":
      return element.hasAttribute("href");
    case "audio":
    case "video":
      return element.hasAttribute("controls");
    case "img":
      return element.hasAttribute("usemap");
    case "input":
      return element.type !== "hidden";
    default:
      return /^(button|details|embed|iframe|label|select|summary|textarea)$/.test(element.localName);
  }
}

/** ARIA element references can point to an element in the same or an ancestor tree. */
export function isInLabelScope(control, label) {
  const labelRoot = label.getRootNode();
  let root = control.getRootNode();
  while (root) {
    if (root === labelRoot) return true;
    root = root.nodeType === 11 ? root.host?.getRootNode() : null;
  }
  return false;
}

export function sameElements(left, right) {
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((element, index) => element === right[index]);
}
