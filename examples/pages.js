// Build-time catalog. Browser entry points import their selected modules directly.
const capabilities = [
  { id: "labels", directory: "labels", title: "Labels and activation" },
  { id: "popover-targets", directory: "popover-targets", title: "Popover targets" },
  { id: "dialog-commands", directory: "dialog-commands", title: "Dialog commands" },
  { id: "popover-commands", directory: "popover-commands", title: "Popover commands" },
  { id: "text-names", directory: "text-names", title: "Text names and descriptions" },
  { id: "form-targets", directory: "forms", title: "Form submission and reset" },
  { id: "combobox-targets", directory: "comboboxes", title: "Combobox relationships" },
];

export const pages = [
  {
    id: "all", directory: "", title: "All Reference Target demos",
    adapters: capabilities.map(({ id }) => id),
    features: [...capabilities.map(({ id }) => id), "boundaries"],
  },
  ...capabilities.map(page => ({ ...page, adapters: [page.id], features: [page.id] })),
  {
    id: "scenarios", directory: "scenarios", title: "Declarative boundary comparisons",
    adapters: ["labels", "popover-targets", "text-names"], features: [],
  },
];
