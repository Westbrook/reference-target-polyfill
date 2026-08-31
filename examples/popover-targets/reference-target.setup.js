import { installReferenceTarget } from "../../src/core.js";
import { popoverTargets } from "../../src/adapters/popover-targets.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    popoverTargets(),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
