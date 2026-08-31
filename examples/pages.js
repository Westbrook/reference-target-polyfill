// Build-time catalog. Browser entry points import their selected modules directly.
const capabilities = [
  { id: "labels", directory: "labels", title: "Labels and activation" },
  { id: "popover-targets", directory: "popover-targets", title: "Popover targets" },
  { id: "dialog-commands", directory: "dialog-commands", title: "Dialog commands" },
  { id: "popover-commands", directory: "popover-commands", title: "Popover commands" },
  { id: "text-names", directory: "text-names", title: "Text names and descriptions" },
  { id: "form-targets", directory: "forms", title: "Form submission and reset" },
];

export const renderers = [
  { id: "lit", title: "Lit", url: "https://lit.dev/", sources: ["components.js"] },
  { id: "fast", title: "FAST", url: "https://fast.design/", sources: ["components.js"] },
  {
    id: "stencil", title: "Stencil", url: "https://stenciljs.com/",
    sources: ["src/components/checkbox.tsx", "src/components/popover.tsx", "components.js"],
  },
  {
    id: "preact", title: "Preact", url: "https://preactjs.com/",
    sources: ["preact-element.js", "components.js"],
  },
];

export const pages = [
  {
    id: "all", directory: "", title: "All Reference Target demos",
    adapters: capabilities.map(({ id }) => id),
    features: [...capabilities.map(({ id }) => id), "boundaries"],
  },
  ...capabilities.map(page => ({ ...page, adapters: [page.id], features: [page.id] })),
  ...renderers.map(renderer => ({
    id: renderer.id, directory: renderer.id, title: `${renderer.title} custom elements`,
    adapters: ["labels", "popover-targets"], features: ["renderer"], renderer,
  })),
  {
    id: "scenarios", directory: "scenarios", title: "Declarative boundary comparisons",
    adapters: ["labels", "popover-targets", "text-names"], features: [],
  },
];
