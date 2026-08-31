import {
  actionInvoker,
  asciiLowerCase,
  claimActivation,
  hasPopoverPrimitives,
  isHTMLElement,
  runPopoverAction,
  shadowIncludingContains,
} from "../internal/actions.js";

/** Forward popovertarget activation to an existing native popover. */
export function popoverTargets() {
  return {
    id: "popover-targets",
    priority: 50,
    attributes: ["popovertarget", "popovertargetaction", "commandfor", "command", "type", "disabled", "inert", "popover"],
    check: hasPopoverPrimitives,
    install(context) {
      return {
        click(event, path) {
          const invoker = actionInvoker(event, path, false, context);
          if (!invoker) return false;

          if (invoker.localName === "button") {
            const command = context.resolveReference(invoker, "commandfor", "commandForElement");
            // Preserve command precedence even when its adapter was not
            // selected or its command is unknown. A configured but unresolved
            // reference is conservatively suppressed by the command adapter.
            if (command.target || command.forwarded) return false;
          }

          const reference = context.resolveReference(invoker, "popovertarget", "popoverTargetElement");
          if (!reference.forwarded) return false;
          if (!claimActivation(event)) return false;

          const target = reference.target;
          if (!isHTMLElement(target) || !target.hasAttribute("popover")) {
            context.report(target ? "unsupported-target" : "unresolved-target", {
              attribute: "popovertarget", source: invoker, host: reference.host,
            });
            return true;
          }

          if (
            shadowIncludingContains(invoker, target) &&
            shadowIncludingContains(target, path[0])
          ) return true;

          const action = asciiLowerCase(invoker.getAttribute("popovertargetaction") ?? "");
          // This attribute has a Toggle invalid-value default; command does
          // not, and is deliberately parsed separately by commandRuntime.
          runPopoverAction(context, target, invoker, action === "show" || action === "hide" ? action : "toggle");
          return true;
        },
      };
    },
  };
}
