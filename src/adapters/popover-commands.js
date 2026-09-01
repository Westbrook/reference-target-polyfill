import {
  clickOnlyObservation,
  commandRuntime,
  hasPopoverPrimitives,
  isHTMLElement,
  popoverPrimitives,
  runPopoverAction,
} from "../internal/actions.js";

const COMMANDS = new Set(["toggle-popover", "show-popover", "hide-popover"]);

/** Forward built-in popover commands, including cancelable command events. */
export function popoverCommands() {
  return {
    id: "popover-commands",
    priority: 90,
    attributes: ["commandfor", "command", "type", "disabled", "inert", "popover"],
    observation: clickOnlyObservation,
    check: hasPopoverPrimitives,
    install(context) {
      const primitives = popoverPrimitives(context.window);
      return commandRuntime(context, {
        commands: COMMANDS,
        // Native dispatch permits these commands on any HTML element. Its
        // command handler may set popover before the default action runs.
        accepts: isHTMLElement,
        act(target, invoker, command) {
          runPopoverAction(
            context,
            target,
            invoker,
            command.slice(0, -"-popover".length),
            primitives,
          );
        },
      });
    },
  };
}
