import {
  clickOnlyObservation,
  commandRuntime,
  invokeNativeAction,
  isHTMLElement,
} from "../internal/actions.js";

const COMMANDS = new Set(["show-modal", "close", "request-close"]);

/** Forward the three built-in dialog commands to native dialog methods. */
export function dialogCommands() {
  return {
    id: "dialog-commands",
    priority: 100,
    attributes: ["commandfor", "command", "type", "disabled", "inert", "open", "value"],
    observation: clickOnlyObservation,
    check(window) {
      return (
        typeof window.HTMLDialogElement?.prototype.showModal === "function" &&
        typeof window.HTMLDialogElement?.prototype.close === "function"
      );
    },
    install(context) {
      const prototype = context.window.HTMLDialogElement.prototype;
      const primitives = {
        showModal: prototype.showModal,
        close: prototype.close,
        requestClose: prototype.requestClose,
      };
      const showPopover = context.window.HTMLElement?.prototype.showPopover;
      return commandRuntime(context, {
        commands: COMMANDS,
        accepts: (target) => isHTMLElement(target) && target.localName === "dialog",
        act(target, invoker, command) {
          // A dialog being used as a popover cannot accept dialog commands.
          if (
            target.hasAttribute("popover") &&
            typeof showPopover === "function" &&
            target.matches(":popover-open")
          ) return;

          const opening = command === "show-modal";
          if (opening === target.hasAttribute("open")) return;

          const method = opening ? "showModal" : command === "close" ? "close" : "requestClose";
          const nativeMethod = primitives[method];
          if (typeof nativeMethod !== "function") {
            context.report("missing-primitive", { method, command, source: invoker });
            return;
          }

          // Omitting the return value preserves the dialog's current value;
          // passing an empty string is meaningful when value="" was authored.
          const argumentsList = !opening && invoker.hasAttribute("value") ? [invoker.value] : [];
          invokeNativeAction(context, target, method, nativeMethod, argumentsList, invoker);
        },
      });
    },
  };
}
