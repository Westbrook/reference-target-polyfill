import { managePopoverFocus } from "./popover-focus.js";

/** Observe real renderer output; all reference forwarding belongs to the browser or adapters. */
export function initializeRendererDemo() {
  const host = document.getElementById("renderer-checkbox");
  const root = host.shadowRoot;
  const popoverRoot = document.getElementById("renderer-popover").shadowRoot;
  const panel = popoverRoot?.getElementById("panel");
  let control = root?.getElementById("control");
  if (!control || !panel) throw new Error("The renderer did not create both reference targets.");

  const checkboxOutput = document.getElementById("renderer-checkbox-observation");
  const popoverOutput = document.getElementById("renderer-popover-observation");
  const label = document.getElementById("renderer-label");
  const replace = document.getElementById("renderer-replace");
  let replacements = 0;
  let changes = 0;
  let restoreReplaceFocus = false;

  function observeCheckbox() {
    const next = root.getElementById("control");
    if (!next) return;
    if (next !== control) {
      replacements += 1;
      control = next;
    }
    const labelControl = label.control;
    const text = `checked: ${control.checked} · replacements: ${replacements} · changes: ${changes}\nlabel.control: ${labelControl ? labelControl.localName : "null"} · inner .labels: ${control.labels.length} · outward ARIA label elements: ${control.ariaLabelledByElements?.length ?? 0}`;
    if (checkboxOutput.textContent !== text) checkboxOutput.textContent = text;
    replace.disabled = false;
    if (restoreReplaceFocus && next === control) {
      restoreReplaceFocus = false;
      replace.focus({ preventScroll: true });
    }
  }

  root.addEventListener("change", event => {
    if (event.target === root.getElementById("control")) {
      changes += 1;
      observeCheckbox();
    }
  });
  new MutationObserver(observeCheckbox).observe(root, {
    childList: true, subtree: true,
  });
  label.addEventListener("click", () => queueMicrotask(observeCheckbox));
  replace.addEventListener("click", () => {
    restoreReplaceFocus = document.activeElement === replace;
    replace.disabled = true;
    host.setAttribute("revision", String(Number(host.getAttribute("revision") ?? 0) + 1));
  });
  observeCheckbox();

  const supportsPopovers = typeof panel.showPopover === "function";
  function observePopover() {
    const currentPanel = popoverRoot.getElementById("panel");
    popoverOutput.textContent = supportsPopovers
      ? `popover: ${currentPanel?.matches(":popover-open") ? "open" : "closed"}`
      : "Native popovers are unavailable in this browser.";
  }
  // A renderer may replace the panel on reconnection. Capture non-bubbling
  // toggle events on the stable root and always read the current target.
  popoverRoot.addEventListener("toggle", observePopover, true);
  new MutationObserver(observePopover).observe(popoverRoot, { childList: true, subtree: true });
  const open = document.getElementById("renderer-open");
  const hide = document.getElementById("renderer-hide");
  open.disabled = !supportsPopovers;
  hide.disabled = !supportsPopovers;
  panel.hidden = !supportsPopovers;
  managePopoverFocus(panel, [open]);
  observePopover();
}
