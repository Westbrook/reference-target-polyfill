const originalAttachShadow = Element.prototype.attachShadow;
const originalReferenceTarget = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "referenceTarget");
const statusElement = document.querySelector("#status");
const resultsElement = document.querySelector("#results");
const fixtureContainer = document.querySelector("#fixtures");
const environment = {
  userAgent: navigator.userAgent,
  nativeReferenceTarget: "referenceTarget" in ShadowRoot.prototype,
  startedAt: new Date().toISOString(),
};
document.querySelector("#user-agent").textContent = environment.userAgent;
document.querySelector("#native-reference-target").textContent = environment.nativeReferenceTarget ? "Present" : "Absent";
const tests = [];
const results = [];
const asynchronousErrors = [];
let sequence = 0;

window.addEventListener("error", (event) => {
  asynchronousErrors.push(event.error ?? new Error(event.message));
});
window.addEventListener("unhandledrejection", (event) => {
  asynchronousErrors.push(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
});

function assert(condition, message = "Expected a truthy value") {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message = "Values differ") {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function equalElements(actual, expected, message = "Element references differ") {
  assert(actual != null, `${message}: actual list is null`);
  equal(actual.length, expected.length, `${message}: length`);
  Array.from(actual).forEach((element, index) => equal(element, expected[index], `${message}: index ${index}`));
}

function throws(callback, pattern = /./) {
  let caught;
  try { callback(); } catch (error) { caught = error; }
  assert(caught, "Expected a thrown error");
  assert(pattern.test(String(caught)), `Unexpected error: ${caught}`);
}

function requirePrimitive(condition, explanation) {
  if (!condition) {
    const error = new Error(explanation);
    error.name = "SkipTest";
    throw error;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const test = (name, callback) => tests.push({ name, callback });
const uniqueId = (prefix = "test") => `${prefix}-${++sequence}`;

function element(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function shadow(fixture, { target = "target", mode = "closed", tag = "div" } = {}) {
  const host = element("div", { id: uniqueId("host") });
  fixture.append(host);
  const root = host.attachShadow({ mode, referenceTarget: target });
  const internal = element(tag, { id: "target" });
  root.append(internal);
  return { host, root, internal };
}

function invoker(fixture, host, attributes = {}) {
  const button = element("button", { type: "button", ...attributes });
  if (host && !button.hasAttribute("commandfor") && !button.hasAttribute("popovertarget")) {
    button.setAttribute("popovertarget", host.id);
  }
  fixture.append(button);
  return button;
}

function syntheticClick(node) {
  const event = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 0 });
  node.dispatchEvent(event);
  return event;
}

function instrument() {
  let context;
  return {
    adapter: { id: "test-observer", install(value) { context = value; } },
    get context() { return context; },
  };
}

async function iframeRealm(fixture) {
  const frame = element("iframe", { src: "about:blank", title: "Isolated feature detection test" });
  const ready = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  fixture.append(frame);
  await ready;
  return frame.contentWindow;
}

async function nativeTestRealm(fixture) {
  const realm = await iframeRealm(fixture);
  const prototype = realm.ShadowRoot.prototype;
  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "referenceTarget");
  const originalAttach = realm.Element.prototype.attachShadow;
  let dictionaryValue;
  if (!originalDescriptor) {
    // This isolated mock supplies the native dictionary read and backing slot
    // needed for force-mode tests on engines without Reference Target.
    const backing = new WeakMap();
    Object.defineProperty(prototype, "referenceTarget", {
      configurable: true,
      get() { return backing.get(this) ?? null; },
      set(value) { backing.set(this, value == null ? null : String(value)); },
    });
    const property = Object.getOwnPropertyDescriptor(prototype, "referenceTarget");
    realm.Element.prototype.attachShadow = function (options) {
      dictionaryValue = options.referenceTarget;
      const root = Reflect.apply(originalAttach, this, [options]);
      property.set.call(root, dictionaryValue);
      return root;
    };
  }
  const property = Object.getOwnPropertyDescriptor(prototype, "referenceTarget");
  return {
    realm,
    mocked: !originalDescriptor,
    get dictionaryValue() { return dictionaryValue; },
    nativeValue(root) { return property.get.call(root); },
    restore() {
      realm.Element.prototype.attachShadow = originalAttach;
      if (originalDescriptor) Object.defineProperty(prototype, "referenceTarget", originalDescriptor);
      else delete prototype.referenceTarget;
    },
  };
}

async function scenarioPage(fixture, mode = "fallback") {
  const url = new URL("../examples/scenarios/", import.meta.url);
  url.searchParams.set("mode", mode);
  const frame = element("iframe", { src: url.href, title: `Companion scenarios in ${mode} mode` });
  const page = await new Promise((resolve, reject) => {
    let observer;
    const timer = setTimeout(() => finish(new Error(`Companion page did not become ready within 10 seconds (${mode} mode)`)), 10000);

    function finish(error) {
      clearTimeout(timer);
      observer?.disconnect();
      frame.removeEventListener("load", loaded);
      frame.removeEventListener("error", failed);
      if (error) reject(error);
      else resolve({ frame, realm: frame.contentWindow, document: frame.contentDocument });
    }

    function failed() {
      finish(new Error(`Failed to load companion page (${mode} mode)`));
    }

    function check() {
      const document = frame.contentDocument;
      if (document.documentElement.dataset.referenceTargetMode === "error") {
        finish(new Error(`Companion setup failed: ${document.querySelector("#mode-status")?.textContent}`));
      } else if (document.querySelector("#ready-status")?.dataset.ready === "true") {
        finish();
      }
    }

    function loaded() {
      // Ignore any initial about:blank load; inspect the actual application.
      if (frame.contentWindow.location.pathname !== url.pathname) return;
      observer?.disconnect();
      observer = new MutationObserver(check);
      observer.observe(frame.contentDocument.documentElement, {
        attributes: true,
        attributeFilter: ["data-ready", "data-reference-target-mode"],
        childList: true,
        subtree: true,
      });
      check();
    }

    frame.addEventListener("load", loaded);
    frame.addEventListener("error", failed);
    fixture.append(frame);
  });

  equal(page.document.documentElement.dataset.referenceTargetMode, mode, "The companion reports its actual installation mode");
  equal(page.document.querySelector("#ready-status")?.dataset.ready, "true");
  assert(page.document.querySelector("#ready-status")?.textContent.trim(), "Readiness must have a visible status");
  assert(page.document.querySelector("#mode-status")?.textContent.toLowerCase().includes(mode), "The visible mode must agree with the public mode marker");
  assert(page.document.querySelector("#surface-status")?.textContent.trim(), "Native surface detection must have a visible status");
  return page;
}

function scenarioRoot(page, hostID) {
  requirePrimitive("shadowRootMode" in page.realm.HTMLTemplateElement.prototype, "Declarative shadow DOM unavailable");
  const host = page.document.getElementById(hostID);
  assert(host, `Companion host #${hostID} is missing`);
  assert(host.shadowRoot, `Companion host #${hostID} has no parsed declarative shadow root`);
  return host.shadowRoot;
}

function assertNoNodes(value, seen = new Set()) {
  assert(!(value instanceof Node), "Diagnostics must not expose a live DOM node");
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) assertNoNodes(child, seen);
  }
}

async function run() {
  // Capturing the native methods before importing verifies the side-effect-free entry points.
  const [core, detection, popoverModule, dialogModule, commandModule, labelModule, textModule] = await Promise.all([
    import("../src/core.js"),
    import("../src/detect.js"),
    import("../src/adapters/popover-targets.js"),
    import("../src/adapters/dialog-commands.js"),
    import("../src/adapters/popover-commands.js"),
    import("../src/adapters/labels.js"),
    import("../src/adapters/text-names.js"),
  ]);
  const { installReferenceTarget } = core;
  const { popoverTargets } = popoverModule;
  const { dialogCommands } = dialogModule;
  const { popoverCommands } = commandModule;
  const { labels } = labelModule;
  const { textNames } = textModule;

  test("Importing every entry point has no global installation effects", () => {
    equal(Element.prototype.attachShadow, originalAttachShadow);
    const current = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "referenceTarget");
    equal(current?.get, originalReferenceTarget?.get);
    equal(current?.set, originalReferenceTarget?.set);
    equal(detection.hasNativeReferenceTarget(), !!originalReferenceTarget);
  });

  test("Selecting no adapters leaves attachShadow unchanged", ({ install }) => {
    const handle = install([]);
    equal(handle.mode, "inactive");
    equal(handle.activeAdapters.length, 0);
    equal(Element.prototype.attachShadow, originalAttachShadow);
  });

  test("A native surface is probed without wrapping or installing adapters", async ({ fixture, install }) => {
    const realm = await iframeRealm(fixture);
    requirePrimitive(detection.hasNativeReferenceTarget(realm), "This browser has no native Reference Target surface");
    const original = realm.Element.prototype.attachShadow;
    const probe = detection.probeReferenceTarget(realm);
    let installed = false;
    const handle = install([{ id: "native-bypass", install() { installed = true; } }], { realm, force: false });
    const expected = probe.nullable && probe.labels ? "native" : "unsupported";
    equal(handle.mode, expected);
    equal(handle.statuses["native-bypass"], expected);
    equal(handle.activeAdapters.length, 0);
    equal(installed, false);
    equal(realm.Element.prototype.attachShadow, original);
    handle.dispose();
    equal(realm.Element.prototype.attachShadow, original);
    equal(Element.prototype.attachShadow, originalAttachShadow, "An iframe probe must not patch the parent realm");
  });

  test("A partial prototype surface is refused without wrapping or installing adapters", async ({ fixture, install }) => {
    const realm = await iframeRealm(fixture);
    const original = realm.Element.prototype.attachShadow;
    const prototype = realm.ShadowRoot.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "referenceTarget");
    requirePrimitive(!descriptor || descriptor.configurable, "Native surface cannot be replaced in this isolated test realm");
    try {
      Object.defineProperty(prototype, "referenceTarget", {
        configurable: true,
        get() { return ""; },
        set() {},
      });
      assert(detection.hasNativeReferenceTarget(realm));
      let installed = false;
      const handle = install([{ id: "partial-bypass", install() { installed = true; } }], { realm, force: false });
      equal(handle.mode, "unsupported");
      equal(handle.statuses["partial-bypass"], "unsupported");
      equal(handle.activeAdapters.length, 0);
      equal(installed, false);
      equal(realm.Element.prototype.attachShadow, original);
      assert(/partial/i.test(handle.reason), "The refusal must explain partial native support");
      handle.dispose();
    } finally {
      if (descriptor) Object.defineProperty(prototype, "referenceTarget", descriptor);
      else delete prototype.referenceTarget;
    }
    equal(realm.Element.prototype.attachShadow, original);
    equal(Element.prototype.attachShadow, originalAttachShadow);
  });

  test("Duplicate adapters and invalid options fail before patching globals", () => {
    const adapter = { id: "duplicate", install() {} };
    throws(() => installReferenceTarget({ adapters: [adapter, adapter], force: true }), /Duplicate/);
    throws(() => installReferenceTarget({ adapters: [null], force: true }), /adapter/i);
    throws(() => installReferenceTarget({ adapters: [adapter], force: true, onDiagnostic: true }), /onDiagnostic/);
    equal(Element.prototype.attachShadow, originalAttachShadow);
  });

  test("Installation is synchronous, scoped to one realm, and retryable after disposal", ({ fixture, install }) => {
    const observer = instrument();
    const handle = install([observer.adapter]);
    equal(handle.mode, "fallback");
    equal(handle.statuses[observer.adapter.id], "fallback");
    equal(handle.activeAdapters.join(","), observer.adapter.id);
    const { root } = shadow(fixture);
    equal(root.referenceTarget, "target", "Root is configured before attachShadow returns");
    throws(() => installReferenceTarget({ adapters: [observer.adapter], force: true }), /already installed/);
    handle.dispose();
    equal(Element.prototype.attachShadow, originalAttachShadow);
    equal(install([observer.adapter]).mode, "fallback");
  });

  test("Captured roots get their own accessor without changing ShadowRoot.prototype", ({ fixture, install }) => {
    const observer = instrument();
    install([observer.adapter]);
    const { root, host, internal } = shadow(fixture);
    equal(host.shadowRoot, null, "Closed roots remain closed");
    const own = Object.getOwnPropertyDescriptor(root, "referenceTarget");
    equal(typeof own?.get, "function");
    equal(typeof own?.set, "function");
    equal(Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "referenceTarget")?.get, originalReferenceTarget?.get);
    equal(observer.context.resolveTarget(host), internal);
    root.referenceTarget = undefined;
    equal(root.referenceTarget, null);
    root.referenceTarget = 3;
    equal(root.referenceTarget, "3");
    throws(() => { root.referenceTarget = Symbol("target"); }, /Symbol/);
  });

  test("Frozen attachShadow options retain their native dictionary behavior", async ({ fixture, install }) => {
    const native = await nativeTestRealm(fixture);
    const { realm } = native;
    const observer = instrument();
    let handle;
    try {
      handle = install([observer.adapter], { realm });
      const host = realm.document.createElement("div");
      realm.document.body.append(host);
      const options = Object.freeze({ mode: "closed", referenceTarget: "control", delegatesFocus: true });
      const root = host.attachShadow(options);
      const control = realm.document.createElement("input");
      control.id = "control";
      root.append(control);
      equal(root.mode, "closed");
      equal(root.delegatesFocus, true);
      equal(root.referenceTarget, "control");
      equal(observer.context.resolveTarget(host), control);
      equal(options.referenceTarget, "control", "Installation must not modify the caller's options");
      equal(native.nativeValue(root), null, "Force mode keeps native forwarding disabled");
      if (native.mocked) equal(native.dictionaryValue, null, "Force mode suppresses forwarding in the simulated native consumer");
    } finally {
      handle?.dispose();
      native.restore();
    }
  });

  test("Failed registration of a nonextensible root preserves its native backing value", async ({ fixture, install }) => {
    const native = await nativeTestRealm(fixture);
    const { realm } = native;
    let handle;
    try {
      const host = realm.document.createElement("div");
      realm.document.body.append(host);
      const root = host.attachShadow({ mode: "closed", referenceTarget: "native-control" });
      Object.preventExtensions(root);
      const observer = instrument();
      handle = install([observer.adapter], { realm });
      equal(native.nativeValue(root), "native-control");
      throws(() => handle.register(root, { referenceTarget: "fallback-control" }), /TypeError/);
      equal(native.nativeValue(root), "native-control", "Failed capture must not clear native forwarding");
      equal(Object.getOwnPropertyDescriptor(root, "referenceTarget"), undefined);
      equal(observer.context.resolveTarget(host), host);
    } finally {
      handle?.dispose();
      native.restore();
    }
  });

  test("Disposal restores both an authored own property and its original native backing value", async ({ fixture, install }) => {
    const native = await nativeTestRealm(fixture);
    const { realm } = native;
    let handle;
    try {
      const host = realm.document.createElement("div");
      realm.document.body.append(host);
      const root = host.attachShadow({ mode: "closed", referenceTarget: "native-control" });
      Object.defineProperty(root, "referenceTarget", { configurable: true, writable: true, value: "authored-property" });
      handle = install([instrument().adapter], { realm });
      const registration = handle.register(root, { referenceTarget: "fallback-control" });
      equal(native.nativeValue(root), null);
      root.referenceTarget = "updated-fallback-control";
      registration.dispose();
      equal(root.referenceTarget, "authored-property");
      equal(native.nativeValue(root), "native-control");
      const restored = Object.getOwnPropertyDescriptor(root, "referenceTarget");
      equal(restored.value, "authored-property");
      equal(restored.writable, true);
      equal(restored.enumerable, false);
    } finally {
      handle?.dispose();
      native.restore();
    }
  });

  test("Null, empty, and missing target IDs have distinct behavior", ({ fixture, install }) => {
    const observer = instrument();
    install([observer.adapter]);
    const { host, root, internal } = shadow(fixture);
    equal(observer.context.resolveTarget(host), internal);
    root.referenceTarget = null;
    equal(observer.context.resolveTarget(host), host);
    equal(observer.context.isForwarded(host), false);
    root.referenceTarget = "";
    equal(observer.context.resolveTarget(host), null);
    equal(observer.context.isForwarded(host), true);
    root.referenceTarget = "missing";
    equal(observer.context.resolveTarget(host), null);
  });

  test("Nested targets resolve live IDs and the first duplicate in each shadow tree", ({ fixture, install }) => {
    const observer = instrument();
    install([observer.adapter]);
    const outer = shadow(fixture);
    const middle = outer.internal;
    const innerRoot = middle.attachShadow({ mode: "closed", referenceTarget: "deep" });
    const first = element("input", { id: "deep" });
    const second = element("input", { id: "deep" });
    innerRoot.append(first, second);
    equal(observer.context.resolveTarget(outer.host), first);
    first.id = "renamed";
    equal(observer.context.resolveTarget(outer.host), second);
    second.remove();
    equal(observer.context.resolveTarget(outer.host), null);
    innerRoot.referenceTarget = null;
    equal(observer.context.resolveTarget(outer.host), middle);
  });

  test("IDREF lookup stays in the referring tree and honors its first duplicate", ({ fixture, install }) => {
    const observer = instrument();
    install([observer.adapter]);
    const outer = shadow(fixture, { target: null });
    const global = element("div", { id: "scoped-reference" });
    fixture.append(global);
    const localFirst = element("div", { id: "scoped-reference" });
    const localSecond = element("div", { id: "scoped-reference" });
    const source = element("button", { popovertarget: "scoped-reference" });
    outer.root.append(localFirst, localSecond, source);
    equal(observer.context.resolveReference(source, "popovertarget").host, localFirst);
    localFirst.remove();
    equal(observer.context.resolveReference(source, "popovertarget").host, localSecond);
    localSecond.remove();
    equal(observer.context.resolveReference(source, "popovertarget").host, null, "A string IDREF cannot escape its tree");
  });

  test("Explicit references support ancestor trees but reject sibling shadow trees", ({ fixture, install }) => {
    const observer = instrument();
    install([observer.adapter]);
    const first = shadow(fixture, { target: null });
    const second = shadow(fixture, { target: null });
    const source = element("button");
    first.root.append(source);
    // An ordinary property exposes the resolver's scope contract independently
    // of any engine's own filtering of a reflected native property.
    source.testReferenceElement = second.host;
    equal(observer.context.resolveReference(source, "test-reference", "testReferenceElement").target, second.host);
    source.testReferenceElement = second.internal;
    equal(observer.context.resolveReference(source, "test-reference", "testReferenceElement").target, null);
  });

  test("Explicit registration captures an existing closed root and restores an authored property", ({ fixture, install }) => {
    const host = element("div");
    fixture.append(host);
    const root = host.attachShadow({ mode: "closed" });
    Object.defineProperty(root, "referenceTarget", { configurable: true, writable: true, value: "authored" });
    const observer = instrument();
    const handle = install([observer.adapter]);
    const registration = handle.register(root, { referenceTarget: "control" });
    const control = element("input", { id: "control" });
    root.append(control);
    equal(observer.context.resolveTarget(host), control);
    registration.dispose();
    equal(root.referenceTarget, "authored");
    equal(observer.context.resolveTarget(host), host);
  });

  test("Disposed open-root registrations stay excluded until explicitly registered again", async ({ fixture, install }) => {
    const observer = instrument();
    const handle = install([observer.adapter]);
    const { host, root, internal } = shadow(fixture, { mode: "open" });
    const first = handle.register(root);
    first.dispose();
    handle.refresh();
    equal(observer.context.isForwarded(host), false);
    equal(observer.context.resolveTarget(host), host);
    equal(Object.getOwnPropertyDescriptor(root, "referenceTarget"), undefined);
    host.dataset.referenceTarget = "target";
    handle.hydrate(host);
    equal(observer.context.isForwarded(host), false, "Hydration must respect explicit registration disposal");
    host.remove();
    fixture.append(host);
    await tick();
    equal(observer.context.isForwarded(host), false, "Mutation discovery must not recapture an excluded open root");
    const second = handle.register(root, { referenceTarget: "target" });
    equal(observer.context.resolveTarget(host), internal);
    first.dispose();
    equal(observer.context.resolveTarget(host), internal, "A stale registration handle must not dispose its replacement");
    second.dispose();
    handle.refresh();
    equal(observer.context.isForwarded(host), false);
  });

  test("Public diagnostics contain metadata and never expose private shadow nodes", ({ fixture, install }) => {
    const diagnostics = [];
    const observer = instrument();
    install([observer.adapter], { onDiagnostic: (entry) => diagnostics.push(entry) });
    const outer = shadow(fixture);
    const nestedRoot = outer.internal.attachShadow({ mode: "closed" });
    const privateControl = element("input", { id: "private-diagnostic-control" });
    const privateText = document.createTextNode("private diagnostic text");
    nestedRoot.append(privateControl, privateText);
    const detail = {
      host: outer.host,
      target: privateControl,
      nested: [nestedRoot, privateText],
      error: new DOMException("Test state", "InvalidStateError"),
    };
    detail.cycle = detail;
    observer.context.report("diagnostic-test", detail);
    equal(diagnostics.length, 1);
    const diagnostic = diagnostics[0];
    equal(diagnostic.code, "diagnostic-test");
    assertNoNodes(diagnostic);
    equal(diagnostic.detail.target.id, outer.host.id, "Private nodes should be described by their public outer host");
    equal(diagnostic.detail.nested[0].id, outer.host.id);
    equal(diagnostic.detail.nested[1].id, outer.host.id);
    equal(diagnostic.detail.error.name, "InvalidStateError");
    const serialized = JSON.stringify(diagnostic);
    assert(!serialized.includes(privateControl.id));
    assert(!serialized.includes(privateText.data));
  });

  test("Hydration reads surviving metadata and property changes schedule refresh", async ({ fixture, install }) => {
    const host = element("div", { "data-reference-target": "target" });
    fixture.append(host);
    const root = host.attachShadow({ mode: "open" });
    const control = element("input", { id: "target" });
    root.append(control);
    const observer = instrument();
    const handle = install([observer.adapter]);
    handle.hydrate(fixture);
    equal(root.referenceTarget, "target");
    equal(observer.context.resolveTarget(host), control);
    let notifications = 0;
    observer.context.onChange(() => notifications++);
    await tick();
    const before = notifications;
    root.referenceTarget = null;
    await tick();
    assert(notifications > before, "A property-only update must schedule adapter refresh");
  });

  test("A reentrant refresh request schedules another pass for model-only changes", async ({ install }) => {
    let model = 0;
    let armed = false;
    let handle;
    const observed = [];
    handle = install([{
      id: "reentrant-refresh",
      install() {
        return {
          refresh() {
            observed.push(model);
            if (armed && model === 1) {
              model = 2;
              handle.refresh();
            }
          },
        };
      },
    }]);
    await tick();
    const before = observed.length;
    armed = true;
    model = 1;
    handle.refresh();
    await tick();
    equal(observed.slice(before).join(","), "1,2", "The second pass must run even without a DOM mutation");
  });

  test("Failed adapter installation disposes earlier adapters and permits a clean retry", ({ install }) => {
    let cleaned = false;
    const first = { id: "first", install() { return { dispose() { cleaned = true; } }; } };
    const failing = { id: "failing", install() { throw new Error("fixture failure"); } };
    throws(() => installReferenceTarget({ adapters: [first, failing], force: true }), /fixture failure/);
    assert(cleaned, "Already installed adapters must be cleaned up");
    equal(Element.prototype.attachShadow, originalAttachShadow);
    equal(install([instrument().adapter]).mode, "fallback");
  });

  test("Rollback continues after a cleanup error and preserves the original installation failure", ({ fixture, install }) => {
    const failure = new Error("Original installation failure");
    const cleanupFailure = new Error("Cleanup failure");
    let root;
    const first = {
      id: "cleanup-error",
      install() {
        const host = element("div");
        fixture.append(host);
        root = host.attachShadow({ mode: "closed", referenceTarget: "control" });
        return { dispose() { throw cleanupFailure; } };
      },
    };
    const second = { id: "install-error", install() { throw failure; } };
    let caught;
    try {
      installReferenceTarget({ adapters: [first, second], force: true });
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof AggregateError);
    equal(caught.cause, failure);
    assert(caught.errors.includes(failure));
    assert(caught.errors.some((error) => error === cleanupFailure || error.errors?.includes(cleanupFailure)));
    equal(Element.prototype.attachShadow, originalAttachShadow);
    equal(Object.getOwnPropertyDescriptor(root, "referenceTarget"), undefined);
    equal(install([instrument().adapter]).mode, "fallback", "Cleanup errors must not leave a stale realm installation");
  });

  test("Unsupported primitives are reported and asynchronous adapter installation is rejected", ({ install }) => {
    const diagnostics = [];
    const missing = { id: "missing", check: () => false, install() { throw new Error("Must not install"); } };
    const handle = install([missing], { onDiagnostic: (entry) => diagnostics.push(entry) });
    equal(handle.statuses.missing, "unsupported");
    equal(handle.activeAdapters.length, 0);
    assert(diagnostics.some((entry) => entry.code === "missing-primitive"));
    handle.dispose();
    throws(() => installReferenceTarget({ adapters: [{ id: "async", install: async () => ({}) }], force: true }), /synchronous/);
    equal(Element.prototype.attachShadow, originalAttachShadow);
  });

  test("Disposal preserves later attachShadow wrappers and they remain callable", ({ fixture, install }) => {
    const handle = install([instrument().adapter]);
    const installed = Element.prototype.attachShadow;
    let calls = 0;
    function laterWrapper(...args) {
      calls++;
      return Reflect.apply(installed, this, args);
    }
    Element.prototype.attachShadow = laterWrapper;
    try {
      handle.dispose();
      equal(Element.prototype.attachShadow, laterWrapper);
      const host = element("div");
      fixture.append(host);
      assert(host.attachShadow({ mode: "open" }) instanceof ShadowRoot);
      equal(calls, 1);
    } finally {
      Element.prototype.attachShadow = originalAttachShadow;
    }
  });

  test("Popover targets toggle once, support show/hide, and use current target IDs", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    install([popoverTargets()]);
    const { host, root, internal } = shadow(fixture);
    internal.setAttribute("popover", "manual");
    const button = invoker(fixture, host);
    button.click();
    assert(internal.matches(":popover-open"));
    button.click();
    assert(!internal.matches(":popover-open"), "One activation must toggle only once");
    button.setAttribute("popovertargetaction", "SHOW");
    button.click();
    button.click();
    assert(internal.matches(":popover-open"));
    button.setAttribute("popovertargetaction", "hide");
    button.click();
    assert(!internal.matches(":popover-open"));
    root.referenceTarget = "missing";
    button.click();
    assert(!internal.matches(":popover-open"));
    root.referenceTarget = "target";
    button.setAttribute("popovertargetaction", "invalid-value");
    button.click();
    assert(internal.matches(":popover-open"), "Invalid action defaults to toggle");
  });

  test("Popover target IDL references work without a host ID", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function" && "popoverTargetElement" in HTMLButtonElement.prototype, "Popover reflection unavailable");
    install([popoverTargets()]);
    const { host, internal } = shadow(fixture);
    host.removeAttribute("id");
    internal.setAttribute("popover", "manual");
    const button = invoker(fixture, null);
    button.popoverTargetElement = host;
    button.click();
    assert(internal.matches(":popover-open"));
  });

  test("Canceled clicks, disabled fieldsets, and inert ancestors prevent popover actions", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    install([popoverTargets()]);
    const { host, internal } = shadow(fixture);
    internal.setAttribute("popover", "manual");
    const canceled = invoker(fixture, host);
    canceled.addEventListener("click", (event) => event.preventDefault());
    canceled.click();
    assert(!internal.matches(":popover-open"));
    const fieldset = element("fieldset", { disabled: "" });
    fixture.append(fieldset);
    const disabled = invoker(fieldset, host);
    syntheticClick(disabled);
    assert(!internal.matches(":popover-open"));
    const inert = element("div", { inert: "" });
    fixture.append(inert);
    syntheticClick(invoker(inert, host));
    assert(!internal.matches(":popover-open"));
    const legend = element("legend");
    fieldset.prepend(legend);
    invoker(legend, host).click();
    assert(internal.matches(":popover-open"), "The first legend retains native fieldset behavior");
  });

  test("Form submit buttons retain form behavior instead of forwarding popovers", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    install([popoverTargets()]);
    const { host, internal } = shadow(fixture);
    internal.setAttribute("popover", "manual");
    const form = element("form");
    fixture.append(form);
    let submissions = 0;
    form.addEventListener("submit", (event) => { event.preventDefault(); submissions++; });
    invoker(form, host, { type: "submit" }).click();
    equal(submissions, 1);
    assert(!internal.matches(":popover-open"));
  });

  test("Dialog commands dispatch one cancelable command and preserve close values", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLDialogElement?.prototype.showModal === "function", "Dialog primitives unavailable");
    install([dialogCommands()]);
    const { host, internal: dialog } = shadow(fixture, { tag: "dialog" });
    const button = invoker(fixture, null, { commandfor: host.id, command: "show-modal" });
    const commands = [];
    dialog.addEventListener("command", (event) => commands.push(event.command));
    button.click();
    assert(dialog.open);
    equal(commands.join(","), "show-modal");
    button.setAttribute("command", "close");
    button.setAttribute("value", "confirmed");
    button.click();
    assert(!dialog.open);
    equal(dialog.returnValue, "confirmed");
    equal(commands.join(","), "show-modal,close");
  });

  test("Canceling command prevents dialog activation", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLDialogElement?.prototype.showModal === "function", "Dialog primitives unavailable");
    install([dialogCommands()]);
    const { host, internal: dialog } = shadow(fixture, { tag: "dialog" });
    let commands = 0;
    dialog.addEventListener("command", (event) => { commands++; event.preventDefault(); });
    invoker(fixture, null, { commandfor: host.id, command: "show-modal" }).click();
    equal(commands, 1);
    assert(!dialog.open);
  });

  test("request-close honors native dialog cancel events", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLDialogElement?.prototype.requestClose === "function", "requestClose primitive unavailable");
    install([dialogCommands()]);
    const { host, internal: dialog } = shadow(fixture, { tag: "dialog" });
    const button = invoker(fixture, null, { commandfor: host.id, command: "request-close", value: "accepted" });
    dialog.showModal();
    const cancel = (event) => event.preventDefault();
    dialog.addEventListener("cancel", cancel);
    button.click();
    assert(dialog.open);
    dialog.removeEventListener("cancel", cancel);
    button.click();
    assert(!dialog.open);
    equal(dialog.returnValue, "accepted");
  });

  test("Selected command adapters take precedence over popovertarget", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    install([popoverTargets(), popoverCommands()]);
    const command = shadow(fixture);
    const popover = shadow(fixture);
    command.internal.setAttribute("popover", "manual");
    popover.internal.setAttribute("popover", "manual");
    const button = invoker(fixture, null, {
      commandfor: command.host.id, command: "toggle-popover", popovertarget: popover.host.id,
    });
    let commands = 0;
    command.internal.addEventListener("command", () => commands++);
    button.click();
    equal(commands, 1);
    assert(command.internal.matches(":popover-open"));
    assert(!popover.internal.matches(":popover-open"));
  });

  test("Missing and unknown commands never fall through to popovertarget", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    install([popoverTargets(), popoverCommands()]);
    const { host, internal } = shadow(fixture);
    internal.setAttribute("popover", "manual");
    const button = invoker(fixture, null, { commandfor: host.id, popovertarget: host.id });
    button.click();
    assert(!internal.matches(":popover-open"));
    button.setAttribute("command", "not-a-command");
    button.click();
    assert(!internal.matches(":popover-open"));
    button.setAttribute("command", "--application-command");
    button.click();
    assert(!internal.matches(":popover-open"));
  });

  test("Canceling a popover command prevents its default action", ({ fixture, install }) => {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    install([popoverCommands()]);
    const { host, internal } = shadow(fixture);
    internal.setAttribute("popover", "manual");
    internal.addEventListener("command", (event) => event.preventDefault());
    invoker(fixture, null, { commandfor: host.id, command: "show-popover" }).click();
    assert(!internal.matches(":popover-open"));
  });

  test("Explicit labels focus the internal control and focus-and-click activates once", ({ fixture, install }) => {
    install([labels({ activation: "focus-and-click" })]);
    const { host, root, internal: control } = shadow(fixture, { tag: "input" });
    control.type = "checkbox";
    const label = element("label", { for: host.id }, "Accept");
    fixture.append(label);
    let clicks = 0;
    control.addEventListener("click", () => clicks++);
    label.click();
    assert(control.checked);
    equal(clicks, 1);
    equal(root.activeElement, control);
    label.click();
    assert(!control.checked);
    equal(clicks, 2);
  });

  test("Focus-only label policy never synthesizes a control click", ({ fixture, install }) => {
    install([labels({ activation: "focus" })]);
    const { host, root, internal: control } = shadow(fixture, { tag: "input" });
    control.type = "checkbox";
    const label = element("label", { for: host.id }, "Accept");
    fixture.append(label);
    label.click();
    equal(root.activeElement, control);
    assert(!control.checked);
  });

  test("Wrapping labels activate closed-root controls once and ignore interactive children", ({ fixture, install }) => {
    install([labels({ activation: "focus-and-click" })]);
    const label = element("label", {}, "Accept ");
    fixture.append(label);
    const { internal: control } = shadow(label, { tag: "input" });
    control.type = "checkbox";
    const link = element("a", { href: "#not-navigated" }, "Help");
    label.append(link);
    let clicks = 0;
    control.addEventListener("click", () => clicks++);
    label.click();
    equal(clicks, 1);
    assert(control.checked);
    control.click();
    equal(clicks, 2, "A click inside a closed root must not be forwarded again outside it");
    assert(!control.checked);
    // Cancel navigation after the document's adapter listener has already
    // observed the uncanceled anchor click and chosen not to forward it.
    window.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.click();
    equal(clicks, 2);
    const button = element("button", { type: "button" }, "Help");
    label.append(button);
    button.click();
    equal(clicks, 2);
  });

  test("Canceled label clicks and unavailable controls are left inactive", ({ fixture, install }) => {
    install([labels({ activation: "focus-and-click" })]);
    const { host, internal: control } = shadow(fixture, { tag: "input" });
    control.type = "checkbox";
    const label = element("label", { for: host.id });
    fixture.append(label);
    const cancel = (event) => event.preventDefault();
    label.addEventListener("click", cancel);
    label.click();
    assert(!control.checked);
    label.removeEventListener("click", cancel);
    control.disabled = true;
    label.click();
    assert(!control.checked);
    control.disabled = false;
    host.inert = true;
    label.click();
    assert(!control.checked);
  });

  test("Label naming includes external and existing internal labels, then restores on disposal", ({ fixture, install }) => {
    requirePrimitive("ariaLabelledByElements" in Element.prototype, "ARIA element reflection unavailable");
    const handle = install([labels({ activation: "focus", naming: true })]);
    const { host, root, internal: control } = shadow(fixture, { tag: "input" });
    const external = element("label", { for: host.id }, "External");
    const internal = element("label", { for: control.id }, "Internal");
    fixture.append(external);
    root.append(internal);
    handle.refresh();
    equalElements(control.ariaLabelledByElements, [external, internal]);
    handle.dispose();
    equal(control.getAttribute("aria-labelledby"), null);
    equal(control.ariaLabelledByElements, null);
  });

  test("Label naming respects authored names and later author replacement", ({ fixture, install }) => {
    requirePrimitive("ariaLabelledByElements" in Element.prototype, "ARIA element reflection unavailable");
    const handle = install([labels({ activation: "focus", naming: true })]);
    const first = shadow(fixture, { tag: "input" });
    const second = shadow(fixture, { tag: "input" });
    first.internal.setAttribute("aria-label", "Authored name");
    fixture.append(element("label", { for: first.host.id }, "External"));
    fixture.append(element("label", { for: second.host.id }, "External"));
    handle.refresh();
    equal(first.internal.ariaLabelledByElements, null);
    equal(first.internal.getAttribute("aria-label"), "Authored name");
    assert(second.internal.ariaLabelledByElements?.length);
    const author = element("span", { id: "author-name" }, "Replacement");
    second.root.append(author);
    second.internal.setAttribute("aria-labelledby", author.id);
    handle.refresh();
    equalElements(second.internal.ariaLabelledByElements, [author]);
    handle.dispose();
    equal(second.internal.getAttribute("aria-labelledby"), author.id);
  });

  test("Text proxies preserve IDREF order, distinguish names/descriptions, and update on mutation", async ({ fixture, install }) => {
    const calls = [];
    const handle = install([textNames({ getText(host, kind) {
      calls.push([host, kind]);
      return kind === "label" ? host.dataset.name : host.dataset.description;
    } })]);
    const { host } = shadow(fixture);
    host.dataset.name = "Component title";
    host.dataset.description = "Component details";
    const before = element("span", { id: uniqueId() }, "Before");
    const after = element("span", { id: uniqueId() }, "After");
    const source = element("input", {
      "aria-labelledby": `${before.id} ${host.id} ${after.id}`,
      "aria-describedby": host.id,
    });
    fixture.append(before, after, source);
    handle.refresh();
    const nameIDs = source.getAttribute("aria-labelledby").split(" ");
    equal(nameIDs[0], before.id);
    equal(nameIDs[2], after.id);
    const proxy = document.getElementById(nameIDs[1]);
    assert(proxy?.hidden);
    equal(proxy.textContent, "Component title");
    equal(document.getElementById(source.getAttribute("aria-describedby")).textContent, "Component details");
    assert(calls.every(([referencedHost]) => referencedHost === host), "Provider must only receive the public host");
    host.dataset.name = "Updated title";
    await tick();
    equal(proxy.textContent, "Updated title");
    handle.dispose();
    equal(source.getAttribute("aria-labelledby"), `${before.id} ${host.id} ${after.id}`);
    equal(source.getAttribute("aria-describedby"), host.id);
    assert(!proxy.isConnected);
  });

  test("Text proxies handle missing targets and restore ordinary host references", ({ fixture, install }) => {
    const handle = install([textNames({ getText: () => "Forwarded text" })]);
    const { host, root } = shadow(fixture, { target: "missing" });
    const plain = element("span", { id: uniqueId() }, "Plain");
    const source = element("input", { "aria-labelledby": `${host.id} ${plain.id}` });
    fixture.append(plain, source);
    handle.refresh();
    equal(source.getAttribute("aria-labelledby"), plain.id);
    root.referenceTarget = "target";
    handle.refresh();
    const [proxyID, plainID] = source.getAttribute("aria-labelledby").split(" ");
    equal(document.getElementById(proxyID)?.textContent, "Forwarded text");
    equal(plainID, plain.id);
    root.referenceTarget = null;
    handle.refresh();
    equal(source.getAttribute("aria-labelledby"), `${host.id} ${plain.id}`);
    equal(document.getElementById(proxyID), null);
  });

  test("Declined text providers leave bindings unchanged and provider failures report diagnostics", ({ fixture, install }) => {
    let behavior = "decline";
    const diagnostics = [];
    const handle = install([textNames({ getText() {
      if (behavior === "throw") throw new Error("Provider failure");
      return null;
    } })], { onDiagnostic: (entry) => diagnostics.push(entry) });
    const { host } = shadow(fixture);
    const source = element("input", { "aria-labelledby": host.id });
    fixture.append(source);
    handle.refresh();
    equal(source.getAttribute("aria-labelledby"), host.id);
    equal(document.querySelectorAll("[data-reference-target-text]").length, 0);
    behavior = "throw";
    handle.refresh();
    equal(source.getAttribute("aria-labelledby"), host.id);
    assert(diagnostics.some((entry) => entry.code === "text-provider-error"));
  });

  test("Text proxies honor later author attributes and clean up detached sources", async ({ fixture, install }) => {
    const handle = install([textNames({ getText: () => "Fallback" })]);
    const { host } = shadow(fixture);
    const author = element("span", { id: uniqueId() }, "Author");
    const source = element("input", { "aria-labelledby": host.id });
    fixture.append(author, source);
    handle.refresh();
    const proxyID = source.getAttribute("aria-labelledby");
    source.setAttribute("aria-labelledby", author.id);
    await tick();
    equal(source.getAttribute("aria-labelledby"), author.id);
    equal(document.getElementById(proxyID), null);
    source.setAttribute("aria-labelledby", host.id);
    handle.refresh();
    const nextProxyID = source.getAttribute("aria-labelledby");
    source.remove();
    await tick();
    equal(document.getElementById(nextProxyID), null);
    equal(source.getAttribute("aria-labelledby"), host.id);
    handle.dispose();
    equal(source.getAttribute("aria-labelledby"), host.id);
  });

  test("Text proxies preserve explicit element lists and property-only author updates", ({ fixture, install }) => {
    requirePrimitive("ariaLabelledByElements" in Element.prototype, "ARIA element reflection unavailable");
    const handle = install([textNames({ getText: () => "Forwarded name" })]);
    const { host } = shadow(fixture);
    const before = element("span", {}, "Before");
    const after = element("span", {}, "After");
    const source = element("input");
    fixture.append(before, after, source);
    source.ariaLabelledByElements = [before, host, after];
    handle.refresh();
    const effective = source.ariaLabelledByElements;
    equal(effective.length, 3);
    equal(effective[0], before);
    equal(effective[2], after);
    equal(effective[1].textContent, "Forwarded name");
    equal(effective[1].getRootNode(), source.getRootNode());
    source.ariaLabelledByElements = [after, before];
    handle.refresh();
    equalElements(source.ariaLabelledByElements, [after, before]);
    assert(!effective[1].isConnected);
    handle.dispose();
    equalElements(source.ariaLabelledByElements, [after, before]);
  });

  test("Text proxy disposal restores the original explicit references", ({ fixture, install }) => {
    requirePrimitive("ariaDescribedByElements" in Element.prototype, "ARIA element reflection unavailable");
    const handle = install([textNames({ getText: () => "Details" })]);
    const { host } = shadow(fixture);
    const source = element("input");
    fixture.append(source);
    source.ariaDescribedByElements = [host];
    handle.refresh();
    const proxy = source.ariaDescribedByElements[0];
    assert(proxy !== host);
    handle.dispose();
    equalElements(source.ariaDescribedByElements, [host]);
    assert(!proxy.isConnected);
  });

  test("A text provider can withdraw its opt-in and preserve original whitespace", ({ fixture, install }) => {
    let supplied = "Supplied name";
    const handle = install([textNames({ getText: () => supplied })]);
    const { host } = shadow(fixture);
    const original = `  ${host.id}\t`;
    const source = element("input", { "aria-labelledby": original });
    fixture.append(source);
    handle.refresh();
    const proxyID = source.getAttribute("aria-labelledby");
    equal(document.getElementById(proxyID)?.textContent, supplied);
    supplied = null;
    handle.refresh();
    equal(source.getAttribute("aria-labelledby"), original);
    equal(document.getElementById(proxyID), null);
  });

  test("Explicit text references follow source moves and stop exposing out-of-scope hosts", ({ fixture, install }) => {
    requirePrimitive("ariaLabelledByElements" in Element.prototype, "ARIA element reflection unavailable");
    const handle = install([textNames({ getText: () => "Scoped text" })]);
    const referenced = shadow(fixture);
    const first = shadow(fixture, { target: null });
    const second = shadow(fixture, { target: null });
    const source = element("input");
    first.root.append(source);
    source.ariaLabelledByElements = [referenced.host];
    handle.refresh();
    const oldProxy = source.ariaLabelledByElements[0];
    equal(oldProxy.getRootNode(), first.root);
    second.root.append(source);
    handle.refresh();
    const movedProxy = source.ariaLabelledByElements[0];
    equal(movedProxy?.textContent, "Scoped text");
    equal(movedProxy.getRootNode(), second.root);
    assert(!oldProxy.isConnected);
    first.root.append(referenced.host);
    handle.refresh();
    equal(source.ariaLabelledByElements.length, 0, "A sibling shadow root is out of scope");
    assert(!movedProxy.isConnected);
    fixture.append(referenced.host);
    handle.refresh();
    equal(source.ariaLabelledByElements[0]?.textContent, "Scoped text");
  });

  test("Text proxies are created in the source's shadow tree", ({ fixture, install }) => {
    const handle = install([textNames({ getText: () => "Scoped name" })]);
    const outer = shadow(fixture, { target: null, mode: "open" });
    const inner = shadow(outer.root);
    const source = element("input", { "aria-labelledby": inner.host.id });
    outer.root.append(source);
    handle.refresh();
    const id = source.getAttribute("aria-labelledby");
    const proxy = outer.root.getElementById(id);
    equal(proxy?.textContent, "Scoped name");
    equal(proxy.getRootNode(), source.getRootNode());
    equal(document.getElementById(id), null);
  });

  test("Text providers never receive hosts enclosed by closed roots", ({ fixture, install }) => {
    const suppliedHosts = [];
    const handle = install([textNames({ getText(host) {
      suppliedHosts.push(host);
      return "Public component name";
    } })]);
    const closed = shadow(fixture, { target: null, mode: "closed" });
    const privateHost = shadow(closed.root);
    const privateSource = element("input", { "aria-labelledby": privateHost.host.id });
    closed.root.append(privateSource);
    const openInsideClosed = shadow(closed.root, { target: null, mode: "open" });
    const deeplyPrivateHost = shadow(openInsideClosed.root);
    const nestedSource = element("input", { "aria-labelledby": deeplyPrivateHost.host.id });
    openInsideClosed.root.append(nestedSource);
    handle.refresh();
    equal(suppliedHosts.length, 0);
    equal(privateSource.getAttribute("aria-labelledby"), privateHost.host.id);
    equal(nestedSource.getAttribute("aria-labelledby"), deeplyPrivateHost.host.id);
    equal(closed.root.querySelectorAll("[data-reference-target-text]").length, 0);
    equal(openInsideClosed.root.querySelectorAll("[data-reference-target-text]").length, 0);
    // A public host's own closed target tree does not make that host private.
    const publicHost = shadow(fixture, { mode: "closed" });
    const publicSource = element("input", { "aria-labelledby": publicHost.host.id });
    fixture.append(publicSource);
    handle.refresh();
    equalElements(suppliedHosts, [publicHost.host]);
    const proxy = document.getElementById(publicSource.getAttribute("aria-labelledby"));
    equal(proxy?.textContent, "Public component name");
  });

  // These integration assertions inspect the actual companion's DOM bindings
  // and native primitive actions. They do not certify accessible-name output
  // or behavior in a screen reader.
  test("Companion: a hydrated DSD label activates once and supplies its outward naming binding", async ({ fixture }) => {
    const page = await scenarioPage(fixture);
    requirePrimitive("ariaLabelledByElements" in page.realm.Element.prototype, "ARIA element reflection unavailable");
    const root = scenarioRoot(page, "checkbox-host");
    const control = root.getElementById("control");
    const label = page.document.getElementById("checkbox-label");
    assert(control && label);
    equal(root.referenceTarget, "control", "Hydration must recover the DSD target metadata before readiness");
    equal(control.type, "checkbox");
    equalElements(control.ariaLabelledByElements, [label]);
    const adapters = page.document.documentElement.dataset.referenceTargetAdapters.split(",");
    for (const id of ["labels", "popover-targets", "text-names"]) {
      assert(adapters.includes(id), `Companion is ready with the ${id} adapter installed`);
    }
    let clicks = 0;
    control.addEventListener("click", () => clicks++);
    const initial = control.checked;
    label.click();
    equal(control.checked, !initial);
    equal(clicks, 1, "One label activation must produce exactly one internal click");
    label.click();
    equal(control.checked, initial);
    equal(clicks, 2);
  });

  test("Companion: a hydrated DSD popover target toggles its internal native popover", async ({ fixture }) => {
    const page = await scenarioPage(fixture);
    requirePrimitive(typeof page.realm.HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    const root = scenarioRoot(page, "popover-host");
    const popover = root.getElementById("panel");
    const button = page.document.getElementById("popover-button");
    assert(popover && button);
    equal(root.referenceTarget, "panel");
    assert(!popover.matches(":popover-open"));
    button.click();
    assert(popover.matches(":popover-open"));
    button.click();
    assert(!popover.matches(":popover-open"));
  });

  test("Companion: the name proxy contains only explicitly supplied target text", async ({ fixture }) => {
    const page = await scenarioPage(fixture);
    const root = scenarioRoot(page, "label-host");
    const host = page.document.getElementById("label-host");
    const input = page.document.getElementById("name-input");
    const label = root.getElementById("label");
    const unrelated = root.getElementById("extra-text");
    assert(input && label && unrelated);
    assert(!input.disabled, "The application module must enable the input before readiness");
    equal(label.textContent.trim(), "Delivery preference");
    equal(host.dataset.labelText, "Delivery preference");
    assert(unrelated.textContent.trim(), "The component contains unrelated text to exclude");
    const ids = input.getAttribute("aria-labelledby").trim().split(/\s+/);
    equal(ids.length, 1);
    assert(ids[0] !== host.id, "The fallback must replace the host IDREF with its same-tree proxy");
    const proxy = page.document.getElementById(ids[0]);
    assert(proxy?.hasAttribute("data-reference-target-text"));
    assert(proxy.hidden);
    equal(proxy.textContent, host.dataset.labelText);
    assert(!proxy.textContent.includes(unrelated.textContent.trim()));
    assert(proxy.textContent !== root.textContent.trim(), "The provider must not copy all shadow-root text");
  });

  test("Companion: a host's aria-label is not copied onto its internal control", async ({ fixture }) => {
    const page = await scenarioPage(fixture);
    const root = scenarioRoot(page, "host-label-negative");
    const host = page.document.getElementById("host-label-negative");
    const control = root.getElementById("control");
    assert(control);
    assert(!control.disabled, "The negative example must be interactive after application readiness");
    equal(host.getAttribute("aria-label"), "Host-only accessible name");
    equal(control.getAttribute("aria-label"), null);
    equal(control.getAttribute("aria-labelledby"), null);
    equal(control.textContent.trim(), "Inner button");
  });

  test("Companion: host popovertarget attributes and outward string IDREFs are not implicitly forwarded", async ({ fixture }) => {
    const page = await scenarioPage(fixture);
    requirePrimitive(typeof page.realm.HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
    const root = scenarioRoot(page, "outward-negative-host");
    const host = page.document.getElementById("outward-negative-host");
    const button = root.getElementById("button");
    const stringButton = root.getElementById("string-button");
    const popover = page.document.getElementById("outside-popover");
    assert(button && stringButton && popover);
    assert(!button.disabled && !stringButton.disabled, "Negative assertions must exercise enabled controls");
    equal(host.getAttribute("popovertarget"), popover.id);
    equal(button.getAttribute("popovertarget"), null, "The host's targeting attribute must not be copied inward");
    equal(stringButton.getAttribute("popovertarget"), popover.id);
    assert(!popover.matches(":popover-open"));
    button.click();
    assert(!popover.matches(":popover-open"), "A host attribute does not configure its internal button");
    stringButton.click();
    assert(!popover.matches(":popover-open"), "An inner string IDREF cannot resolve an ID in the outer document");
  });

  test("Companion: an ordinary explicit outward popoverTargetElement reference still works", async ({ fixture }) => {
    const page = await scenarioPage(fixture);
    requirePrimitive(typeof page.realm.HTMLElement.prototype.showPopover === "function" && "popoverTargetElement" in page.realm.HTMLButtonElement.prototype, "Popover element reflection unavailable");
    const root = scenarioRoot(page, "outward-positive-host");
    const button = root.getElementById("button");
    const popover = page.document.getElementById("explicit-popover");
    assert(button && popover);
    equal(button.popoverTargetElement, popover, "The application module must assign the explicit reference before readiness");
    assert(!popover.matches(":popover-open"));
    button.click();
    assert(popover.matches(":popover-open"));
    button.click();
    assert(!popover.matches(":popover-open"));
  });

  test("Companion: off mode reaches application readiness without installing fallback state", async ({ fixture }) => {
    const page = await scenarioPage(fixture, "off");
    const checkboxRoot = scenarioRoot(page, "checkbox-host");
    const nameRoot = scenarioRoot(page, "label-host");
    equal(page.document.documentElement.dataset.referenceTargetAdapters, "");
    assert(page.document.querySelector("#adapter-status")?.textContent.trim(), "The uninstalled adapter state must be visible");
    equal(Object.getOwnPropertyDescriptor(checkboxRoot, "referenceTarget"), undefined);
    equal(Object.getOwnPropertyDescriptor(nameRoot, "referenceTarget"), undefined);
    equal(page.document.querySelectorAll("[data-reference-target-text]").length, 0);
    equal(page.document.getElementById("name-input").getAttribute("aria-labelledby"), "label-host");
    assert(/\[native code\]/.test(page.realm.Function.prototype.toString.call(page.realm.Element.prototype.attachShadow)), "Off mode must retain the native attachShadow method");
    // Application readiness includes its ordinary explicit-reference setup in
    // every mode. Native Reference Target behavior may also work in off mode.
    if ("popoverTargetElement" in page.realm.HTMLButtonElement.prototype) {
      const button = scenarioRoot(page, "outward-positive-host").getElementById("button");
      equal(button.popoverTargetElement, page.document.getElementById("explicit-popover"));
    }
  });

  const { registerFormTargetTests } = await import("./form-targets.js");
  registerFormTargetTests({
    test, assert, equal, throws, requirePrimitive, element, syntheticClick, uniqueId,
  });
  const { registerComboboxTargetTests } = await import("./combobox-targets.js");
  registerComboboxTargetTests({
    test, assert, equal, throws, requirePrimitive, element, uniqueId, nativeTestRealm,
  });
  const { registerGalleryTests } = await import("./gallery.js");
  registerGalleryTests({ test, assert, equal, requirePrimitive });
  const { registerRendererTests } = await import("./renderers.js");
  registerRendererTests({ test, assert, equal, requirePrimitive });

  for (const { name, callback } of tests) {
    statusElement.textContent = `Running ${results.length + 1}/${tests.length}: ${name}`;
    const fixture = element("div");
    fixtureContainer.append(fixture);
    const handles = [];
    const beforeErrors = asynchronousErrors.length;
    let outcome = "pass";
    let failure;
    try {
      await callback({
        fixture,
        install(adapters, options = {}) {
          const handle = installReferenceTarget({ adapters, realm: window, force: true, ...options });
          handles.push(handle);
          return handle;
        },
      });
      await tick();
      if (asynchronousErrors.length > beforeErrors) throw asynchronousErrors[beforeErrors];
    } catch (error) {
      outcome = error.name === "SkipTest" ? "skip" : "fail";
      failure = error;
    } finally {
      for (const handle of handles.reverse()) {
        try { handle.dispose(); } catch (error) { outcome = "fail"; failure ??= error; }
      }
      fixture.remove();
      await tick();
    }
    const entry = { name, outcome, ...(failure ? { error: String(failure.stack ?? failure) } : {}) };
    results.push(entry);
    const item = element("li", { class: outcome }, `${outcome.toUpperCase()}: ${name}`);
    if (failure) item.append(element("pre", {}, String(failure.stack ?? failure)));
    resultsElement.append(item);
  }

  const passed = results.filter(({ outcome }) => outcome === "pass").length;
  const failed = results.filter(({ outcome }) => outcome === "fail").length;
  const skipped = results.filter(({ outcome }) => outcome === "skip").length;
  const summary = { passed, failed, skipped, total: results.length, environment, results };
  window.__referenceTargetTestResults = summary;
  statusElement.dataset.state = failed ? "failed" : "passed";
  statusElement.textContent = `${passed} passed, ${failed} failed, ${skipped} skipped (${results.length} tests).`;
  document.title = `${failed ? "FAIL" : "PASS"}: Reference Target browser tests`;
  console.log("Reference Target browser tests:", summary);
}

run().catch((error) => {
  statusElement.dataset.state = "failed";
  statusElement.textContent = `Test harness failed: ${error.message}`;
  resultsElement.append(element("pre", {}, error.stack ?? String(error)));
  window.__referenceTargetTestResults = { failed: 1, environment, harnessError: String(error.stack ?? error) };
});
