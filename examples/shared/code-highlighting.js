// Demo decoration only: this module is loaded separately from every page's
// measured application/fallback bundles and never participates in app readiness.
const page = document.documentElement;

if (!globalThis.CSS?.highlights || typeof globalThis.Highlight !== "function") {
  page.dataset.codeHighlighting = "unsupported";
} else {
  page.dataset.codeHighlighting = "deferred";
  let loading;

  function loadHighlighting() {
    if (loading) return loading;
    page.dataset.codeHighlighting = "loading";
    loading = (async () => {
      const theme = document.createElement("link");
      theme.rel = "stylesheet";
      theme.href = new URL("./microlighter/themes/github.css", import.meta.url).href;
      document.head.append(theme);
      const { highlightAll } = await import("./microlighter/index.js");
      document.body.dataset.syntaxTheme = "github";
      await highlightAll({ selector: "pre > code[data-code-sample]" });
      page.dataset.codeHighlighting = "ready";
    })().catch(error => {
      page.dataset.codeHighlighting = "unavailable";
      console.warn("Code highlighting unavailable; samples remain readable as plain text.", error);
    });
    return loading;
  }

  // Opening a source disclosure makes this decoration user-visible, so load
  // immediately. Otherwise use idle time and let the functional page initialize.
  document.addEventListener("toggle", event => {
    if (event.target.matches?.("details:has(code[data-code-sample])") && event.target.open) {
      void loadHighlighting();
    }
  }, true);
  function scheduleIdle() {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => void loadHighlighting(), { timeout: 3000 });
    } else {
      setTimeout(() => void loadHighlighting(), 1500);
    }
  }
  if (page.dataset.referenceTargetReady === "true") {
    scheduleIdle();
  } else {
    const readiness = new MutationObserver(() => {
      if (page.dataset.referenceTargetReady !== "true") return;
      readiness.disconnect();
      scheduleIdle();
    });
    readiness.observe(page, { attributes: true, attributeFilter: ["data-reference-target-ready"] });
  }
}
