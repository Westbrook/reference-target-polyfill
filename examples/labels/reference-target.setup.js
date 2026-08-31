import { installReferenceTarget } from "../../src/core.js";
import { labels } from "../../src/adapters/labels.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    labels({ activation: "focus-and-click", naming: true }),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
