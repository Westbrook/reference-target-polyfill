import { installReferenceTarget } from "../../src/core.js";
import { labels } from "../../src/adapters/labels.js";
import { popoverTargets } from "../../src/adapters/popover-targets.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [labels({ activation: "focus-and-click", naming: true }), popoverTargets()],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});
