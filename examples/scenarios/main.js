import { hasNativeReferenceTarget } from "../../src/detect/surface.js";

const requestedMode = new URL(location.href).searchParams.get("mode") ?? "auto";
const selectedMode = ["auto", "fallback", "off"].includes(requestedMode) ? requestedMode : "auto";
const nativeSurface = hasNativeReferenceTarget();
const root = document.documentElement;
const ready = document.getElementById("ready-status");

root.dataset.referenceTargetSurface = String(nativeSurface);
root.dataset.referenceTargetRequestedMode = selectedMode;
document.getElementById("surface-status").textContent = nativeSurface ? "Present (surface check only)" : "Absent";
for (const link of document.querySelectorAll("[data-mode]")) {
  if (link.dataset.mode === selectedMode) link.setAttribute("aria-current", "page");
}

try {
  let fallback;
  if (selectedMode === "fallback" || (selectedMode === "auto" && !nativeSurface)) {
    ({ referenceTargetFallback: fallback } = await import("./reference-target.setup.js"));
  }
  const mode = selectedMode === "off" ? "off" : fallback?.mode ?? "native";
  root.dataset.referenceTargetMode = mode;
  root.dataset.referenceTargetAdapters = fallback?.activeAdapters.join(",") ?? "";
  root.dataset.referenceTargetAdapterStatuses = JSON.stringify(fallback?.statuses ?? {});
  document.getElementById("mode-status").textContent = mode === "off"
    ? "Browser alone · fallback off"
    : mode === "native"
      ? "Browser path · automatic"
      : selectedMode === "fallback" ? "Fallback · forced" : "Fallback · automatic";
  document.getElementById("adapter-status").textContent = fallback
    ? Object.entries(fallback.statuses).map(([id, state]) => `${id}: ${state}`).join(" · ")
    : "None loaded";

  // These components hydrate parser-created roots. They do not import setup.
  await import("./app.js");
  // Allow attribute observations caused by the initial wiring to settle before
  // publishing readiness. Adapter hydration itself ran synchronously in setup.
  await Promise.resolve();
  root.dataset.referenceTargetReady = "true";
  ready.dataset.ready = "true";
  ready.textContent = "Ready.";
} catch (error) {
  root.dataset.referenceTargetMode = "error";
  document.getElementById("mode-status").textContent = "Example could not start";
  ready.textContent = "Setup did not complete. The examples are not ready.";
  const message = document.getElementById("load-error");
  message.textContent = "This page needs parser support for Declarative Shadow DOM and must be served over HTTP. Check the browser console for the loading error.";
  message.hidden = false;
  console.error("Reference Target scenarios failed to initialize:", error);
}
