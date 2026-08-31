import { installReferenceTarget } from "./../src/core.js";
import { labels } from "./../src/adapters/labels.js";
import { popoverTargets } from "./../src/adapters/popover-targets.js";
import { dialogCommands } from "./../src/adapters/dialog-commands.js";
import { popoverCommands } from "./../src/adapters/popover-commands.js";
import { textNames } from "./../src/adapters/text-names.js";
import { formTargets } from "./../src/adapters/form-targets.js";
import { comboboxTargets } from "./../src/adapters/combobox-targets.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [
    labels({ activation: "focus-and-click", naming: true }),
    popoverTargets(),
    dialogCommands(),
    popoverCommands(),
    textNames({ getText(host, kind) { return host.getAttribute(kind === "label" ? "data-label-text" : "data-description-text"); } }),
    formTargets(),
    comboboxTargets({ getTargets: host => host.getComboboxTargets?.() ?? null }),
  ],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
