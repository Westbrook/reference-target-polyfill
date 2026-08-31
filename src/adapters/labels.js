import {
  isInLabelScope,
  isInteractive,
  isLabel,
  isLabelable,
  isUnavailable,
  sameElements,
} from "../internal/label-utils.js";

/**
 * Approximate external label activation, optionally providing an outward ARIA name.
 *
 * Activation is an explicit application policy because native label behavior is
 * platform-dependent. This does not synthesize native .control or .labels links.
 *
 * @param {{activation: "focus" | "focus-and-click", naming?: boolean}} options
 */
export function labels(options = {}) {
  const { activation, naming = false } = options;
  if (activation !== "focus" && activation !== "focus-and-click") {
    throw new TypeError('labels requires activation: "focus" or "focus-and-click".');
  }
  if (typeof naming !== "boolean") {
    throw new TypeError("labels naming must be a boolean.");
  }

  return {
    id: "labels",
    priority: 10,
    attributes: ["for", "type", "disabled", "inert", "hidden", "aria-label", "aria-labelledby"],
    install(context) {
      const activating = new Set();
      const bindings = new Map();
      const overridden = new WeakSet();
      const unavailable = new WeakSet();
      let disposed = false;
      let reportedNamingUnavailable = false;

      function labelReference(label) {
        // Includes FACE and any native Reference Target implementation. Layering
        // synthetic activation over an existing relationship can toggle twice.
        if (label.control !== null) return null;
        if (label.hasAttribute("for")) {
          const reference = context.resolveReference(label, "for");
          return reference?.forwarded && isLabelable(reference.target) ? reference : null;
        }

        // querySelectorAll follows the label's actual tree, without entering
        // shadow roots or treating projected slot contents as descendants.
        for (const host of label.querySelectorAll("*")) {
          if (isLabelable(host)) return null;
          if (!context.isForwarded(host)) continue;
          const target = context.resolveTarget(host);
          if (isLabelable(target)) return { host, target, forwarded: true };
        }
        return null;
      }

      function click(event, path) {
        if (disposed || event.defaultPrevented || (event.button !== undefined && event.button !== 0)) {
          return false;
        }
        const labelIndex = path.findIndex(isLabel);
        if (labelIndex === -1) return false;
        const label = path[labelIndex];
        const reference = labelReference(label);
        if (!reference) return false;
        const { host, target } = reference;

        // Claim without canceling the control's own click. In a closed root this
        // also stops an outer listener, whose composedPath hides the control,
        // from processing the same event again.
        const originPath = path.slice(0, labelIndex);
        if (originPath.includes(host) || originPath.includes(target) || originPath.some(isInteractive)) {
          return true;
        }
        if (activating.has(target) || isUnavailable(target) || isUnavailable(label)) return true;

        event.preventDefault();
        activating.add(target);
        try {
          target.focus();
          // Focus handlers may remove or disable the original control.
          if (activation === "focus-and-click" && !isUnavailable(target)) target.click();
        } finally {
          activating.delete(target);
        }
        return true;
      }

      function references(control) {
        const value = control.ariaLabelledByElements;
        return value == null ? null : Array.from(value);
      }

      function owns(control, binding) {
        return control.getAttribute("aria-labelledby") === binding.appliedAttribute
          && sameElements(references(control), binding.appliedElements);
      }

      function restore(control, binding) {
        if (!owns(control, binding)) return;
        control.ariaLabelledByElements = binding.previousElements;
        if (binding.previousAttribute === null) control.removeAttribute("aria-labelledby");
        else control.setAttribute("aria-labelledby", binding.previousAttribute);
      }

      function reportNamingUnavailable() {
        if (reportedNamingUnavailable) return;
        reportedNamingUnavailable = true;
        context.report("labels-naming-unavailable", {
          message: "Label naming needs ariaLabelledByElements with working outward element references.",
        });
      }

      function refresh() {
        if (disposed || !naming) return;
        const desired = new Map();
        for (const root of context.roots()) {
          for (const label of root.querySelectorAll("label")) {
            if (!isLabel(label) || !label.isConnected) continue;
            const reference = labelReference(label);
            if (!reference || !reference.target.isConnected || !isInLabelScope(reference.target, label)) continue;
            const list = desired.get(reference.target) ?? [];
            list.push(label);
            desired.set(reference.target, list);
          }
        }

        for (const [control, binding] of bindings) {
          if (!owns(control, binding)) {
            // An author changed the relationship through an attribute or IDL
            // setter. Never restore over it or fold it into a fallback name.
            bindings.delete(control);
            overridden.add(control);
          } else if (!desired.has(control) || control.hasAttribute("aria-label")) {
            restore(control, binding);
            bindings.delete(control);
          }
        }

        for (const [control, externalLabels] of desired) {
          let binding = bindings.get(control);
          if (overridden.has(control) || unavailable.has(control)) continue;
          if (control.hasAttribute("aria-label")) continue;
          if (!("ariaLabelledByElements" in control)) {
            reportNamingUnavailable();
            continue;
          }
          const currentElements = references(control);
          if (!binding && (control.hasAttribute("aria-labelledby") || currentElements?.length)) continue;

          // The explicit list takes precedence over native HTML labels. Keep
          // those internal labels too, after the external labels in tree order.
          const wanted = [...new Set([...externalLabels, ...Array.from(control.labels ?? [])])];
          if (binding && sameElements(binding.appliedElements, wanted)) continue;
          if (!binding) {
            binding = {
              previousAttribute: control.getAttribute("aria-labelledby"),
              previousElements: currentElements,
              appliedAttribute: null,
              appliedElements: null,
            };
          }
          control.ariaLabelledByElements = wanted;
          binding.appliedAttribute = control.getAttribute("aria-labelledby");
          binding.appliedElements = references(control);
          if (!sameElements(binding.appliedElements, wanted)) {
            restore(control, binding);
            bindings.delete(control);
            // Do not repeatedly mutate attributes when an engine rejects the
            // outward relationship; that would keep its observer queue alive.
            unavailable.add(control);
            reportNamingUnavailable();
          } else {
            bindings.set(control, binding);
          }
        }
      }

      return {
        click,
        ...(naming ? { refresh } : {}),
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const [control, binding] of bindings) restore(control, binding);
          bindings.clear();
          activating.clear();
        },
      };
    },
  };
}
