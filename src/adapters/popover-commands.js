import {
  commandRuntime,
  hasPopoverPrimitives,
  isHTMLElement,
  runPopoverAction,
} from "../internal/actions.js";

const COMMANDS = new Set(["toggle-popover", "show-popover", "hide-popover"]);

/** Forward built-in popover commands, including cancelable command events. */
export function popoverCommands() {
  return {
    id: "popover-commands",
    priority: 90,
    attributes: ["commandfor", "command", "type", "disabled", "inert", "popover"],
    check: hasPopoverPrimitives,
    install(context) {
      return commandRuntime(context, {
        commands: COMMANDS,
        // Native dispatch permits these commands on any HTML element. Its
        // command handler may set popover before the default action runs.
        accepts: isHTMLElement,
        act(target, invoker, command) {
          runPopoverAction(context, target, invoker, command.slice(0, -"-popover".length));
        },
      });
    },
  };
}
