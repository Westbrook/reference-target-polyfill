import { hasNativeReferenceTarget } from "../../src/detect.js";

let referenceTargets;

/** Components call this after changing the model behind a cooperative provider. */
export function refreshReferenceTargets() {
  referenceTargets?.refresh();
}

/** The page owns the two import boundaries; this helper imports no adapters. */
export async function bootstrap({ loadFallback, loadApp, cooperativeFallback = false }) {
  const page = document.documentElement;
  const parameters = new URL(location.href).searchParams;
  const requested = parameters.get("mode") ?? (parameters.get("fallback") === "1" ? "fallback" : "auto");
  const requestedMode = ["auto", "fallback", "off"].includes(requested) ? requested : "auto";
  const nativeSurface = hasNativeReferenceTarget();
  const ready = document.getElementById("ready-status");
  page.dataset.referenceTargetReady = "false";
  page.dataset.referenceTargetRequestedMode = requestedMode;
  page.dataset.referenceTargetSurface = String(nativeSurface);
  document.getElementById("surface-status").textContent = nativeSurface ? "Present · surface check only" : "Absent";
  for (const link of document.querySelectorAll("[data-mode]")) {
    const url = new URL(location.href);
    url.searchParams.delete("fallback");
    url.searchParams.set("mode", link.dataset.mode);
    link.href = `${url.pathname}${url.search}${url.hash}`;
    if (link.dataset.mode === requestedMode) link.setAttribute("aria-current", "page");
  }

  try {
    let fallback;
    let loadedFallback = false;
    if (requestedMode === "fallback" || (requestedMode === "auto" && (!nativeSurface || cooperativeFallback))) {
      ({ referenceTargetFallback: fallback } = await loadFallback());
      loadedFallback = true;
    }
    // This is assigned before importing the ordinary app module so its first
    // render can synchronously synchronize component-provided public targets.
    referenceTargets = fallback;
    const mode = requestedMode === "off" ? "off" : fallback?.mode ?? "native";
    page.dataset.referenceTargetMode = mode;
    page.dataset.referenceTargetAdapters = fallback?.activeAdapters.join(",") ?? "";
    page.dataset.referenceTargetAdapterStatuses = JSON.stringify(fallback?.statuses ?? {});
    page.dataset.bundlePath = loadedFallback ? "total" : "baseline";
    document.getElementById("mode-status").textContent = mode === "off"
      ? "Browser alone · fallback off"
      : mode === "native" ? "Native API detected"
        : mode === "fallback" ? nativeSurface && requestedMode !== "fallback" && cooperativeFallback
          ? "Cooperative bridge · native API surface present"
          : `Fallback · ${requestedMode === "fallback" ? "forced" : "automatic"}`
          : "Fallback unavailable";
    document.getElementById("adapter-status").textContent = fallback
      ? Object.entries(fallback.statuses).map(([id, status]) => `${id}: ${status}`).join(" · ")
      : "None loaded";

    // Each app is an ordinary module. Its imports only initialize its own demos.
    await loadApp();
    refreshReferenceTargets();
    await Promise.resolve();
    page.dataset.referenceTargetReady = "true";
    ready.dataset.ready = "true";
    ready.textContent = "Ready.";
    const note = document.getElementById("mode-note");
    if (note) note.textContent = loadedFallback
      ? cooperativeFallback
        ? "This visit includes the additional adapter JavaScript shown below. The combobox bridge also runs with native Phase 1: a single referenceTarget cannot expose both a listbox and its active option."
        : "This visit includes the additional fallback JavaScript shown below."
      : "This visit uses the baseline JavaScript only. Browser-only mode does not imply native Reference Target support.";
  } catch (error) {
    page.dataset.referenceTargetMode = "error";
    page.dataset.referenceTargetReady = "error";
    ready.dataset.ready = "error";
    document.getElementById("mode-status").textContent = "Demo could not start";
    ready.textContent = "Setup did not complete. Inspect the loading error before trying the demos.";
    const message = document.getElementById("load-error");
    message.textContent = error instanceof Error ? error.message : "The demo failed to load.";
    message.hidden = false;
    console.error("Reference Target demo failed to initialize:", error);
  }
}
