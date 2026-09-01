function deepActiveElement() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Add the dialog focus behavior that the popover demos intentionally promise. */
export function managePopoverFocus(panel, invokers) {
  if (!panel || typeof panel.showPopover !== "function") return;
  let opener;
  let restoreFocus = false;

  for (const invoker of invokers) {
    invoker?.addEventListener("click", () => { opener = invoker; }, { capture: true });
  }
  panel.addEventListener("beforetoggle", event => {
    if (event.newState === "open") return;
    restoreFocus = panel.contains(deepActiveElement());
  });
  panel.addEventListener("toggle", event => {
    if (event.newState === "open") {
      panel.querySelector("[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
        ?.focus({ preventScroll: true });
    } else if (restoreFocus && opener?.isConnected) {
      opener.focus({ preventScroll: true });
      restoreFocus = false;
    }
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.popover === "manual") {
      event.preventDefault();
      panel.hidePopover();
    }
  });
}
