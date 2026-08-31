import { installReferenceTarget } from "../../src/core.js";
import { textNames } from "../../src/adapters/text-names.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    textNames({ getText(host, kind) { return host.getAttribute(kind === "label" ? "data-label-text" : "data-description-text"); } }),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
