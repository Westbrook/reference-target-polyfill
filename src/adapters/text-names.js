const relations = [
  {
    attribute: "aria-labelledby",
    property: "ariaLabelledByElements",
    kind: "label",
  },
  {
    attribute: "aria-describedby",
    property: "ariaDescribedByElements",
    kind: "description",
  },
];

const tokens = (value) => value?.match(/[^\t\n\f\r ]+/g) ?? [];
const sameElements = (left, right) =>
  left !== null &&
  right !== null &&
  left.length === right.length &&
  left.every((element, index) => element === right[index]);

function isInReferenceScope(source, element) {
  const targetRoot = element.getRootNode();
  for (
    let root = source.getRootNode();
    root;
    root = root.nodeType === 11 ? root.host?.getRootNode() : null
  ) {
    if (root === targetRoot) return true;
  }
  return false;
}

function isPubliclyReachable(element) {
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
 * Approximate inward ARIA names/descriptions using component-provided text.
 *
 * `getText(host, kind)` receives the publicly referenced host, never a private
 * target. For valid forwarded targets, return a string to opt in or null to
 * leave that host reference alone. Invalid targets produce no reference.
 * This is a plain-text approximation, not accessible-name computation.
 *
 * Native reflected ARIA element lists are supported where available. Because
 * assigning those properties need not produce a DOM mutation, call the
 * installation handle's refresh() after later property/model-only updates.
 */
export function textNames({ getText } = {}) {
  if (typeof getText !== "function") {
    throw new TypeError("textNames() requires a getText(host, kind) function.");
  }

  return {
    id: "text-names",
    attributes: ["aria-labelledby", "aria-describedby", "id"],
    observation: {
      events: [],
      refresh: true,
      childList: true,
      // getText() is application code and may depend on any host attribute.
      attributes: null,
      characterData: true,
      slotchange: true,
      provider: "conservative",
    },
    install(context) {
      const { document, window } = context;
      const bindings = new Map();
      const proxyNodes = new WeakSet();
      const reflected = new Set(
        relations
          .filter(({ property }) => property in window.Element.prototype)
          .map(({ property }) => property),
      );
      let nextProxyId = 0;
      let disposed = false;
      let refreshing = false;
      let pending;

      function report(code, detail) {
        context.report(code, detail);
      }

      function elementsFor(source, relation) {
        if (!reflected.has(relation.property)) return null;
        const value = source[relation.property];
        return value == null ? null : Array.from(value);
      }

      function readBinding(source, relation) {
        const attribute = source.getAttribute(relation.attribute);
        // A native element-list setter clears the content attribute. An empty
        // list and an empty content attribute are indistinguishable, but neither
        // contains a reference that needs forwarding.
        if (attribute === "") {
          const elements = elementsFor(source, relation);
          if (elements?.length) {
            return { mode: "elements", attribute, elements };
          }
        }
        return { mode: "attribute", attribute };
      }

      function matches(source, relation, binding) {
        if (source.getAttribute(relation.attribute) !== binding.attribute) {
          return false;
        }
        const elements = elementsFor(source, relation);
        if (binding.mode === "elements") {
          return sameElements(elements, binding.elements);
        }
        // An author may have assigned an explicit list while our effective
        // content attribute was empty (for example, for an invalid target).
        return binding.attribute !== "" || !elements?.length;
      }

      function owns(source, relation, binding) {
        if (binding.expected.mode !== "elements") {
          return matches(source, relation, binding.expected);
        }
        // Native getters filter explicit references after tree moves. Compare
        // their permitted projection so detaching a source is not mistaken for
        // an author clearing its binding.
        return source.getAttribute(relation.attribute) === binding.expected.attribute
          && sameElements(
            elementsFor(source, relation),
            binding.expected.elements.filter((element) => isInReferenceScope(source, element)),
          );
      }

      function writeBinding(source, relation, binding, force = false) {
        if (!force && matches(source, relation, binding)) return;
        if (binding.mode === "elements") {
          source[relation.property] = binding.elements;
        } else if (binding.attribute === null) {
          source.removeAttribute(relation.attribute);
        } else {
          source.setAttribute(relation.attribute, binding.attribute);
        }
      }

      function clearProxies(binding) {
        for (const proxy of binding.proxies.values()) proxy.remove();
        binding.proxies.clear();
      }

      function release(source, relation, binding, restore) {
        try {
          if (restore && owns(source, relation, binding)) {
            // Restore the actual explicit backing list even if scope filtering
            // makes both current and original getters empty while disconnected.
            writeBinding(source, relation, binding.original, binding.original.mode === "elements");
          }
        } finally {
          clearProxies(binding);
        }
      }

      function uniqueId(root) {
        let id;
        do {
          id = `reference-target-text-${++nextProxyId}`;
        } while (root.getElementById(id));
        return id;
      }

      function proxyFor(binding, key, text) {
        const root = binding.root;
        let proxy = binding.proxies.get(key);
        if (!proxy || proxy.getRootNode() !== root) {
          proxy?.remove();
          proxy = document.createElement("span");
          proxyNodes.add(proxy);
          proxy.id = uniqueId(root);
          // Referenced hidden text participates in accessible name/description
          // computation without adding another visible or focusable control.
          proxy.hidden = true;
          proxy.setAttribute("data-reference-target-text", "");
          const parent = root.nodeType === 9
            ? root.body ?? root.documentElement
            : root;
          if (!parent) return null;
          parent.append(proxy);
          binding.proxies.set(key, proxy);
        } else if (root.getElementById(proxy.id) !== proxy) {
          // An author may have added a conflicting ID since our last refresh.
          proxy.id = uniqueId(root);
        }
        if (proxy.textContent !== text) proxy.textContent = text;
        return proxy;
      }

      function providerText(host, kind, cache) {
        let byKind = cache.get(host);
        if (!byKind) cache.set(host, (byKind = new Map()));
        if (byKind.has(kind)) return byKind.get(kind);
        let text = null;
        try {
          const result = getText(host, kind);
          if (typeof result === "string" || result === null) {
            text = result;
          } else {
            report("text-provider-value", { host, kind, value: result });
          }
        } catch (error) {
          report("text-provider-error", { host, kind, error });
        }
        byKind.set(kind, text);
        return text;
      }

      function reconcile(source, relation, sourceBindings, cache) {
        if (disposed) return;
        let binding = sourceBindings.get(relation.attribute);
        if (binding && !owns(source, relation, binding)) {
          // A later authored binding takes precedence, including an explicit
          // element-list assignment that also changes the binding mode.
          release(source, relation, binding, false);
          sourceBindings.delete(relation.attribute);
          binding = undefined;
        }

        const original = binding?.original ?? readBinding(source, relation);
        const references = original.mode === "elements"
          ? original.elements
          : tokens(original.attribute);
        if (!references.length) return;

        const root = source.getRootNode();
        if (binding && binding.root !== root) {
          clearProxies(binding);
          binding.root = root;
        }
        const next = binding ?? {
          original,
          root,
          proxies: new Map(),
          expected: original,
        };
        pending = { source, relation, binding: next };
        try {
          const effective = [];
          const usedProxies = new Set();
          let changed = false;

          for (const reference of references) {
            if (disposed) return;
            if (original.mode === "elements" && !isInReferenceScope(source, reference)) {
              // Retain the original backing reference for a later move back into
              // scope, without exposing its text through a currently valid proxy.
              changed = true;
              continue;
            }
            const host = original.mode === "elements"
              ? reference
              : root.getElementById(reference);
            if (!host || !context.isForwarded(host)) {
              effective.push(reference);
              continue;
            }
            if (!context.resolveTarget(host)) {
              changed = true;
              continue;
            }
            // Captured roots include closed trees. Do not expose one of their
            // descendants to an application callback, even through an open root
            // nested inside that closed tree. A public host may still forward to
            // a target in its own closed root: only its enclosing roots matter.
            if (!isPubliclyReachable(host)) {
              effective.push(reference);
              continue;
            }
            const text = providerText(host, relation.kind, cache);
            if (disposed) return;
            if (text === null) {
              effective.push(reference);
              continue;
            }
            // Repeated references to the same original host retain one node
            // identity, matching the relationship more closely and avoiding
            // duplicate hidden nodes and text computation.
            const proxy = proxyFor(next, reference, text);
            if (!proxy) {
              effective.push(reference);
              continue;
            }
            changed = true;
            usedProxies.add(reference);
            effective.push(original.mode === "elements" ? proxy : proxy.id);
          }

          if (disposed) return;
          // Provider callbacks may perform application work. Do not overwrite a
          // binding changed by the author during such a callback.
          if (binding ? !owns(source, relation, binding) : !matches(source, relation, original)) {
            clearProxies(next);
            sourceBindings.delete(relation.attribute);
            return;
          }

          if (!changed) {
            if (binding) release(source, relation, binding, true);
            sourceBindings.delete(relation.attribute);
            return;
          }

          const expected = original.mode === "elements"
            ? { mode: "elements", attribute: "", elements: effective }
            : { mode: "attribute", attribute: effective.join(" ") };
          writeBinding(source, relation, expected);
          next.expected = expected;
          if (disposed) {
            release(source, relation, next, true);
            sourceBindings.delete(relation.attribute);
            return;
          }
          // Keep old explicit references in scope until after changing the
          // binding. Removing their proxies earlier would change the reflected
          // getter and look like an author edit while checking ownership.
          for (const [key, proxy] of next.proxies) {
            if (!usedProxies.has(key)) {
              proxy.remove();
              next.proxies.delete(key);
            }
          }
          sourceBindings.set(relation.attribute, next);
        } catch (error) {
          sourceBindings.delete(relation.attribute);
          try {
            release(source, relation, next, true);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Text-name reconciliation and rollback failed",
              { cause: error },
            );
          }
          throw error;
        } finally {
          pending = undefined;
        }
      }

      function ownsMutation(mutation) {
        if (!mutation) return false;
        if (proxyNodes.has(mutation.target)) return true;
        if (mutation.type === "childList") {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          if (nodes.length && nodes.every((node) => proxyNodes.has(node))) return true;
        }
        if (mutation.type !== "attributes") return false;
        const relation = relations.find(({ attribute }) => attribute === mutation.attributeName);
        if (!relation) return false;
        const binding = bindings.get(mutation.target)?.get(relation.attribute);
        return !!binding && owns(mutation.target, relation, binding);
      }

      function incrementalSources(changeSet) {
        if (
          !changeSet ||
          changeSet.full ||
          changeSet.model ||
          changeSet.referenceTarget ||
          changeSet.slotchange
        ) return null;

        const sources = new Set();
        const mutations = changeSet.mutations ?? [];
        if (!mutations.length && changeSet.roots?.size) return null;
        for (const mutation of mutations) {
          if (ownsMutation(mutation)) continue;
          if (
            mutation.type !== "attributes" ||
            (mutation.attributeName !== "aria-labelledby" &&
              mutation.attributeName !== "aria-describedby")
          ) return null;
          sources.add(mutation.target);
        }
        if (!mutations.length) {
          for (const source of changeSet.sources ?? []) {
            if (
              bindings.has(source) ||
              source.hasAttribute?.("aria-labelledby") ||
              source.hasAttribute?.("aria-describedby")
            ) sources.add(source);
          }
        }
        return sources;
      }

      function refresh(changeSet) {
        if (disposed || refreshing) return;
        const incremental = incrementalSources(changeSet);
        if (incremental?.size === 0) return;
        refreshing = true;
        try {
          const roots = new Set(context.roots());
          const sources = incremental ?? new Set(bindings.keys());
          const cache = new WeakMap();
          if (!incremental) {
            for (const root of roots) {
              for (const source of root.querySelectorAll(
                "[aria-labelledby], [aria-describedby]",
              )) sources.add(source);
            }
          }

          for (const source of sources) {
            if (disposed) break;
            const sourceBindings = bindings.get(source) ?? new Map();
            if (!source.isConnected || !roots.has(source.getRootNode())) {
              for (const relation of relations) {
                const binding = sourceBindings.get(relation.attribute);
                if (binding) release(source, relation, binding, true);
              }
              bindings.delete(source);
              continue;
            }
            for (const relation of relations) {
              reconcile(source, relation, sourceBindings, cache);
              if (disposed) break;
            }
            if (disposed) break;
            if (sourceBindings.size) bindings.set(source, sourceBindings);
            else bindings.delete(source);
          }
        } finally {
          refreshing = false;
        }
      }

      function dispose() {
        if (disposed) return;
        disposed = true;
        const errors = [];
        const cleanup = (callback) => {
          try { callback(); } catch (error) { errors.push(error); }
        };
        for (const [source, sourceBindings] of bindings) {
          for (const relation of relations) {
            const binding = sourceBindings.get(relation.attribute);
            if (binding) cleanup(() => release(source, relation, binding, true));
          }
        }
        bindings.clear();
        if (pending) {
          cleanup(() => release(pending.source, pending.relation, pending.binding, true));
        }
        pending = undefined;
        if (errors.length) throw new AggregateError(errors, "Errors while disposing text-name bindings");
      }

      return { refresh, ownsMutation, dispose };
    },
  };
}
