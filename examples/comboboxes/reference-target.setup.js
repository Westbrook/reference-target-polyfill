import { installReferenceTarget } from "../../src/core.js";
import { comboboxTargets } from "../../src/adapters/combobox-targets.js";

const parameters = new URL(location.href).searchParams;
export const referenceTargetFallback = installReferenceTarget({
  adapters: [comboboxTargets({ getTargets: host => host.getComboboxTargets?.() ?? null })],
  force: parameters.get("mode") === "fallback" || parameters.get("fallback") === "1",
});

referenceTargetFallback.hydrate(document);
