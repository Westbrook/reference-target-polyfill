import { installReferenceTarget } from "../../src/core.js";
import { dialogCommands } from "../../src/adapters/dialog-commands.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    dialogCommands(),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
