// Demo decoration only: this module is loaded separately from every page's
// measured application/fallback bundles and never participates in app readiness.
const page = document.documentElement;

if (!globalThis.CSS?.highlights || typeof globalThis.Highlight !== "function") {
  page.dataset.codeHighlighting = "unsupported";
} else {
  page.dataset.codeHighlighting = "loading";
  try {
    const { highlightAll } = await import("./microlighter/index.js");
    document.body.dataset.syntaxTheme = "github";
    await highlightAll({ selector: "pre > code[data-code-sample]" });
    page.dataset.codeHighlighting = "ready";
  } catch (error) {
    page.dataset.codeHighlighting = "unavailable";
    console.warn("Code highlighting unavailable; samples remain readable as plain text.", error);
  }
}
