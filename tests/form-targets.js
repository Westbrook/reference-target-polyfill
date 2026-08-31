import { formTargets } from "../src/adapters/form-targets.js";
import { dialogCommands } from "../src/adapters/dialog-commands.js";
import { popoverTargets } from "../src/adapters/popover-targets.js";

/** Register form behavior tests with the shared, cleanup-aware browser runner. */
export function registerFormTargetTests({
  test, assert, equal, throws, requirePrimitive, element, syntheticClick, uniqueId,
}) {
  function requireForms() {
    requirePrimitive(
      typeof HTMLFormElement.prototype.requestSubmit === "function",
      "Native form.requestSubmit unavailable",
    );
  }

  function forwardedForm(fixture, { mode = "closed", target = "form" } = {}) {
    const host = element("div", { id: uniqueId("form-host") });
    fixture.append(host);
    const root = host.attachShadow({ mode, referenceTarget: target });
    const form = element("form", { id: "form" });
    root.append(form);
    return { host, root, form };
  }

  function externalControl(fixture, host, attributes = {}, tag = "button") {
    const control = element(tag, {
      type: "submit", form: host.id, ...attributes,
    }, tag === "button" ? "External form action" : undefined);
    fixture.append(control);
    return control;
  }

  function countSubmissions(form, callback = () => {}) {
    let count = 0;
    form.addEventListener("submit", (event) => {
      // Every real submission in this suite is canceled before any assertion.
      event.preventDefault();
      count++;
      callback(event);
    });
    return () => count;
  }

  test("Form targets submit closed-root native fields with a temporary submitter", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const text = element("input", { name: "display-name", value: "Ada" });
    const checked = element("input", { type: "checkbox", name: "updates", value: "yes", checked: "" });
    const unchecked = element("input", { type: "checkbox", name: "omitted", value: "no" });
    const disabled = element("input", { name: "disabled", value: "omitted", disabled: "" });
    const select = element("select", { name: "digest" });
    select.append(element("option", { value: "daily" }, "Daily"), element("option", { value: "weekly", selected: "" }, "Weekly"));
    form.append(text, checked, unchecked, disabled, select);
    const source = externalControl(fixture, host, { name: "intent", value: "save" });
    const externalText = externalControl(fixture, host, { type: "text", name: "unowned-control", value: "outside" }, "input");
    let proxy;
    let serialized;
    let temporaryOwner;
    let temporaryVisibility;
    const submissions = countSubmissions(form, (event) => {
      proxy = event.submitter;
      temporaryOwner = proxy.form;
      temporaryVisibility = proxy.hidden && proxy.isConnected;
      serialized = [...new FormData(form, proxy)];
    });
    equal(source.form, null, "The adapter must not invent a form owner getter");
    source.click();
    equal(submissions(), 1);
    assert(proxy && proxy !== source, "SubmitEvent.submitter is the documented temporary native submitter");
    equal(temporaryOwner, form);
    assert(temporaryVisibility, "The proxy exists only during native submission and is hidden");
    equal(JSON.stringify(serialized), JSON.stringify([
      ["display-name", "Ada"], ["updates", "yes"], ["digest", "weekly"], ["intent", "save"],
    ]));
    equal(proxy.getAttribute("name"), "intent");
    equal(proxy.getAttribute("value"), "save");
    assert(!proxy.isConnected, "A canceled submission must remove its proxy synchronously");
    equal(form.elements.length, 5);
    equal(source.form, null);
    equal(externalText.form, null, "The action adapter does not adopt external data controls");
  });

  test("Form targets preserve submitter overrides and leave absent overrides absent", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    form.setAttribute("action", "/native-form-action");
    form.setAttribute("method", "get");
    form.setAttribute("enctype", "application/x-www-form-urlencoded");
    form.setAttribute("target", "native-form-window");
    const source = externalControl(fixture, host, {
      name: "intent", value: "draft", formaction: "./submitter-action?draft=1",
      formmethod: "post", formenctype: "multipart/form-data", formtarget: "_self", formnovalidate: "",
    });
    const captured = [];
    countSubmissions(form, (event) => captured.push(event.submitter));
    source.click();
    equal(captured.length, 1);
    equal(captured[0].formAction, source.formAction);
    equal(captured[0].formMethod, "post");
    equal(captured[0].formEnctype, "multipart/form-data");
    equal(captured[0].formTarget, "_self");
    assert(captured[0].formNoValidate);
    assert(!captured[0].hasAttribute("form"), "The proxy is owned by its actual parent form");
    for (const attribute of ["formaction", "formmethod", "formenctype", "formtarget", "formnovalidate"]) source.removeAttribute(attribute);
    source.click();
    equal(captured.length, 2);
    for (const attribute of ["formaction", "formmethod", "formenctype", "formtarget", "formnovalidate"]) {
      assert(!captured[1].hasAttribute(attribute), `${attribute} must remain absent so form defaults apply`);
    }
    equal(form.getAttribute("action"), "/native-form-action");
    equal(form.getAttribute("method"), "get");
    equal(form.getAttribute("enctype"), "application/x-www-form-urlencoded");
    equal(form.getAttribute("target"), "native-form-window");
    assert(captured.every((proxy) => !proxy.isConnected));
  });

  test("Form targets preserve native validation, formnovalidate, and form novalidate", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const email = element("input", { name: "email", type: "email", required: "" });
    form.append(email);
    let invalidEvents = 0;
    email.addEventListener("invalid", (event) => { invalidEvents++; event.preventDefault(); });
    const submissions = countSubmissions(form);
    const source = externalControl(fixture, host);
    source.click();
    equal(submissions(), 0);
    equal(invalidEvents, 1);
    equal(form.elements.length, 1, "Failed validation must also remove its temporary submitter");
    source.setAttribute("formnovalidate", "");
    source.click();
    equal(submissions(), 1);
    equal(invalidEvents, 1, "Submitter override skips native validation");
    source.removeAttribute("formnovalidate");
    email.value = "not-an-email";
    source.click();
    equal(submissions(), 1);
    equal(invalidEvents, 2);
    email.value = "ada@example.test";
    source.click();
    equal(submissions(), 2);
    email.value = "";
    form.noValidate = true;
    source.click();
    equal(submissions(), 3);
    equal(invalidEvents, 2, "The form's own novalidate behavior remains native");
    equal(form.elements.length, 1);
  });

  test("Form targets support submit inputs and default or invalid button types", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const captured = [];
    const submissions = countSubmissions(form, (event) => captured.push({
      tag: event.submitter.localName,
      entries: [...new FormData(form, event.submitter)],
    }));
    const input = externalControl(fixture, host, { name: "intent", value: "input-save" }, "input");
    input.click();
    const defaultButton = externalControl(fixture, host, { name: "intent", value: "default-save" });
    defaultButton.removeAttribute("type");
    defaultButton.click();
    const invalidButton = externalControl(fixture, host, { type: "unknown", name: "intent", value: "invalid-save" });
    invalidButton.click();
    equal(submissions(), 3);
    equal(JSON.stringify(captured), JSON.stringify([
      { tag: "input", entries: [["intent", "input-save"]] },
      { tag: "button", entries: [["intent", "default-save"]] },
      { tag: "button", entries: [["intent", "invalid-save"]] },
    ]));
    equal(form.elements.length, 0);
  });

  test("Form targets reset native defaults and honor a canceled reset", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const text = element("input", { name: "display-name", value: "Default name" });
    const checkbox = element("input", { type: "checkbox", name: "updates", checked: "" });
    const select = element("select", { name: "digest" });
    select.append(element("option", { value: "daily", selected: "" }, "Daily"), element("option", { value: "weekly" }, "Weekly"));
    form.append(text, checkbox, select);
    text.value = "Edited name";
    checkbox.checked = false;
    select.value = "weekly";
    let resets = 0;
    let cancel = true;
    form.addEventListener("reset", (event) => {
      resets++;
      if (cancel) event.preventDefault();
    });
    const button = externalControl(fixture, host, { type: "reset" });
    button.click();
    equal(resets, 1);
    equal(text.value, "Edited name");
    equal(checkbox.checked, false);
    equal(select.value, "weekly");
    cancel = false;
    button.click();
    equal(resets, 2);
    equal(text.value, "Default name");
    equal(checkbox.checked, true);
    equal(select.value, "daily");
    text.value = "Edited again";
    externalControl(fixture, host, { type: "reset" }, "input").click();
    equal(resets, 3);
    equal(text.value, "Default name");
    equal(form.elements.length, 3, "Reset must not add a submitter proxy");
    equal(button.form, null);
  });

  test("Form target activation respects canceled clicks, disabled controls, fieldsets, and inert ancestors", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const submissions = countSubmissions(form);
    const canceled = externalControl(fixture, host);
    canceled.addEventListener("click", (event) => event.preventDefault());
    canceled.click();
    const disabled = externalControl(fixture, host, { disabled: "" });
    syntheticClick(disabled);
    const fieldset = element("fieldset", { disabled: "" });
    fixture.append(fieldset);
    syntheticClick(externalControl(fieldset, host));
    const inert = element("div", { inert: "" });
    fixture.append(inert);
    syntheticClick(externalControl(inert, host));
    const noncancelable = externalControl(fixture, host);
    noncancelable.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: false }));
    noncancelable.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 2 }));
    equal(submissions(), 0);
    const legend = element("legend");
    fieldset.prepend(legend);
    externalControl(legend, host).click();
    equal(submissions(), 1, "The first legend's native fieldset exception is retained");
  });

  test("Form targets resolve current IDs through nested closed roots", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const outer = element("div", { id: uniqueId("outer-form-host") });
    fixture.append(outer);
    const outerRoot = outer.attachShadow({ mode: "closed", referenceTarget: "bridge" });
    const bridge = element("div", { id: "bridge" });
    outerRoot.append(bridge);
    const innerRoot = bridge.attachShadow({ mode: "closed", referenceTarget: "first-form" });
    const first = element("form", { id: "first-form" });
    const second = element("form", { id: "second-form" });
    innerRoot.append(first, second);
    const firstSubmissions = countSubmissions(first);
    const secondSubmissions = countSubmissions(second);
    const source = externalControl(fixture, outer);
    source.click();
    equal(firstSubmissions(), 1);
    innerRoot.referenceTarget = "second-form";
    source.click();
    equal(secondSubmissions(), 1);
    second.id = "renamed-form";
    source.click();
    equal(secondSubmissions(), 1, "A removed target ID must stop forwarding immediately");
    innerRoot.referenceTarget = "renamed-form";
    source.click();
    equal(secondSubmissions(), 2);
    innerRoot.referenceTarget = "";
    source.click();
    innerRoot.referenceTarget = null;
    source.click();
    equal(secondSubmissions(), 2);
    equal(firstSubmissions(), 1);
    equal(source.form, null);
  });

  test("Form targets ignore missing or non-form targets and keep ID resolution within the source tree", ({ fixture, install }) => {
    requireForms();
    const diagnostics = [];
    install([formTargets()], { onDiagnostic: (entry) => diagnostics.push(entry) });
    const { host, root, form } = forwardedForm(fixture, { target: "missing" });
    const submissions = countSubmissions(form);
    const source = externalControl(fixture, host);
    source.click();
    root.referenceTarget = "wrong";
    root.append(element("div", { id: "wrong" }));
    source.click();
    equal(submissions(), 0);
    assert(diagnostics.length >= 2, "Unsupported associations should explain why they could not be forwarded");
    root.referenceTarget = "form";
    const sameID = element("form", { id: host.id });
    const treeHost = element("div");
    fixture.append(treeHost);
    const treeRoot = treeHost.attachShadow({ mode: "closed" });
    treeRoot.append(sameID);
    const sameTreeSubmissions = countSubmissions(sameID);
    const innerSource = externalControl(treeRoot, host);
    innerSource.click();
    equal(sameTreeSubmissions(), 1, "The source's ordinary same-tree form owner remains authoritative");
    equal(submissions(), 0, "The document's host must not override a same-tree form owner");
    equal(innerSource.form, sameID);
  });

  test("Named controls cannot shadow the native submission or reset methods used by form targets", ({ fixture, install }) => {
    requireForms();
    const handle = install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const submitName = element("input", { name: "requestSubmit", value: "native submit" });
    const resetName = element("input", { name: "reset", value: "native reset" });
    const appendName = element("input", { name: "appendChild", value: "native append" });
    const connectedName = element("input", { name: "isConnected", value: "native connection" });
    const shadowName = element("input", { name: "shadowRoot", value: "native shadow root" });
    const documentName = element("input", { name: "ownerDocument", value: "native document" });
    form.append(submitName, resetName, appendName, connectedName, shadowName, documentName);
    equal(form.requestSubmit, submitName);
    equal(form.reset, resetName);
    equal(form.appendChild, appendName);
    equal(form.isConnected, connectedName);
    equal(form.shadowRoot, shadowName);
    equal(form.ownerDocument, documentName);
    handle.refresh();
    const submissions = countSubmissions(form);
    externalControl(fixture, host).click();
    equal(submissions(), 1);
    resetName.value = "Edited";
    externalControl(fixture, host, { type: "reset" }).click();
    equal(resetName.value, "native reset");
    equal(form.elements.length, 6);
  });

  test("Form targets retain native method=dialog behavior for absent, empty, and chosen submitter values", ({ fixture, install }) => {
    requireForms();
    requirePrimitive(typeof HTMLDialogElement.prototype.show === "function", "Dialog primitives unavailable");
    install([formTargets()]);
    const { host, root, form } = forwardedForm(fixture);
    const dialog = element("dialog");
    root.append(dialog);
    dialog.append(form);
    form.method = "dialog";
    form.append(element("input", { name: "display-name", value: "Fallback form" }));
    const source = externalControl(fixture, host);

    const nativeDialog = element("dialog");
    const nativeForm = element("form", { id: uniqueId("native-dialog-form"), method: "dialog" });
    nativeForm.append(element("input", { name: "display-name", value: "Native form" }));
    nativeDialog.append(nativeForm);
    fixture.append(nativeDialog);
    const nativeSource = externalControl(fixture, nativeForm);
    const submitters = [];
    // These submissions cannot navigate: both forms use method=dialog. Allow
    // their native default so returnValue behavior can be compared directly.
    form.addEventListener("submit", (event) => submitters.push(event.submitter));
    try {
      for (const value of [null, "", "chosen"]) {
        for (const control of [source, nativeSource]) {
          if (value === null) control.removeAttribute("value");
          else control.setAttribute("value", value);
        }
        nativeDialog.returnValue = "previous";
        nativeDialog.show();
        nativeSource.click();
        assert(!nativeDialog.open, "The ordinary native dialog form must close");

        dialog.returnValue = "previous";
        dialog.show();
        source.click();
        assert(!dialog.open, "The forwarded dialog form must also close");
        equal(dialog.returnValue, nativeDialog.returnValue, `Native returnValue parity for ${value === null ? "an absent value" : JSON.stringify(value)}`);
        if (value !== null) equal(dialog.returnValue, value);
        const proxy = submitters.at(-1);
        equal(proxy.getAttribute("value"), value, "An absent value must not become an authored empty value");
        assert(!proxy.isConnected);
        equal(form.elements.length, 1);
      }
      equal(submitters.length, 3);
    } finally {
      nativeDialog.close();
      dialog.close();
    }
  });

  test("A selected form target action takes precedence over command and popover targets", ({ fixture, install }) => {
    requireForms();
    requirePrimitive(typeof HTMLDialogElement.prototype.showModal === "function" && typeof HTMLElement.prototype.showPopover === "function", "Dialog and popover primitives unavailable");
    install([popoverTargets(), dialogCommands(), formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const actionHost = element("div", { id: uniqueId("action-host") });
    fixture.append(actionHost);
    const actionRoot = actionHost.attachShadow({ mode: "closed", referenceTarget: "action" });
    const dialog = element("dialog", { id: "action", popover: "manual" });
    actionRoot.append(dialog);
    const submissions = countSubmissions(form);
    let resets = 0;
    form.addEventListener("reset", () => resets++);
    const source = externalControl(fixture, host, {
      commandfor: actionHost.id, command: "show-modal", popovertarget: actionHost.id,
    });
    source.click();
    equal(submissions(), 1);
    assert(!dialog.open && !dialog.matches(":popover-open"));
    source.type = "reset";
    source.click();
    equal(resets, 1);
    assert(!dialog.open && !dialog.matches(":popover-open"));
    source.type = "button";
    source.click();
    assert(dialog.open, "An explicit type=button remains eligible for its command action");
    dialog.close();
  });

  test("Unselected form targets do not let submit/reset controls fall through to command or popover actions", ({ fixture, install }) => {
    requireForms();
    requirePrimitive(typeof HTMLDialogElement.prototype.showModal === "function" && typeof HTMLElement.prototype.showPopover === "function", "Dialog and popover primitives unavailable");
    install([popoverTargets(), dialogCommands()]);
    const { host, form } = forwardedForm(fixture);
    const actionHost = element("div", { id: uniqueId("action-host") });
    fixture.append(actionHost);
    const actionRoot = actionHost.attachShadow({ mode: "closed", referenceTarget: "action" });
    const dialog = element("dialog", { id: "action", popover: "manual" });
    actionRoot.append(dialog);
    const submissions = countSubmissions(form);
    let resets = 0;
    form.addEventListener("reset", () => resets++);
    const source = externalControl(fixture, host, {
      commandfor: actionHost.id, command: "show-modal", popovertarget: actionHost.id,
    });
    source.click();
    assert(!dialog.open && !dialog.matches(":popover-open"), "An unselected form adapter must not change submit into a command");
    source.type = "reset";
    source.click();
    assert(!dialog.open && !dialog.matches(":popover-open"), "An unselected form adapter must not change reset into a command");
    source.removeAttribute("commandfor");
    source.removeAttribute("command");
    source.type = "submit";
    source.click();
    assert(!dialog.matches(":popover-open"), "The ordinary popover adapter also honors a forwarded form owner");
    source.type = "reset";
    source.click();
    assert(!dialog.matches(":popover-open"));
    const nativePopover = element("div", { id: uniqueId("native-popover"), popover: "manual" });
    fixture.append(nativePopover);
    source.setAttribute("popovertarget", nativePopover.id);
    source.type = "submit";
    const submitClick = syntheticClick(source);
    assert(submitClick.defaultPrevented, "The native action must be canceled too when its form adapter is unselected");
    assert(!nativePopover.matches(":popover-open"));
    source.type = "reset";
    const resetClick = syntheticClick(source);
    assert(resetClick.defaultPrevented);
    assert(!nativePopover.matches(":popover-open"));
    equal(submissions(), 0);
    equal(resets, 0);
  });

  test("Auto buttons with a forwarded form owner retain command-related non-submitter behavior", ({ fixture, install }) => {
    requireForms();
    requirePrimitive(typeof HTMLDialogElement.prototype.showModal === "function", "Dialog primitives unavailable");
    install([formTargets(), dialogCommands()]);
    const { host, form } = forwardedForm(fixture);
    const dialog = element("dialog", { id: uniqueId("native-dialog") });
    fixture.append(dialog);
    const submissions = countSubmissions(form);
    const source = externalControl(fixture, host, { commandfor: dialog.id, command: "show-modal" });
    source.removeAttribute("type");
    const event = syntheticClick(source);
    equal(submissions(), 0);
    assert(!dialog.open, "The native command default must not run after finding a forwarded form owner");
    assert(event.defaultPrevented);
    source.type = "button";
    source.click();
    if ("commandForElement" in HTMLButtonElement.prototype) {
      assert(dialog.open, "An explicit type=button can still use a native ordinary command target");
      dialog.close();
    }
  });

  test("A form inside a disabled fieldset reports the proxy limitation and cleans up", ({ fixture, install }) => {
    requireForms();
    const diagnostics = [];
    install([formTargets()], { onDiagnostic: (entry) => diagnostics.push(entry) });
    const { host, root, form } = forwardedForm(fixture);
    const fieldset = element("fieldset", { disabled: "" });
    root.append(fieldset);
    fieldset.append(form);
    const submissions = countSubmissions(form);
    const source = externalControl(fixture, host, { name: "intent", value: "save" });
    assert(!source.matches(":disabled"));
    source.click();
    equal(submissions(), 0, "The fallback must not silently omit the enabled source's submitter data");
    assert(diagnostics.some(({ code }) => code === "disabled-submitter-proxy"));
    equal(form.elements.length, 0);
  });

  test("Form targets report image submitters without fabricating coordinate data", ({ fixture, install }) => {
    requireForms();
    const diagnostics = [];
    install([formTargets()], { onDiagnostic: (entry) => diagnostics.push(entry) });
    const { host, form } = forwardedForm(fixture);
    const submissions = countSubmissions(form);
    externalControl(fixture, host, { type: "image", name: "position", alt: "Choose position" }, "input").click();
    equal(submissions(), 0);
    assert(diagnostics.some(({ code }) => code === "unsupported-image-submitter"));
    equal(form.elements.length, 0);
  });

  test("Form targets clean up their submitter even if the captured requestSubmit implementation throws", ({ fixture, install }) => {
    requireForms();
    const prototype = HTMLFormElement.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, "requestSubmit");
    requirePrimitive(original?.configurable, "requestSubmit cannot be wrapped for the isolated cleanup test");
    let runtime;
    let proxy;
    let fail = true;
    try {
      Object.defineProperty(prototype, "requestSubmit", {
        ...original,
        value(submitter) {
          proxy = submitter;
          if (fail) throw new Error("Application requestSubmit failure");
          return original.value.call(this, submitter);
        },
      });
      const adapter = formTargets();
      install([{ ...adapter, install(context) { runtime = adapter.install(context); return runtime; } }]);
      const { host, form } = forwardedForm(fixture);
      const submissions = countSubmissions(form);
      const source = externalControl(fixture, host);
      const event = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 0 });
      // Invoke the runtime directly: an intentional exception should propagate
      // to this caller instead of becoming an uncaught browser event error.
      throws(() => runtime.click(event, [source, fixture, document, window]), /Application requestSubmit failure/);
      assert(proxy, "The native call must receive the temporary submitter");
      assert(!proxy.isConnected, "Cleanup must run in the exception path");
      equal(form.elements.length, 0);
      equal(source.form, null);
      fail = false;
      source.click();
      equal(submissions(), 1, "An exception must release the per-form reentrancy guard");
      assert(!proxy.isConnected);
    } finally {
      Object.defineProperty(prototype, "requestSubmit", original);
    }
  });

  test("Form target reentrancy cannot recursively submit the same form", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const { host, form } = forwardedForm(fixture);
    const source = externalControl(fixture, host);
    const otherSource = externalControl(fixture, host);
    let submissions = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submissions++;
      if (submissions === 1) otherSource.click();
    });
    source.click();
    equal(submissions, 1);
    equal(form.elements.length, 0);
    source.click();
    equal(submissions, 2, "The per-form guard must be released after submission");
  });

  test("Form targets leave ordinary native form ownership, submitters, and reset behavior intact", ({ fixture, install }) => {
    requireForms();
    install([formTargets()]);
    const form = element("form", { id: uniqueId("ordinary-form") });
    const text = element("input", { name: "display-name", value: "Native default" });
    form.append(text);
    fixture.append(form);
    const source = externalControl(fixture, form, { name: "intent", value: "native" });
    let submitter;
    let data;
    const submissions = countSubmissions(form, (event) => {
      submitter = event.submitter;
      data = [...new FormData(form, event.submitter)];
    });
    source.click();
    equal(submissions(), 1);
    equal(source.form, form);
    equal(submitter, source);
    equal(JSON.stringify(data), JSON.stringify([["display-name", "Native default"], ["intent", "native"]]));
    text.value = "Edited";
    externalControl(fixture, form, { type: "reset" }).click();
    equal(text.value, "Native default");
    equal(form.querySelectorAll("[data-reference-target-submitter]").length, 0);
  });
}
