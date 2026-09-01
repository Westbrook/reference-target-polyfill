import { hasNativeReferenceTarget, probeReferenceTarget } from "./detect.js";

const INSTALLATION_KEY = Symbol.for("reference-target-fallback.installation");
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function targetString(value) {
  if (value == null) return null;
  if (typeof value === "symbol") throw new TypeError("referenceTarget cannot be a Symbol");
  return String(value);
}

function byId(root, id) {
  if (!id) return null;
  if (typeof root.getElementById === "function") return root.getElementById(id);
  if (root.nodeType === 1 && root.id === id) return root;
  for (const element of root.querySelectorAll("[id]")) {
    if (element.id === id) return element;
  }
  return null;
}

function allowedReference(source, target) {
  const targetRoot = target.getRootNode();
  let root = source.getRootNode();
  while (root) {
    if (targetRoot === root) return true;
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
    if (adapter.check !== undefined && typeof adapter.check !== "function") {
      throw new TypeError(`Adapter ${adapter.id} check must be a function`);
    }
    if (ids.has(adapter.id)) throw new TypeError(`Duplicate adapter: ${adapter.id}`);
    ids.add(adapter.id);
    return adapter;
  }).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function inactiveHandle(mode, adapters, reason, providedStatuses) {
  const statuses = Object.freeze(providedStatuses
    ? { ...providedStatuses }
    : Object.fromEntries(adapters.map(adapter => [adapter.id, mode])));
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
  if (typeof force !== "boolean") throw new TypeError("force must be a boolean");
  if (typeof realm.Element?.prototype.attachShadow !== "function" ||
      !realm.document || typeof realm.MutationObserver !== "function" ||
      typeof realm.WeakRef !== "function") {
    throw new TypeError("Reference Target fallback requires a browser with Shadow DOM and WeakRef");
  }
  if (onDiagnostic !== undefined && typeof onDiagnostic !== "function") {
    throw new TypeError("onDiagnostic must be a function");
  }
  if (hasOwn(realm, INSTALLATION_KEY)) {
    throw new Error("Reference Target fallback is already installed in this realm; dispose it first");
  }
  if (!selected.length) return inactiveHandle("inactive", selected, "No adapters selected");
  const nativeSurface = hasNativeReferenceTarget(realm);
  if (nativeSurface && !force) {
    const probe = probeReferenceTarget(realm);
    return inactiveHandle(probe.nullable && probe.labels ? "native-unverified" : "unsupported", selected,
      probe.nullable && probe.labels ? undefined : "Partial native implementation; fallback was not layered over it");
  }

  const document = realm.document;
  const prototype = realm.Element.prototype;
  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "attachShadow");
  const originalAttach = prototype.attachShadow;
  const nativeProperty = Object.getOwnPropertyDescriptor(realm.ShadowRoot.prototype, "referenceTarget");
  const shadowRootGetter = Object.getOwnPropertyDescriptor(prototype, "shadowRoot")?.get;
  const isConnectedGetter = Object.getOwnPropertyDescriptor(realm.Node.prototype, "isConnected")?.get;
  const nodeTypeGetter = Object.getOwnPropertyDescriptor(realm.Node.prototype, "nodeType")?.get;
  const getAttribute = prototype.getAttribute;
  const queries = {
    1: prototype.querySelectorAll,
    9: realm.Document.prototype.querySelectorAll,
    11: realm.DocumentFragment.prototype.querySelectorAll,
  };

  function report(code, detail) {
    if (!onDiagnostic) return;
    const seen = new Set();
    function publicDetail(value) {
      if (value instanceof realm.Node) {
        let node = value;
        let root = node.getRootNode();
        while (root.nodeType === 11 && root.host) {
          node = root.host;
          root = node.getRootNode();
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

  const statuses = Object.create(null);
  const supported = [];
  for (const adapter of selected) {
    if (adapter.check && !adapter.check(realm)) {
      statuses[adapter.id] = "unsupported";
      report("missing-primitive", { adapter: adapter.id });
    } else {
      supported.push(adapter);
    }
  }
  if (!supported.length) {
    return inactiveHandle("unsupported", selected, "No selected adapter is supported", statuses);
  }

  const records = new WeakMap();
  const excludedRoots = new WeakSet();
  const knownRoots = new Set();
  const rootRefs = new WeakMap();
  const scopes = new WeakMap();
  const subscribers = new Set();
  const runtimes = [];
  const handledEvents = new WeakSet();
  const noMetadata = {};
  const ownership = {};
  const enqueueMicrotask = typeof realm.queueMicrotask === "function"
    ? realm.queueMicrotask.bind(realm)
    : queueMicrotask;
  const finalizer = typeof realm.FinalizationRegistry === "function"
    ? new realm.FinalizationRegistry(ref => knownRoots.delete(ref))
    : null;
  let disposed = false;
  let scheduled = false;
  let refreshing = false;
  let connectedRootsSnapshot = null;
  let observerOptions = { subtree: true, childList: true };
  let wantsClick = false;
  let wantsSlotchange = false;
  let dirtyRuntimes = new Set();
  let pendingMutations = [];
  let pendingRoots = new Set();
  let pendingSources = new Set();
  let pendingFull = false;
  let pendingModel = false;
  let pendingReferenceTarget = false;
  let pendingSlotchange = false;
  let pendingSubscribers = false;

  function isConnected(node) {
    return isConnectedGetter ? isConnectedGetter.call(node) : node.isConnected;
  }

  function nodeType(node) {
    return nodeTypeGetter.call(node);
  }

  function descendants(container) {
    const query = container instanceof realm.Node ? queries[nodeType(container)] : null;
    if (!query) throw new TypeError("hydrate() requires an Element, Document, or ShadowRoot");
    return query.call(container, "*");
  }

  function removeRootRef(root) {
    const ref = rootRefs.get(root);
    if (!ref) return;
    rootRefs.delete(root);
    knownRoots.delete(ref);
    finalizer?.unregister(ref);
  }

  function collectRoots(includeDetached = false) {
    const result = [document];
    for (const ref of knownRoots) {
      const root = ref.deref();
      if (!root) {
        knownRoots.delete(ref);
        finalizer?.unregister(ref);
      } else if (includeDetached || isConnected(root.host)) {
        result.push(root);
      }
    }
    return result;
  }

  function roots(includeDetached = false) {
    if (refreshing && !includeDetached) {
      connectedRootsSnapshot ??= collectRoots(false);
      return connectedRootsSnapshot.slice();
    }
    return collectRoots(includeDetached);
  }

  function validateBooleanOption(observation, key, fallback, adapterId) {
    if (!hasOwn(observation, key)) return fallback;
    if (typeof observation[key] !== "boolean") {
      throw new TypeError(`Adapter ${adapterId} observation.${key} must be a boolean`);
    }
    return observation[key];
  }

  function normalizeObservation(adapter, runtime) {
    const declared = adapter.observation !== undefined;
    const observation = declared ? adapter.observation : {};
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new TypeError(`Adapter ${adapter.id} observation must be an object`);
    }
    let events;
    if (hasOwn(observation, "events")) {
      if (!Array.isArray(observation.events) || observation.events.some(event => event !== "click")) {
        throw new TypeError(`Adapter ${adapter.id} observation.events only supports "click"`);
      }
      events = new Set(observation.events);
    } else {
      events = new Set(typeof runtime.click === "function" ? ["click"] : []);
    }
    const refresh = validateBooleanOption(
      observation, "refresh", typeof runtime.refresh === "function", adapter.id,
    );
    let attributes = null;
    if (hasOwn(observation, "attributes")) {
      const value = observation.attributes;
      if (value !== null && (!Array.isArray(value) ||
          value.some(attribute => typeof attribute !== "string" || !attribute))) {
        throw new TypeError(`Adapter ${adapter.id} observation.attributes must be null or an array of names`);
      }
      attributes = value === null ? null : new Set(value);
    } else if (Array.isArray(adapter.attributes)) {
      attributes = new Set(adapter.attributes);
    }
    const automatic = refresh && typeof runtime.refresh === "function";
    return {
      automatic,
      attributes: automatic ? attributes : new Set(),
      characterData: automatic && validateBooleanOption(observation, "characterData", true, adapter.id),
      childList: automatic && validateBooleanOption(observation, "childList", true, adapter.id),
      slotchange: automatic && validateBooleanOption(observation, "slotchange", true, adapter.id),
      click: events.has("click") && typeof runtime.click === "function",
    };
  }

  function configureScope(root, state) {
    state.observer.observe(root, observerOptions);
    if (wantsClick !== state.click) {
      root[wantsClick ? "addEventListener" : "removeEventListener"]("click", click);
      state.click = wantsClick;
    }
    if (wantsSlotchange !== state.slotchange) {
      root[wantsSlotchange ? "addEventListener" : "removeEventListener"]("slotchange", slotchange);
      state.slotchange = wantsSlotchange;
    }
  }

  function recomputeInterests() {
    let observeAllAttributes = subscribers.size > 0;
    let observeCharacterData = subscribers.size > 0;
    let observeSlotchange = subscribers.size > 0;
    const attributeFilter = new Set();
    wantsClick = false;
    for (const entry of runtimes) {
      wantsClick ||= entry.observation?.click === true;
      if (!entry.observation?.automatic) continue;
      if (entry.observation.attributes === null) observeAllAttributes = true;
      else for (const attribute of entry.observation.attributes) attributeFilter.add(attribute);
      observeCharacterData ||= entry.observation.characterData;
      observeSlotchange ||= entry.observation.slotchange;
    }
    observerOptions = {
      subtree: true,
      childList: true,
      ...(observeAllAttributes
        ? { attributes: true }
        : attributeFilter.size
          ? { attributes: true, attributeFilter: [...attributeFilter] }
          : {}),
      ...(observeCharacterData ? { characterData: true } : {}),
    };
    wantsSlotchange = observeSlotchange;
    if (disposed) return;
    for (const root of collectRoots(true)) {
      const state = scopes.get(root);
      if (state) configureScope(root, state);
    }
  }

  function hasPendingWork() {
    return pendingFull || dirtyRuntimes.size > 0 || pendingSubscribers;
  }

  function scheduleFlush() {
    if (disposed || scheduled || !hasPendingWork()) return;
    scheduled = true;
    enqueueMicrotask(() => {
      scheduled = false;
      if (!disposed && hasPendingWork()) flush();
    });
  }

  function addMutationSources(mutations) {
    for (const mutation of mutations) {
      const target = nodeType(mutation.target) === 1 ? mutation.target : mutation.target.parentElement;
      if (target) pendingSources.add(target);
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) if (nodeType(node) === 1) pendingSources.add(node);
      for (const node of mutation.removedNodes) if (nodeType(node) === 1) pendingSources.add(node);
    }
  }

  function mutationInterests(entry, mutation) {
    const observation = entry.observation;
    if (!observation?.automatic) return false;
    if (mutation.type === "childList") return observation.childList;
    if (mutation.type === "characterData") return observation.characterData;
    return observation.attributes === null || observation.attributes.has(mutation.attributeName);
  }

  function discoverAddedSubtrees(mutations) {
    const candidates = new Set();
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        if (nodeType(node) === 1 && isConnected(node)) candidates.add(node);
      }
    }
    for (const candidate of candidates) {
      let nested = false;
      for (let parent = candidate.parentNode; parent; parent = parent.parentNode) {
        if (candidates.has(parent)) { nested = true; break; }
      }
      if (!nested) discover(candidate);
    }
  }

  function processMutations(root, mutations) {
    if (disposed || !mutations.length) return;
    if (root !== document && !isConnected(root.host)) return;
    discoverAddedSubtrees(mutations);
    let interested = subscribers.size > 0;
    for (const entry of runtimes) {
      if (mutations.some(mutation =>
        mutationInterests(entry, mutation) && !entry.runtime.ownsMutation?.(mutation))) {
        dirtyRuntimes.add(entry);
        interested = true;
      }
    }
    if (!interested) return;
    pendingMutations.push(...mutations);
    pendingRoots.add(root);
    addMutationSources(mutations);
    pendingSubscribers ||= subscribers.size > 0;
    scheduleFlush();
  }

  function observe(root) {
    if (scopes.has(root)) return;
    const observer = new realm.MutationObserver(mutations => processMutations(root, mutations));
    const state = { observer, click: false, slotchange: false };
    scopes.set(root, state);
    configureScope(root, state);
  }

  function unobserve(root) {
    const state = scopes.get(root);
    if (!state) return;
    state.observer.disconnect();
    if (state.click) root.removeEventListener("click", click);
    if (state.slotchange) root.removeEventListener("slotchange", slotchange);
    scopes.delete(root);
  }

  function markAutomaticChange({ root, source, referenceTarget = false, slot = false } = {}) {
    let interested = subscribers.size > 0;
    for (const entry of runtimes) {
      if (!entry.observation?.automatic || (slot && !entry.observation.slotchange)) continue;
      dirtyRuntimes.add(entry);
      interested = true;
    }
    if (!interested) return;
    if (root) pendingRoots.add(root);
    if (source) pendingSources.add(source);
    pendingReferenceTarget ||= referenceTarget;
    pendingSlotchange ||= slot;
    pendingSubscribers ||= subscribers.size > 0;
    scheduleFlush();
  }

  function requestFullRefresh(model = true) {
    pendingFull = true;
    pendingModel ||= model;
    pendingSubscribers ||= subscribers.size > 0;
    if (refreshing) scheduleFlush();
  }

  function click(event) {
    if (disposed || event.defaultPrevented || handledEvents.has(event)) return;
    handledEvents.add(event);
    const path = event.composedPath();
    const errors = [];
    for (const entry of runtimes) {
      if (!entry.observation.click) continue;
      try { if (entry.runtime.click(event, path)) break; }
      catch (error) { errors.push(error); }
    }
    if (errors.length) {
      try { report("activation-errors", { errors }); } catch {}
    }
  }

  function slotchange(event) {
    if (disposed) return;
    markAutomaticChange({ root: event.currentTarget, source: event.target, slot: true });
  }

  function captureRoot(root, options = {}, internal = {}) {
    if (disposed) throw new Error("This Reference Target installation has been disposed");
    if (!(root instanceof realm.ShadowRoot)) throw new TypeError("register() requires a ShadowRoot from this realm");
    excludedRoots.delete(root);
    let record = records.get(root.host);
    if (record) {
      if ("referenceTarget" in options) root.referenceTarget = options.referenceTarget;
      return record;
    }
    const own = Object.getOwnPropertyDescriptor(root, "referenceTarget");
    if (own && !own.configurable) throw new TypeError("Cannot capture a nonconfigurable referenceTarget property");
    const initial = targetString("referenceTarget" in options ? options.referenceTarget : root.referenceTarget);
    const originalNativeValue = nativeSurface && force
      ? (hasOwn(internal, "nativeValue") ? internal.nativeValue : nativeProperty?.get?.call(root))
      : undefined;
    const token = {};
    record = {
      root,
      referenceTarget: initial,
      own,
      originalNativeValue,
      token,
      metadataValue: hasOwn(internal, "metadataValue") ? initial : noMetadata,
      metadataEligible: internal.metadataEligible === true,
      applyingMetadata: false,
    };
    const getter = function () {
      if (this !== root) throw new TypeError("Illegal referenceTarget receiver");
      return record.referenceTarget;
    };
    const setter = function (value) {
      if (this !== root) throw new TypeError("Illegal referenceTarget receiver");
      const next = targetString(value);
      if (!record.applyingMetadata) {
        record.metadataValue = noMetadata;
        record.metadataEligible = false;
      }
      if (next !== record.referenceTarget) {
        record.referenceTarget = next;
        markAutomaticChange({ root, source: root.host, referenceTarget: true });
      }
    };
    Object.defineProperty(root, "referenceTarget", { configurable: true, enumerable: true, get: getter, set: setter });
    try {
      if (nativeSurface && force) nativeProperty?.set?.call(root, null);
    } catch (error) {
      const cleanupErrors = [];
      try {
        if (own) Object.defineProperty(root, "referenceTarget", own);
        else delete root.referenceTarget;
      } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      try {
        if (nativeSurface && force) nativeProperty?.set?.call(root, originalNativeValue);
      } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], "Reference Target root capture rollback failed", { cause: error });
      }
      throw error;
    }
    record.getter = getter;
    const rootRef = new realm.WeakRef(root);
    record.handle = Object.freeze({
      dispose() {
        const current = rootRef.deref();
        if (current && records.get(current.host)?.token === token) unregister(current);
      },
    });
    records.set(root.host, record);
    knownRoots.add(rootRef);
    rootRefs.set(root, rootRef);
    finalizer?.register(root, rootRef, rootRef);
    observe(root);
    if (internal.notify !== false) {
      markAutomaticChange({ root, source: root.host, referenceTarget: true });
    }
    return record;
  }

  function register(root, options = {}) {
    const record = captureRoot(root, options);
    discover(root, false, false);
    return record.handle;
  }

  function unregister(root) {
    const record = records.get(root.host);
    if (!record) return;
    unobserve(root);
    records.delete(root.host);
    excludedRoots.add(root);
    removeRootRef(root);
    const errors = [];
    if (Object.getOwnPropertyDescriptor(root, "referenceTarget")?.get === record.getter) {
      try {
        if (record.own) Object.defineProperty(root, "referenceTarget", record.own);
        else delete root.referenceTarget;
      } catch (error) { errors.push(error); }
    }
    if (nativeSurface && force) {
      try { nativeProperty?.set?.call(root, record.originalNativeValue); }
      catch (error) { errors.push(error); }
    }
    markAutomaticChange({ root, source: root.host, referenceTarget: true });
    if (errors.length) throw new AggregateError(errors, "Errors while unregistering a Reference Target root");
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
    if (!host) host = byId(source.getRootNode(), getAttribute.call(source, attribute));
    return { host, target: resolveTarget(host), forwarded: isForwarded(host) };
  }

  function openShadowRoot(element) {
    if (!(element instanceof realm.Element)) return null;
    const root = shadowRootGetter ? shadowRootGetter.call(element) : element.shadowRoot;
    return root instanceof realm.ShadowRoot && root.host === element ? root : null;
  }

  function reconcileMetadata(record, host) {
    const value = getAttribute.call(host, "data-reference-target");
    if (record.metadataValue === noMetadata && !(value !== null && record.metadataEligible)) return;
    if (value === null) {
      if (record.metadataValue === noMetadata) return;
      record.applyingMetadata = true;
      try { record.root.referenceTarget = null; }
      finally { record.applyingMetadata = false; }
      record.metadataValue = noMetadata;
      record.metadataEligible = true;
      return;
    }
    record.applyingMetadata = true;
    try { record.root.referenceTarget = value; }
    finally { record.applyingMetadata = false; }
    record.metadataValue = value;
    record.metadataEligible = false;
  }

  function discover(container, metadata = false, notify) {
    if (disposed) return;
    const stack = [container];
    const visitedRoots = new Set(container instanceof realm.ShadowRoot ? [container] : []);
    function inspect(element) {
      if (!(element instanceof realm.Element)) return;
      const existing = records.get(element);
      const root = existing?.root ?? openShadowRoot(element);
      if (!(root instanceof realm.ShadowRoot) || root.host !== element || excludedRoots.has(root)) return;
      try {
        if (!existing) {
          const value = metadata ? getAttribute.call(element, "data-reference-target") : null;
          const options = value === null ? {} : { referenceTarget: value };
          const captured = captureRoot(root, options, {
            notify: notify !== null,
            metadataEligible: value === null,
            ...(value === null ? {} : { metadataValue: value }),
          });
          if (metadata) reconcileMetadata(captured, element);
        } else if (metadata) reconcileMetadata(existing, element);
      } catch (error) {
        if (notify != null) throw error;
        try { report("root-discovery-error", { host: element, error }); } catch {}
      }
      if (!visitedRoots.has(root)) {
        visitedRoots.add(root);
        stack.push(root);
      }
    }
    while (stack.length) {
      const current = stack.pop();
      const elements = descendants(current);
      if (nodeType(current) === 1) inspect(current);
      for (const element of elements) inspect(element);
    }
  }

  function drainObserverRecords() {
    for (const root of collectRoots(true)) {
      const state = scopes.get(root);
      if (!state) continue;
      const mutations = state.observer.takeRecords();
      if (mutations.length) processMutations(root, mutations);
    }
  }

  function refresh() {
    if (disposed) return;
    drainObserverRecords();
    requestFullRefresh(true);
    if (!refreshing) flush(true);
  }

  function flush(throwErrors = false) {
    if (disposed || refreshing || !hasPendingWork()) return;
    const full = pendingFull;
    const entries = full
      ? runtimes.filter(entry => typeof entry.runtime.refresh === "function")
      : [...dirtyRuntimes];
    const callbacks = full || pendingSubscribers ? [...subscribers] : [];
    const change = full ? undefined : Object.freeze({
      full: false,
      model: pendingModel,
      referenceTarget: pendingReferenceTarget,
      slotchange: pendingSlotchange,
      roots: pendingRoots,
      sources: pendingSources,
      mutations: Object.freeze(pendingMutations.slice()),
    });
    dirtyRuntimes = new Set();
    pendingMutations = [];
    pendingRoots = new Set();
    pendingSources = new Set();
    pendingFull = false;
    pendingModel = false;
    pendingReferenceTarget = false;
    pendingSlotchange = false;
    pendingSubscribers = false;
    refreshing = true;
    connectedRootsSnapshot = null;
    const errors = [];
    try {
      for (const entry of entries) {
        try { entry.runtime.refresh(change); }
        catch (error) { errors.push(error); }
      }
      for (const callback of callbacks) {
        if (!subscribers.has(callback)) continue;
        try { callback(change); }
        catch (error) { errors.push(error); }
      }
    } finally {
      connectedRootsSnapshot = null;
      refreshing = false;
      if (hasPendingWork()) scheduleFlush();
    }
    if (errors.length) {
      try { report("refresh-errors", { errors }); }
      catch (error) { errors.push(error); }
      if (throwErrors) throw new AggregateError(errors, "Errors while refreshing Reference Target adapters");
    }
  }

  function wrappedAttachShadow(init) {
    if (disposed) return Reflect.apply(originalAttach, this, arguments);
    const initial = targetString(init?.referenceTarget);
    const nativeInit = nativeSurface && force && init && (typeof init === "object" || typeof init === "function")
      ? new Proxy(Object.create(null), { get(_target, key) { return key === "referenceTarget" ? null : Reflect.get(init, key, init); } })
      : init;
    const root = Reflect.apply(originalAttach, this, [nativeInit]);
    captureRoot(root, { referenceTarget: initial }, { nativeValue: initial });
    return root;
  }

  const context = Object.freeze({
    window: realm, document, resolveTarget, resolveReference, isForwarded, roots,
    report,
    onChange(callback) {
      if (typeof callback !== "function") throw new TypeError("onChange requires a callback");
      subscribers.add(callback);
      recomputeInterests();
      return () => {
        if (subscribers.delete(callback)) recomputeInterests();
      };
    },
  });
  const handle = Object.freeze({
    get mode() { return disposed ? "disposed" : "fallback"; },
    get reason() { return disposed ? "Installation disposed" : undefined; },
    get statuses() {
      const result = { ...statuses };
      if (disposed) {
        for (const id of Object.keys(result)) if (result[id] === "fallback") result[id] = "disposed";
      }
      return Object.freeze(result);
    },
    get activeAdapters() {
      return Object.freeze(disposed ? [] : Object.keys(statuses).filter(id => statuses[id] === "fallback"));
    },
    register,
    hydrate(container = document) {
      if (disposed) return;
      discover(container, true, false);
      requestFullRefresh(true);
      if (!refreshing) flush(true);
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      const cleanup = callback => { try { callback(); } catch (error) { errors.push(error); } };
      for (const entry of [...runtimes].reverse()) cleanup(() => entry.runtime.dispose?.());
      for (const root of collectRoots(true)) {
        if (root === document) unobserve(root);
        else cleanup(() => unregister(root));
      }
      subscribers.clear();
      knownRoots.clear();
      if (prototype.attachShadow === wrappedAttachShadow) {
        cleanup(() => {
          if (originalDescriptor) Object.defineProperty(prototype, "attachShadow", originalDescriptor);
          else delete prototype.attachShadow;
        });
      }
      cleanup(() => {
        if (Object.getOwnPropertyDescriptor(realm, INSTALLATION_KEY)?.value === ownership) {
          delete realm[INSTALLATION_KEY];
        }
      });
      if (errors.length) throw new AggregateError(errors, "Errors while disposing Reference Target adapters");
    },
  });

  try {
    Object.defineProperty(realm, INSTALLATION_KEY, {
      configurable: true, enumerable: false, value: ownership,
    });
    Object.defineProperty(prototype, "attachShadow", {
      ...(originalDescriptor ?? { configurable: true, enumerable: false, writable: true }),
      value: wrappedAttachShadow,
    });
    for (const adapter of supported) {
      const runtime = adapter.install(context) ?? {};
      if (typeof runtime.then === "function") throw new TypeError("Adapter installation must be synchronous");
      for (const method of ["click", "refresh", "ownsMutation", "dispose"]) {
        if (runtime[method] !== undefined && typeof runtime[method] !== "function") {
          throw new TypeError(`Adapter ${adapter.id} runtime.${method} must be a function`);
        }
      }
      const entry = { adapter, runtime, observation: null };
      runtimes.push(entry);
      entry.observation = normalizeObservation(adapter, runtime);
      statuses[adapter.id] = "fallback";
    }
    recomputeInterests();
    observe(document);
    discover(document, false, null);
    requestFullRefresh(false);
    flush(true);
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
