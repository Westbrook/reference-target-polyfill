const CONTROLS = "aria-controls";
const ACTIVE = "aria-activedescendant";
const WATCHED = [CONTROLS, ACTIVE, "aria-expanded", "role", "type"];

function referenceId(value) {
  const tokens = value?.match(/[^\t\n\f\r ]+/g) ?? [];
  return tokens.length === 1 ? tokens[0] : null;
}

function publiclyReachable(element) {
  for (
    let root = element.getRootNode();
    root.nodeType === 11 && root.host;
    root = root.host.getRootNode()
  ) {
    if (root.mode === "closed") return false;
  }
  return true;
}

/**
 * Cooperatively bind a text/search combobox to a component's public listbox.
 *
 * getTargets(host) synchronously returns { listbox, activeOption } or null to
 * decline. Targets must be real light-DOM/slotted descendants in the source's
 * own DOM root. No private shadow target is passed to the provider or mirrored.
 * The controller owns rendering, focus, keyboard handling, selection, and
 * aria-expanded; call the installation's refresh() after model-only changes.
 *
 * Only authored attribute references to the host are rewritten. Explicit ARIA
 * element properties and direct option IDs remain the author's responsibility.
 * This is a same-tree cooperation contract, not referenceTargetMap emulation.
 */
export function comboboxTargets({ getTargets } = {}) {
  if (typeof getTargets !== "function") {
    throw new TypeError("comboboxTargets() requires a getTargets(host) function.");
  }

  return {
    id: "combobox-targets",
    nativeFallback: true,
    attributes: [...WATCHED, "id", "hidden", "inert", "aria-hidden", "style", "class"],
    install(context) {
      const { window } = context;
      const bindings = new Map();
      let disposed = false;
      let refreshing = false;

      function write(source, attribute, value) {
        if (source.getAttribute(attribute) === value) return;
        if (value === null) source.removeAttribute(attribute);
        else source.setAttribute(attribute, value);
      }

      function owns(source, attribute, field) {
        return field && source.getAttribute(attribute) === field.expected;
      }

      function release(source, binding) {
        if (!binding) return;
        for (const [attribute, field] of [[CONTROLS, binding.controls], [ACTIVE, binding.active]]) {
          if (owns(source, attribute, field)) write(source, attribute, field.original);
        }
        bindings.delete(source);
      }

      function eligible(source, roots) {
        return source instanceof window.HTMLInputElement && source.isConnected &&
          roots.has(source.getRootNode()) && publiclyReachable(source) &&
          source.getAttribute("role") === "combobox" &&
          (source.type === "text" || source.type === "search");
      }

      function uniqueId(element, root) {
        const id = element.id;
        if (!id || referenceId(id) !== id || root.getElementById(id) !== element) return false;
        for (const candidate of root.querySelectorAll("[id]")) {
          if (candidate !== element && candidate.id === id) return false;
        }
        return true;
      }

      function publicTarget(element, ancestor, root, role) {
        return element instanceof window.Element && element !== ancestor &&
          element.isConnected && element.getRootNode() === root &&
          publiclyReachable(element) && ancestor.contains(element) &&
          element.getAttribute("role") === role && uniqueId(element, root);
      }

      function visible(element) {
        for (let node = element; node; node = node.assignedSlot ?? node.parentElement ?? node.getRootNode().host) {
          if (node.hasAttribute("hidden") || node.hasAttribute("inert") ||
              node.getAttribute("aria-hidden")?.trim().toLowerCase() === "true") return false;
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        }
        // This also catches an unslotted public node or a hidden wrapper in a
        // closed tree, whose internal ancestors cannot be publicly inspected.
        return element.getClientRects().length !== 0;
      }

      function report(code, hostId, reason) {
        // Never include provider-returned nodes or thrown values in diagnostics.
        context.report(code, { hostId, reason });
      }

      function reconcile(source, roots) {
        let binding = bindings.get(source);
        if (!eligible(source, roots)) {
          release(source, binding);
          return;
        }
        const root = source.getRootNode();
        if (binding && (binding.root !== root || !owns(source, CONTROLS, binding.controls))) {
          // A replacement controls binding releases the old association, but
          // restores an active field only when that field is still ours.
          release(source, binding);
          binding = undefined;
        }
        if (binding?.active && !owns(source, ACTIVE, binding.active)) binding.active = null;

        const controls = binding?.controls.original ?? source.getAttribute(CONTROLS);
        const hostId = referenceId(controls);
        const host = hostId && root.getElementById(hostId);
        if (!host || !host.isConnected || !publiclyReachable(host) || !uniqueId(host, root)) {
          release(source, binding);
          return;
        }

        const originalActive = binding?.active?.original ?? source.getAttribute(ACTIVE);
        const snapshot = WATCHED.map((attribute) => source.getAttribute(attribute));
        const unchanged = () => !disposed && WATCHED.every(
          (attribute, index) => source.getAttribute(attribute) === snapshot[index],
        );
        let result;
        let listbox;
        let activeOption;
        let error = false;
        try {
          result = getTargets(host);
          if (result !== null && typeof result === "object") {
            ({ listbox, activeOption } = result);
          }
        } catch {
          error = true;
        }
        if (error) report("combobox-provider-error", hostId, "getTargets() threw.");

        // A provider may perform application work. Never replace authored
        // changes made during the callback. Keep an existing binding tracked
        // so the next refresh can release each field according to ownership.
        if (!unchanged()) return;
        if (!eligible(source, roots) || source.getRootNode() !== root ||
            !host.isConnected || host.getRootNode() !== root || host.id !== hostId) {
          release(source, binding);
          return;
        }
        if (error) {
          release(source, binding);
          return;
        }
        if (result === null) {
          release(source, binding);
          return;
        }
        if (!uniqueId(host, root) || !publicTarget(listbox, host, root, "listbox")) {
          report("combobox-provider-value", hostId, "Expected a unique, public listbox descendant in the same DOM root.");
          release(source, binding);
          return;
        }

        const validOption = activeOption !== null && publicTarget(activeOption, listbox, root, "option");
        if (activeOption !== null && !validOption) {
          report("combobox-provider-value", hostId, "Expected a unique, public option descendant of the listbox, or null.");
          // Diagnostics are application callbacks too. They may dispose the
          // installation, replace a binding, or move one of these nodes.
          if (!unchanged()) return;
          if (!eligible(source, roots) || source.getRootNode() !== root ||
              !host.isConnected || host.getRootNode() !== root || host.id !== hostId ||
              !publiclyReachable(host) || !uniqueId(host, root) ||
              !publicTarget(listbox, host, root, "listbox")) {
            release(source, binding);
            return;
          }
        }
        const next = binding ?? {
          root,
          controls: { original: controls, expected: controls },
          active: null,
        };
        write(source, CONTROLS, listbox.id);
        next.controls.expected = listbox.id;

        if (referenceId(originalActive) === hostId) {
          const value = source.getAttribute("aria-expanded") === "true" && validOption && visible(activeOption)
            ? activeOption.id : null;
          next.active ??= { original: originalActive, expected: source.getAttribute(ACTIVE) };
          write(source, ACTIVE, value);
          next.active.expected = value;
        }
        bindings.set(source, next);
      }

      function refresh() {
        if (disposed || refreshing) return;
        refreshing = true;
        try {
          const roots = new Set(context.roots());
          const sources = new Set(bindings.keys());
          for (const root of roots) {
            for (const source of root.querySelectorAll('input[role="combobox"][aria-controls]')) sources.add(source);
          }
          for (const source of sources) reconcile(source, roots);
        } finally {
          refreshing = false;
        }
      }

      function dispose() {
        if (disposed) return;
        disposed = true;
        for (const [source, binding] of bindings) release(source, binding);
      }

      return { refresh, dispose };
    },
  };
}
