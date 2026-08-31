import { comboboxTargets } from "../src/adapters/combobox-targets.js";

/** These are DOM relationship checks, not screen-reader conformance tests. */
export function registerComboboxTargetTests({
  test, assert, equal, throws, requirePrimitive, element, uniqueId, nativeTestRealm,
}) {
  function combobox(fixture, { document: owner = document, shadowMode = "closed" } = {}) {
    function node(tag, attributes = {}, text) {
      const result = owner.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
      if (text !== undefined) result.textContent = text;
      return result;
    }
    const host = node("div", { id: uniqueId("combobox-host") });
    const input = node("input", {
      type: "text", role: "combobox", "aria-expanded": "true",
      "aria-controls": host.id, "aria-activedescendant": host.id,
    });
    const listbox = node("div", { id: uniqueId("listbox"), role: "listbox" });
    const first = node("div", { id: uniqueId("option"), role: "option", "aria-selected": "false" }, "First choice");
    const second = node("div", { id: uniqueId("option"), role: "option", "aria-selected": "true" }, "Second choice");
    listbox.append(first, second);
    host.append(listbox);
    fixture.append(input, host);
    let root;
    if (shadowMode) {
      root = host.attachShadow({ mode: shadowMode, referenceTarget: "private-wrapper" });
      const wrapper = node("div", { id: "private-wrapper" });
      wrapper.append(node("slot"));
      root.append(wrapper);
    }
    return { input, host, listbox, first, second, root, node };
  }

  function assertOriginal(control) {
    equal(control.input.getAttribute("aria-controls"), control.host.id);
    equal(control.input.getAttribute("aria-activedescendant"), control.host.id);
  }

  test("Combobox targets require an explicit synchronous component provider", () => {
    throws(() => comboboxTargets(), /getTargets|function|provider/i);
    throws(() => comboboxTargets({ getTargets: "not a function" }), /getTargets|function|provider/i);
  });

  test("Combobox targets bind one real public listbox and its active option without moving focus or selection", ({ fixture, install }) => {
    let control;
    const suppliedHosts = [];
    const handle = install([comboboxTargets({ getTargets(host) {
      suppliedHosts.push(host);
      return host === control?.host ? { listbox: control.listbox, activeOption: control.first } : null;
    } })]);
    control = combobox(fixture);
    control.input.focus();
    const beforeNodes = fixture.querySelectorAll("*").length;
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    equal(control.input.getAttribute("aria-activedescendant"), control.first.id);
    equal(document.activeElement, control.input, "The editable combobox retains DOM focus");
    equal(control.first.getAttribute("aria-selected"), "false", "Selection belongs to the component");
    equal(control.second.getAttribute("aria-selected"), "true");
    equal(control.input.getAttribute("aria-expanded"), "true");
    equal(fixture.querySelectorAll("*").length, beforeNodes, "No accessibility mirror nodes are inserted");
    assert(suppliedHosts.length > 0 && suppliedHosts.every(host => host === control.host));
    equal(control.host.shadowRoot, null, "The provider cooperates with a public host that owns a closed root");
    equal(control.input.getRootNode(), control.listbox.getRootNode());
    assert(control.listbox.contains(control.first));
  });

  test("Combobox model refresh changes the active option synchronously and reopening restores its authored intent", ({ fixture, install }) => {
    const control = combobox(fixture);
    let activeOption = control.first;
    const handle = install([comboboxTargets({ getTargets: () => ({ listbox: control.listbox, activeOption }) })]);
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), control.first.id);
    activeOption = control.second;
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), control.second.id);
    control.input.setAttribute("aria-expanded", "false");
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), null);
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    control.input.setAttribute("aria-expanded", "true");
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), control.second.id);
    activeOption = null;
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), null);
    handle.dispose();
    assertOriginal(control);
  });

  test("Combobox targets leave direct active-option references and absent active references to their author", ({ fixture, install }) => {
    const direct = combobox(fixture);
    const absent = combobox(fixture);
    direct.input.setAttribute("aria-activedescendant", direct.second.id);
    absent.input.removeAttribute("aria-activedescendant");
    const controls = new Map([[direct.host, direct], [absent.host, absent]]);
    const handle = install([comboboxTargets({ getTargets(host) {
      const control = controls.get(host);
      return control && { listbox: control.listbox, activeOption: control.first };
    } })]);
    handle.refresh();
    equal(direct.input.getAttribute("aria-controls"), direct.listbox.id);
    equal(direct.input.getAttribute("aria-activedescendant"), direct.second.id);
    equal(absent.input.getAttribute("aria-controls"), absent.listbox.id);
    equal(absent.input.getAttribute("aria-activedescendant"), null);
    handle.dispose();
    equal(direct.input.getAttribute("aria-controls"), direct.host.id);
    equal(direct.input.getAttribute("aria-activedescendant"), direct.second.id);
    equal(absent.input.getAttribute("aria-activedescendant"), null);
  });

  test("Combobox targets do not opt other controls or multi-target controls into the provider", ({ fixture, install }) => {
    const controls = Array.from({ length: 4 }, () => combobox(fixture));
    controls[0].input.type = "number";
    controls[1].input.setAttribute("role", "textbox");
    controls[2].input.setAttribute("role", "combobox textbox");
    controls[3].input.setAttribute("aria-controls", `${controls[3].host.id} another-target`);
    let calls = 0;
    const handle = install([comboboxTargets({ getTargets() { calls++; return null; } })]);
    handle.refresh();
    equal(calls, 0);
    for (const control of controls) equal(control.input.getAttribute("aria-activedescendant"), control.host.id);
  });

  test("Combobox provider withdrawal and failures restore original whitespace without exposing nodes in diagnostics", ({ fixture, install }) => {
    const control = combobox(fixture);
    const authored = `  ${control.host.id}\t`;
    control.input.setAttribute("aria-controls", authored);
    control.input.setAttribute("aria-activedescendant", authored);
    let supplied = { listbox: control.listbox, activeOption: control.first };
    let failure = false;
    const diagnostics = [];
    const handle = install([comboboxTargets({ getTargets() {
      if (failure) throw new Error("Component provider unavailable");
      return supplied;
    } })], { onDiagnostic: value => diagnostics.push(value) });
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    supplied = null;
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), authored);
    equal(control.input.getAttribute("aria-activedescendant"), authored);
    supplied = { listbox: control.listbox, activeOption: control.second };
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), control.second.id);
    failure = true;
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), authored);
    equal(control.input.getAttribute("aria-activedescendant"), authored);
    assert(diagnostics.length > 0, "Provider errors are observable through diagnostics");
    function noNodes(value) {
      assert(!(value instanceof Node), "Diagnostics must not expose live DOM nodes");
      if (value && typeof value === "object") Object.values(value).forEach(noNodes);
    }
    diagnostics.forEach(noNodes);
  });

  test("Replacing a combobox's controls releases its old binding while preserving the author's replacement", ({ fixture, install }) => {
    const control = combobox(fixture);
    const outside = element("div", { id: uniqueId("other-listbox"), role: "listbox" });
    fixture.append(outside);
    const handle = install([comboboxTargets({ getTargets: host => host === control.host
      ? { listbox: control.listbox, activeOption: control.first } : null })]);
    handle.refresh();
    control.input.setAttribute("aria-controls", outside.id);
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), outside.id);
    equal(control.input.getAttribute("aria-activedescendant"), control.host.id, "Only the still-owned active binding is restored");
    handle.dispose();
    equal(control.input.getAttribute("aria-controls"), outside.id);
  });

  test("An author active-option override survives refresh and disposal while controls remain bound", ({ fixture, install }) => {
    const control = combobox(fixture);
    const handle = install([comboboxTargets({ getTargets: () => ({ listbox: control.listbox, activeOption: control.first }) })]);
    handle.refresh();
    control.input.setAttribute("aria-activedescendant", control.second.id);
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    equal(control.input.getAttribute("aria-activedescendant"), control.second.id);
    handle.dispose();
    equal(control.input.getAttribute("aria-controls"), control.host.id);
    equal(control.input.getAttribute("aria-activedescendant"), control.second.id);
  });

  test("Provider-time author edits win over stale combobox writes", ({ fixture, install }) => {
    const control = combobox(fixture);
    const alternate = element("div", { id: uniqueId("author-listbox"), role: "listbox" });
    fixture.append(alternate);
    let mutate = false;
    const handle = install([comboboxTargets({ getTargets: host => {
      if (host !== control.host) return null;
      if (mutate) {
        control.input.setAttribute("aria-controls", alternate.id);
        control.input.setAttribute("aria-activedescendant", "author-choice");
      }
      return { listbox: control.listbox, activeOption: control.first };
    } })]);
    handle.refresh();
    mutate = true;
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), alternate.id);
    equal(control.input.getAttribute("aria-activedescendant"), "author-choice");
    handle.dispose();
    equal(control.input.getAttribute("aria-controls"), alternate.id);
    equal(control.input.getAttribute("aria-activedescendant"), "author-choice");
  });

  test("A combobox diagnostic can dispose its binding without being overwritten by the interrupted refresh", ({ fixture, install }) => {
    const control = combobox(fixture);
    let activeOption = control.first;
    let handle;
    let disposeOnDiagnostic = false;
    handle = install([comboboxTargets({ getTargets: () => ({ listbox: control.listbox, activeOption }) })], {
      onDiagnostic() { if (disposeOnDiagnostic) handle.dispose(); },
    });
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    activeOption = element("div", { id: uniqueId("invalid-option"), role: "option" });
    disposeOnDiagnostic = true;
    handle.refresh();
    assertOriginal(control);
    handle.refresh();
    assertOriginal(control);
  });

  test("Combobox targets reject listboxes outside the host, duplicate IDs, and private target trees", ({ fixture, install }) => {
    const control = combobox(fixture);
    let listbox = control.listbox;
    const handle = install([comboboxTargets({ getTargets: () => ({ listbox, activeOption: control.first }) })]);
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    fixture.append(control.listbox);
    handle.refresh();
    assertOriginal(control);
    control.host.append(control.listbox);
    const duplicate = element("div", { id: control.listbox.id });
    fixture.append(duplicate);
    handle.refresh();
    assertOriginal(control);
    duplicate.remove();
    const privateListbox = element("div", { id: uniqueId("private-listbox"), role: "listbox" });
    control.root.append(privateListbox);
    listbox = privateListbox;
    handle.refresh();
    assertOriginal(control);
    listbox = control.listbox;
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id, "A repaired public contract can bind again");
  });

  test("Combobox targets never point active-descendant at hidden, duplicate, or unrelated options", ({ fixture, install }) => {
    const control = combobox(fixture);
    let activeOption = control.first;
    const handle = install([comboboxTargets({ getTargets: () => ({ listbox: control.listbox, activeOption }) })]);
    const invalidators = [
      () => { control.first.hidden = true; return () => { control.first.hidden = false; }; },
      () => { control.listbox.inert = true; return () => { control.listbox.inert = false; }; },
      () => { control.host.setAttribute("aria-hidden", "true"); return () => control.host.removeAttribute("aria-hidden"); },
      () => { control.first.style.display = "none"; return () => control.first.style.removeProperty("display"); },
      () => { control.first.style.visibility = "hidden"; return () => control.first.style.removeProperty("visibility"); },
      () => { control.first.setAttribute("role", "button"); return () => control.first.setAttribute("role", "option"); },
      () => { const duplicate = element("div", { id: control.first.id }); fixture.append(duplicate); return () => duplicate.remove(); },
      () => { fixture.append(control.first); return () => control.listbox.prepend(control.first); },
    ];
    for (const invalidate of invalidators) {
      handle.refresh();
      equal(control.input.getAttribute("aria-activedescendant"), control.first.id);
      const restore = invalidate();
      handle.refresh();
      equal(control.input.getAttribute("aria-activedescendant"), null, "An inaccessible or out-of-scope active option is not referenced");
      equal(control.input.getAttribute("aria-controls"), control.listbox.id);
      restore();
    }
    activeOption = null;
    handle.refresh();
    equal(control.input.getAttribute("aria-activedescendant"), null);
  });

  test("Combobox providers cannot observe hosts or sources inside a closed shadow boundary", ({ fixture, install }) => {
    const supplied = [];
    const handle = install([comboboxTargets({ getTargets(host) { supplied.push(host); return null; } })]);
    const outer = element("div");
    fixture.append(outer);
    const closed = outer.attachShadow({ mode: "closed" });
    const privateControl = combobox(closed);
    const inner = element("div");
    closed.append(inner);
    const openInsideClosed = inner.attachShadow({ mode: "open" });
    const deeplyPrivateControl = combobox(openInsideClosed);
    handle.refresh();
    equal(supplied.length, 0);
    assertOriginal(privateControl);
    assertOriginal(deeplyPrivateControl);
  });

  test("Combobox bindings release on disconnect and root moves, and can resume in a public shared tree", ({ fixture, install }) => {
    const control = combobox(fixture);
    const handle = install([comboboxTargets({ getTargets: host => host === control.host
      ? { listbox: control.listbox, activeOption: control.first } : null })]);
    handle.refresh();
    control.input.remove();
    handle.refresh();
    assertOriginal(control);
    fixture.append(control.input);
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    const outer = element("div");
    fixture.append(outer);
    const root = outer.attachShadow({ mode: "open" });
    root.append(control.input);
    handle.refresh();
    assertOriginal(control);
    root.append(control.host);
    handle.refresh();
    equal(control.input.getAttribute("aria-controls"), control.listbox.id);
    equal(control.input.getAttribute("aria-activedescendant"), control.first.id);
    handle.dispose();
    assertOriginal(control);
  });

  test("Combobox attribute bindings leave explicit native element-reference assignments untouched", ({ fixture, install }) => {
    requirePrimitive("ariaControlsElements" in Element.prototype && "ariaActiveDescendantElement" in Element.prototype,
      "ARIA element reflection unavailable");
    const control = combobox(fixture);
    control.input.ariaControlsElements = [control.host];
    control.input.ariaActiveDescendantElement = control.host;
    let calls = 0;
    const handle = install([comboboxTargets({ getTargets() {
      calls++;
      return { listbox: control.listbox, activeOption: control.first };
    } })]);
    handle.refresh();
    equal(calls, 0);
    equal(control.input.ariaControlsElements[0], control.host);
    equal(control.input.ariaActiveDescendantElement, control.host);
    handle.dispose();
    equal(control.input.ariaControlsElements[0], control.host);
    equal(control.input.ariaActiveDescendantElement, control.host);
  });

  test("Combobox cooperation remains available beside a native Phase 1 surface without wrapping native primitives", async ({ fixture, install }) => {
    const native = await nativeTestRealm(fixture);
    const { realm } = native;
    const originalAttach = realm.Element.prototype.attachShadow;
    const originalProperty = Object.getOwnPropertyDescriptor(realm.ShadowRoot.prototype, "referenceTarget");
    const control = combobox(realm.document.body, { document: realm.document, shadowMode: "open" });
    let ordinaryInstalled = false;
    let handle;
    try {
      handle = install([
        { id: "native-ordinary", install() { ordinaryInstalled = true; } },
        comboboxTargets({ getTargets: host => host === control.host
          ? { listbox: control.listbox, activeOption: control.first } : null }),
      ], { realm, force: false });
      handle.refresh();
      equal(handle.mode, "fallback");
      equal(handle.statuses["combobox-targets"], "fallback");
      assert(["native", "unsupported"].includes(handle.statuses["native-ordinary"]));
      equal(handle.activeAdapters.join(","), "combobox-targets");
      equal(ordinaryInstalled, false);
      equal(realm.Element.prototype.attachShadow, originalAttach);
      equal(Object.getOwnPropertyDescriptor(control.root, "referenceTarget"), undefined);
      equal(native.nativeValue(control.root), "private-wrapper");
      equal(control.input.getAttribute("aria-controls"), control.listbox.id);
      equal(control.input.getAttribute("aria-activedescendant"), control.first.id);
      control.host.setAttribute("data-reference-target", "author-metadata");
      handle.hydrate();
      equal(native.nativeValue(control.root), "private-wrapper");
      equal(Object.getOwnPropertyDescriptor(control.root, "referenceTarget"), undefined);
      const registration = handle.register(control.root, { referenceTarget: "registration-metadata" });
      equal(native.nativeValue(control.root), "private-wrapper", "Cooperative registration does not replace a native target");
      registration.dispose();
      equal(native.nativeValue(control.root), "private-wrapper");
      handle.dispose();
      assertOriginal(control);
      equal(realm.Element.prototype.attachShadow, originalAttach);
      equal(Object.getOwnPropertyDescriptor(realm.ShadowRoot.prototype, "referenceTarget").get, originalProperty.get);
      equal(native.nativeValue(control.root), "private-wrapper");
    } finally {
      handle?.dispose();
      native.restore();
    }
  });
}
