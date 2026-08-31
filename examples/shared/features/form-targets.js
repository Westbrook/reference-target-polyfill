const section = document.getElementById("form-targets");

if (section) {
  const host = section.querySelector("#profile-form");
  const root = host?.shadowRoot;
  const form = root?.getElementById("inner-form");
  const capability = section.querySelector("#form-capability");
  const status = section.querySelector("#form-status");
  const output = section.querySelector("#submission-output");
  const eventLog = section.querySelector("#event-log");
  const submitButton = section.querySelector("#submit-profile");
  const draftButton = section.querySelector("#save-draft");
  const resetButton = section.querySelector("#reset-profile");

  if (!form) {
    section.dataset.ready = "unsupported";
    capability.textContent = "Unavailable: this browser did not create the declarative shadow root. The form and toolbar remain disabled.";
    status.textContent = "No form is available to observe. This example requires declarative shadow DOM.";
    section.querySelector("#form-owner-output").textContent = "No shadow-root form was created.";
  } else {
    let eventNumber = 0;

    function observe(type, message) {
      eventLog.querySelector(".empty")?.remove();
      const entry = document.createElement("li");
      entry.dataset.event = type;
      const label = document.createElement("strong");
      label.textContent = `${++eventNumber}. ${type}`;
      entry.append(label, ` · ${message}`);
      eventLog.prepend(entry);
      while (eventLog.children.length > 8) eventLog.lastElementChild.remove();
    }

    function describeOwner(owner) {
      return owner ? `<${owner.localName}${owner.id ? ` id="${owner.id}"` : ""}>` : "null";
    }

    function renderOwners() {
      section.querySelector("#form-owner-output").textContent = [submitButton, draftButton, resetButton]
        .map(button => `${button.id}.form: ${describeOwner(button.form)}`)
        .join("\n");
    }

    form.addEventListener("invalid", event => {
      const control = event.target;
      observe("invalid", `${control.name || control.id}: ${control.validationMessage}`);
      status.textContent = "Native validation rejected a field. No submit event was fired; fix the email or choose Save draft.";
    }, true);

    form.addEventListener("formdata", () => {
      observe("formdata", "The FormData constructor collected the successful controls.");
    });

    form.addEventListener("submit", event => {
      // Cancel navigation first, including submissions caused by pressing Enter.
      event.preventDefault();
      try {
        const submitter = event.submitter;
        // The fallback removes its temporary submitter when this dispatch ends.
        // Read the browser's data synchronously while the proxy still exists.
        const data = new FormData(form, submitter);
        const proxy = submitter?.hasAttribute("data-reference-target-submitter") ?? false;
        const result = {
          entries: Array.from(data.entries()),
          submitter: submitter ? {
            element: submitter.localName,
            id: submitter.id || null,
            name: submitter.name,
            value: submitter.value,
            formNoValidate: submitter.formNoValidate,
            fallbackProxy: proxy,
          } : null,
        };
        output.textContent = JSON.stringify(result, null, 2);
        const intent = submitter?.value || "implicit submission";
        observe("submit", `${intent}; navigation canceled${proxy ? "; internal submitter proxy" : ""}.`);
        status.textContent = `${intent === "draft" ? "Draft captured" : "Submission captured"}. ${proxy ? "The event’s submitter is the fallback’s internal proxy." : "The readout contains the event’s actual submitter."} No data was sent.`;
        renderOwners();
      } catch (error) {
        observe("submit", "Navigation was canceled, but this browser could not construct FormData with the submitter.");
        status.textContent = "Submission was canceled. FormData inspection failed; see the browser console for details.";
        console.error("Unable to inspect form data:", error);
      }
    });

    form.addEventListener("reset", event => {
      // Read after native reset's default action rather than assigning values.
      queueMicrotask(() => {
        if (event.defaultPrevented) {
          observe("reset", "The reset event was canceled.");
          status.textContent = "The reset event was canceled; the browser kept the existing values.";
          return;
        }
        const name = root.getElementById("display-name").value;
        const email = root.getElementById("email").value;
        const digest = root.getElementById("digest").value;
        const updates = root.getElementById("updates").checked;
        section.querySelector("#reset-output").textContent = `Observed after reset: name “${name}”; email ${email ? `“${email}”` : "empty"}; digest ${digest}; updates ${updates ? "checked" : "unchecked"}.`;
        observe("reset", "The browser restored the form controls’ default values.");
        status.textContent = "Native reset completed. The latest submission stays visible for comparison.";
        renderOwners();
      });
    });

    const submitAvailable = typeof HTMLFormElement.prototype.requestSubmit === "function";
    const resetAvailable = typeof HTMLFormElement.prototype.reset === "function";
    let submitterDataAvailable = false;
    if (typeof FormData === "function") {
      try {
        // Older constructors can silently ignore the submitter argument.
        const probeForm = document.createElement("form");
        const probeButton = document.createElement("button");
        probeButton.type = "submit";
        probeButton.name = "submitter-probe";
        probeButton.value = "included";
        probeForm.append(probeButton);
        submitterDataAvailable = new FormData(probeForm, probeButton).get("submitter-probe") === "included";
      } catch {
        submitterDataAvailable = false;
      }
    }

    // All cancellation and observation handlers are installed before controls
    // become usable. This module is initialized solely by importing it.
    root.getElementById("form-fields").disabled = false;
    submitButton.disabled = !submitAvailable || !submitterDataAvailable;
    draftButton.disabled = !submitAvailable || !submitterDataAvailable;
    resetButton.disabled = !resetAvailable;
    renderOwners();

    const unavailable = [];
    if (!submitAvailable) unavailable.push("requestSubmit()");
    if (!resetAvailable) unavailable.push("reset()");
    if (!submitterDataAvailable) unavailable.push("FormData(form, submitter)");
    section.dataset.ready = unavailable.length ? "unsupported" : "ready";
    capability.textContent = unavailable.length
      ? `Some actions remain disabled: this browser lacks ${unavailable.join(", ")}. Available controls can still be tried.`
      : submitButton.form
        ? "Ready · The outside buttons have a native form owner. Submit validates, Save draft skips validation, and Reset restores defaults."
        : "Ready · The native form getters are null. Try the toolbar to observe whether the selected mode forwards actions; without forwarding, no form event occurs.";
  }
}
