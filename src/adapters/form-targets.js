import {
  actionInvoker,
  asciiLowerCase,
  claimActivation,
  clickOnlyObservation,
} from "../internal/actions.js";

const SUBMITTER_ATTRIBUTES = [
  "name", "value", "formaction", "formmethod", "formenctype", "formtarget", "formnovalidate",
];

function actionFor(invoker) {
  if (invoker.localName === "input") {
    return ["submit", "reset", "image"].includes(invoker.type) ? invoker.type : null;
  }

  const type = asciiLowerCase(invoker.getAttribute("type") ?? "");
  if (type === "submit" || type === "reset") return type;
  if (type === "button") return null;

  // Missing and invalid button types use the current HTML Auto state. Command
  // attributes make such a button a non-submitter; explicit type=submit does
  // take precedence over those attributes when a form owner exists.
  return invoker.hasAttribute("command") || invoker.hasAttribute("commandfor") ? "none" : "submit";
}

/**
 * Forward external submit/reset controls whose form attribute targets a host
 * exposing a native form. External data controls are deliberately not adopted
 * or serialized, and .form/.elements/SubmitEvent.submitter remain untouched.
 */
export function formTargets() {
  return {
    id: "form-targets",
    priority: 200,
    attributes: ["form", "type", "disabled", "inert", "command", "commandfor", ...SUBMITTER_ATTRIBUTES],
    observation: clickOnlyObservation,
    check(window) {
      return (
        typeof window.HTMLFormElement?.prototype.requestSubmit === "function" &&
        typeof window.HTMLFormElement?.prototype.reset === "function"
      );
    },
    install(context) {
      const { window } = context;
      // Form named properties can shadow even methods such as requestSubmit,
      // reset, and appendChild. Use the realm's prototypes for every form call.
      const requestSubmit = window.HTMLFormElement.prototype.requestSubmit;
      const reset = window.HTMLFormElement.prototype.reset;
      const appendChild = window.Node.prototype.appendChild;
      const remove = window.Element.prototype.remove;
      const isConnected = Object.getOwnPropertyDescriptor(window.Node.prototype, "isConnected").get;
      const nativeFormGetters = {
        button: Object.getOwnPropertyDescriptor(window.HTMLButtonElement.prototype, "form").get,
        input: Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "form").get,
      };
      const submitting = new WeakSet();
      const resetting = new WeakSet();

      return {
        click(event, path) {
          // Do not pass context here: this adapter implements the forwarded
          // form owner that the other action adapters must defer to.
          const invoker = actionInvoker(event, path);
          if (!invoker || !invoker.hasAttribute("form")) return false;
          if (nativeFormGetters[invoker.localName].call(invoker)) return false;

          const action = actionFor(invoker);
          if (!action) return false;

          const reference = context.resolveReference(invoker, "form");
          if (!reference.forwarded) return false;
          const form = reference.target;
          if (!(form instanceof window.HTMLFormElement)) {
            context.report(form ? "unsupported-target" : "unresolved-target", {
              attribute: "form", source: invoker, host: reference.host,
            });
            // No effective form owner exists; another command or popover
            // action may therefore still be valid for this control.
            return false;
          }
          if (!claimActivation(event)) return false;

          // An Auto button with a command attribute has a form owner but is
          // not a submit button. Native activation stops at the form owner;
          // cancel the older engine's otherwise-enabled command/popover default.
          if (action === "none") return true;

          if (action === "image") {
            // The selected image coordinates are not exposed by requestSubmit.
            // Submitting a guessed (0,0) would silently change application data.
            context.report("unsupported-image-submitter", { source: invoker, host: reference.host });
            return true;
          }
          if (!isConnected.call(form)) return true;

          if (action === "reset") {
            if (resetting.has(form)) return true;
            resetting.add(form);
            try {
              reset.call(form);
            } finally {
              resetting.delete(form);
            }
            return true;
          }

          if (submitting.has(form)) return true;
          submitting.add(form);
          let proxy;
          try {
            // Preserve input submitters' native default-value behavior by
            // choosing the same element type. A hidden submit button still
            // participates in submission when passed to requestSubmit.
            proxy = invoker.ownerDocument.createElement(invoker.localName);
            proxy.type = "submit";
            proxy.hidden = true;
            proxy.tabIndex = -1;
            proxy.setAttribute("data-reference-target-submitter", "");
            for (const attribute of SUBMITTER_ATTRIBUTES) {
              if (!invoker.hasAttribute(attribute)) continue;
              // Resolve an authored URL against the source document. Crucially,
              // do not create absent overrides: their IDL defaults would mask
              // the form's own action/method/noValidate and dialog return value.
              const value = attribute === "formaction"
                ? invoker.formAction : invoker.getAttribute(attribute);
              proxy.setAttribute(attribute, value);
            }

            appendChild.call(form, proxy);
            if (proxy.matches(":disabled")) {
              // An enclosing disabled fieldset can disable an internal proxy
              // even when the real external submitter is enabled.
              context.report("disabled-submitter-proxy", { source: invoker, host: reference.host });
              return true;
            }

            // Native validation, formnovalidate, submit cancellation, formdata,
            // and method=dialog all run. SubmitEvent.submitter is honestly this
            // temporary proxy; events do not gain a cross-shadow event path.
            requestSubmit.call(form, proxy);
          } finally {
            if (proxy) remove.call(proxy);
            submitting.delete(form);
          }
          return true;
        },
      };
    },
  };
}
