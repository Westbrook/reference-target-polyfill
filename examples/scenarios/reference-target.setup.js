import { installReferenceTarget } from "../../src/core.js";
import { labels } from "../../src/adapters/labels.js";
import { popoverTargets } from "../../src/adapters/popover-targets.js";
import { textNames } from "../../src/adapters/text-names.js";

export const referenceTargetFallback = installReferenceTarget({
  force: new URL(location.href).searchParams.get("mode") === "fallback",
  adapters: [
    labels({ activation: "focus-and-click", naming: true }),
    popoverTargets(),
    textNames({
      getText(host, kind) {
        if (host.localName !== "rt-scenario-label" || kind !== "label") return null;
        return host.getAttribute("data-label-text");
      },
    }),
  ],
});

// The HTML parser has already consumed the declarative templates. The public
// data-reference-target metadata retains their intended IDs for older engines.
referenceTargetFallback.hydrate(document);
