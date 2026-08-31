import { hasNativeReferenceTarget, probeReferenceTarget } from "./detect.js";

const installations = new WeakMap();

function targetString(value) {
  if (value == null) return null;
  if (typeof value === "symbol") throw new TypeError("referenceTarget cannot be a Symbol");
  return String(value);
}

function byId(root, id) {
  if (!id) return null;
  if (typeof root.getElementById === "function") return root.getElementById(id);
  if (root.nodeType === 1 && root.id === id) return root;
  return [...root.querySelectorAll("[id]")].find(element => element.id === id) ?? null;
}

function allowedReference(source, target) {
  let root = source.getRootNode();
  while (root) {
    if (target.getRootNode() === root) return true;
    root = root.nodeType === 11 ? root.host?.getRootNode() : null;
  }
  return false;
}

function validateAdapters(adapters) {
  const ids = new Set();
  return adapters.map(adapter => {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id ||
        typeof adapter.install !== "function") {
      throw new TypeError("Each adapter needs an id and install(context) method");
    }
    if (ids.has(adapter.id)) throw new TypeError(`Duplicate adapter: ${adapter.id}`);
    ids.add(adapter.id);
    return adapter;
  }).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function inactiveHandle(mode, adapters, reason) {
  const statuses = Object.freeze(Object.fromEntries(adapters.map(adapter => [adapter.id, mode])));
  return Object.freeze({
    mode, reason, statuses, activeAdapters: Object.freeze([]),
    refresh() {}, hydrate() {}, dispose() {},
    register() { return Object.freeze({ dispose() {} }); },
  });
}

/**
 * Install a partial fallback for this realm. Adapter modules have no import-time effects.
 * force is intended for tests: it suppresses native forwarding on captured roots.
 */
export function installReferenceTarget({
  adapters = [], realm = globalThis, force = false, onDiagnostic,
} = {}) {
  const selected = validateAdapters(adapters);
  if (typeof realm.Element?.prototype.attachShadow !== "function" ||
      !realm.document || typeof realm.MutationObserver !== "function" ||
      typeof realm.WeakRef !== "function") {
    throw new TypeError("Reference Target fallback requires a browser with Shadow DOM and WeakRef");
  }
  if (onDiagnostic !== undefined && typeof onDiagnostic !== "function") {
    throw new TypeError("onDiagnostic must be a function");
  }
  if (installations.has(realm)) {
    throw new Error("Reference Target fallback is already installed in this realm; dispose it first");
  }
  if (!selected.length) return inactiveHandle("inactive", selected, "No adapters selected");
  const nativeSurface = hasNativeReferenceTarget(realm);
  if (nativeSurface && !force) {
    const probe = probeReferenceTarget(realm);
    return inactiveHandle(probe.nullable && probe.labels ? "native" : "unsupported", selected,
      probe.nullable && probe.labels ? undefined : "Partial native implementation; fallback was not layered over it");
  }

  const document = realm.document;
  const prototype = realm.Element.prototype;
  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "attachShadow");
  const originalAttach = prototype.attachShadow;
  const nativeProperty = Object.getOwnPropertyDescriptor(realm.ShadowRoot.prototype, "referenceTarget");
  const records = new WeakMap(); // host -> record; never exposed by the public handle
  const excludedRoots = new WeakSet();
  const knownRoots = new Set(); // WeakRefs, so a detached component is not retained by the installer
  const scopes = new WeakMap();
  const subscribers = new Set();
  const runtimes = [];
  const statuses = Object.create(null);
  const handledEvents = new WeakSet();
  let disposed = false;
  let scheduled = false;
  let refreshing = false;
  let dirty = false;

  function report(code, detail) {
    if (!onDiagnostic) return;
    const seen = new Set();
    function publicDetail(value) {
      if (value instanceof realm.Node) {
        let node = value;
        while (node.getRootNode().nodeType === 11 && node.getRootNode().host) {
          node = node.getRootNode().host;
        }
        return { nodeName: node.nodeName, ...(node.id ? { id: node.id } : {}) };
      }
      if (value instanceof Error || value instanceof realm.DOMException) {
        return { name: value.name, message: value.message };
      }
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[circular]";
        seen.add(value);
        return Array.isArray(value) ? value.map(publicDetail)
          : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicDetail(item)]));
      }
      return value;
    }
    onDiagnostic(Object.freeze({ code, detail: publicDetail(detail) }));
  }

  function roots(includeDetached = false) {
    const result = [document];
    for (const ref of knownRoots) {
      const root = ref.deref();
      if (!root) knownRoots.delete(ref);
      else if (includeDetached || root.host.isConnected) result.push(root);
    }
    return result;
  }

  function scheduleRefresh() {
    if (disposed) return;
    dirty = true;
    if (scheduled) return;
    scheduled = true;
    realm.queueMicrotask(() => {
      scheduled = false;
      if (dirty && !disposed) flush();
    });
  }

  function click(event) {
    if (disposed || event.defaultPrevented || handledEvents.has(event)) return;
    const path = event.composedPath();
    // A shared priority order ensures that exactly one selected adapter owns an activation.
    for (const runtime of runtimes) {
      if (runtime.click?.(event, path)) {
        handledEvents.add(event);
        break;
      }
    }
  }

  function observe(root) {
    if (scopes.has(root)) return;
    const observer = new realm.MutationObserver(mutations => {
      if (disposed) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) discover(node);
        }
      }
      scheduleRefresh();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    root.addEventListener("click", click);
    root.addEventListener("slotchange", scheduleRefresh);
    scopes.set(root, { observer });
  }

  function register(root, options = {}) {
    if (disposed) throw new Error("This Reference Target installation has been disposed");
    if (!(root instanceof realm.ShadowRoot)) throw new TypeError("register() requires a ShadowRoot from this realm");
    excludedRoots.delete(root);
    let record = records.get(root.host);
    if (record) {
      if ("referenceTarget" in options) root.referenceTarget = options.referenceTarget;
      return record.handle;
    }
    const own = Object.getOwnPropertyDescriptor(root, "referenceTarget");
    if (own && !own.configurable) throw new TypeError("Cannot capture a nonconfigurable referenceTarget property");
    const initial = targetString("referenceTarget" in options ? options.referenceTarget : root.referenceTarget);
    const nativeReferenceTarget = nativeSurface && force ? nativeProperty?.get?.call(root) : undefined;
    record = { root, referenceTarget: initial, own, nativeReferenceTarget };
    const getter = function () {
      if (this !== root) throw new TypeError("Illegal referenceTarget receiver");
      return record.referenceTarget;
    };
    const setter = function (value) {
      if (this !== root) throw new TypeError("Illegal referenceTarget receiver");
      const next = targetString(value);
      if (next !== record.referenceTarget) {
        record.referenceTarget = next;
        scheduleRefresh();
      }
    };
    Object.defineProperty(root, "referenceTarget", { configurable: true, enumerable: true, get: getter, set: setter });
    try {
      if (nativeSurface && force) nativeProperty?.set?.call(root, null);
    } catch (error) {
      if (own) Object.defineProperty(root, "referenceTarget", own);
      else delete root.referenceTarget;
      throw error;
    }
    record.getter = getter;
    record.handle = Object.freeze({
      dispose() {
        if (records.get(root.host) === record) unregister(root);
      },
    });
    records.set(root.host, record);
    knownRoots.add(new realm.WeakRef(root));
    observe(root);
    scheduleRefresh();
    return record.handle;
  }

  function unregister(root) {
    const record = records.get(root.host);
    if (!record) return;
    const state = scopes.get(root);
    state?.observer.disconnect();
    root.removeEventListener("click", click);
    root.removeEventListener("slotchange", scheduleRefresh);
    scopes.delete(root);
    records.delete(root.host);
    excludedRoots.add(root);
    for (const ref of knownRoots) if (ref.deref() === root || !ref.deref()) knownRoots.delete(ref);
    if (Object.getOwnPropertyDescriptor(root, "referenceTarget")?.get === record.getter) {
      if (record.own) Object.defineProperty(root, "referenceTarget", record.own);
      else delete root.referenceTarget;
      if (nativeSurface && force) {
        nativeProperty?.set?.call(root, record.own ? record.nativeReferenceTarget : record.referenceTarget);
      }
    }
    scheduleRefresh();
  }

  function resolveTarget(host) {
    let element = host;
    const seen = new Set();
    while (element) {
      if (seen.has(element)) return null;
      seen.add(element);
      const record = records.get(element);
      if (!record || record.referenceTarget === null) return element;
      if (record.referenceTarget === "") return null;
      element = record.root.getElementById(record.referenceTarget);
    }
    return null;
  }

  function isForwarded(host) {
    const record = records.get(host);
    return !!record && record.referenceTarget !== null;
  }

  function resolveReference(source, attribute, property) {
    let host = null;
    if (property && property in source) {
      const value = source[property];
      if (value instanceof realm.Element && allowedReference(source, value)) host = value;
    }
    if (!host) host = byId(source.getRootNode(), source.getAttribute(attribute));
    return { host, target: resolveTarget(host), forwarded: isForwarded(host) };
  }

  function discover(container, metadata = false) {
    const elements = container.nodeType === 1 ? [container, ...container.querySelectorAll("*")] : container.querySelectorAll("*");
    for (const element of elements) {
      const existing = records.get(element);
      const root = existing?.root ?? element.shadowRoot;
      // A form control named "shadowRoot" can mask the inherited getter.
      if (!(root instanceof realm.ShadowRoot) || excludedRoots.has(root)) continue;
      if (!existing) {
        const options = metadata && element.hasAttribute("data-reference-target")
          ? { referenceTarget: element.getAttribute("data-reference-target") } : {};
        register(root, options);
      } else if (metadata && element.hasAttribute("data-reference-target")) {
        root.referenceTarget = element.getAttribute("data-reference-target");
      }
      discover(root, metadata);
    }
  }

  function refresh() {
    if (disposed) return;
    discover(document);
    flush();
  }

  function flush() {
    if (disposed) return;
    if (refreshing) { dirty = true; return; }
    refreshing = true;
    dirty = false;
    try {
      for (const runtime of runtimes) runtime.refresh?.();
      for (const callback of subscribers) callback();
    } finally {
      refreshing = false;
      if (dirty) scheduleRefresh();
    }
  }

  function wrappedAttachShadow(init) {
    // A later library may retain this wrapper after our disposal.
    if (disposed) return Reflect.apply(originalAttach, this, arguments);
    const initial = targetString(init?.referenceTarget);
    // In force mode preserve other dictionary options while preventing native forwarding.
    // An empty proxy target also permits frozen caller dictionaries: overriding
    // a nonconfigurable property on the original object violates Proxy invariants.
    const nativeInit = nativeSurface && force && init && (typeof init === "object" || typeof init === "function")
      ? new Proxy(Object.create(null), { get(_target, key) { return key === "referenceTarget" ? null : Reflect.get(init, key, init); } })
      : init;
    const root = Reflect.apply(originalAttach, this, [nativeInit]);
    register(root, { referenceTarget: initial });
    return root;
  }

  const context = Object.freeze({
    window: realm, document, resolveTarget, resolveReference, isForwarded, roots,
    report, onChange(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
  });
  const handle = Object.freeze({
    mode: "fallback",
    get statuses() { return Object.freeze({ ...statuses }); },
    get activeAdapters() { return Object.freeze(Object.keys(statuses).filter(id => statuses[id] === "fallback")); },
    register,
    hydrate(container = document) { discover(container, true); refresh(); },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      const cleanup = callback => { try { callback(); } catch (error) { errors.push(error); } };
      for (const runtime of [...runtimes].reverse()) cleanup(() => runtime.dispose?.());
      for (const root of roots(true)) {
        if (root === document) {
          scopes.get(root)?.observer.disconnect();
          root.removeEventListener("click", click);
          root.removeEventListener("slotchange", scheduleRefresh);
        } else cleanup(() => unregister(root));
      }
      subscribers.clear();
      if (prototype.attachShadow === wrappedAttachShadow) {
        Object.defineProperty(prototype, "attachShadow", originalDescriptor);
      }
      installations.delete(realm);
      if (errors.length) throw new AggregateError(errors, "Errors while disposing Reference Target adapters");
    },
  });

  installations.set(realm, handle);
  try {
    Object.defineProperty(prototype, "attachShadow", { ...originalDescriptor, value: wrappedAttachShadow });
    for (const adapter of selected) {
      if (adapter.check && !adapter.check(realm)) {
        statuses[adapter.id] = "unsupported";
        report("missing-primitive", { adapter: adapter.id });
        continue;
      }
      const runtime = adapter.install(context) ?? {};
      if (typeof runtime.then === "function") throw new TypeError("Adapter installation must be synchronous");
      runtimes.push(runtime);
      statuses[adapter.id] = "fallback";
    }
    observe(document);
    refresh();
    return handle;
  } catch (error) {
    try {
      handle.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Reference Target installation and rollback failed", { cause: error });
    }
    throw error;
  }
}
