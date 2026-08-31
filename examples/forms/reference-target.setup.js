import { installReferenceTarget } from "../../src/core.js";
import { formTargets } from "../../src/adapters/form-targets.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    formTargets(),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
