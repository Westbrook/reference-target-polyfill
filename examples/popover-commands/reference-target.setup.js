import { installReferenceTarget } from "../../src/core.js";
import { popoverCommands } from "../../src/adapters/popover-commands.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    popoverCommands(),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
