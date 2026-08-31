import { refreshReferenceTargets } from "../bootstrap.js";

const topics = [
  ["accessibility", "Accessibility"],
  ["browser-apis", "Browser APIs"],
  ["css", "CSS"],
  ["custom-elements", "Custom elements"],
  ["indieweb", "IndieWeb"],
  ["performance", "Performance"],
  ["web-components", "Web Components"],
];

class TopicPicker extends HTMLElement {
  #input;
  #listbox;
  #options = [];
  #active = null;
  #expanded = false;

  constructor() {
    super();
    // The shell is private; the one real listbox and its options are public,
    // slotted light DOM. The wrapper deliberately has no listbox/option role.
    const root = this.attachShadow({ mode: "closed", referenceTarget: "frame" });
    root.innerHTML = `<style>:host { display: block; } slot { display: contents; }</style>
      <div id="frame"><slot></slot></div>`;
  }

  connectedCallback() {
    if (this.#input) return;
    this.#input = document.getElementById(this.dataset.input);
    this.#listbox = this.querySelector("#cb-listbox");
    this.#options = topics.map(([id, label]) => {
      const option = document.createElement("div");
      option.id = `cb-option-${id}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = label;
      this.#listbox.append(option);
      return option;
    });

    this.#input.addEventListener("input", () => {
      this.#active = null;
      this.#expanded = true;
      this.#render();
    });
    this.#input.addEventListener("click", () => {
      this.#expanded = true;
      this.#render();
    });
    this.#input.addEventListener("keydown", event => this.#onKeyDown(event));
    this.#input.addEventListener("focus", () => this.#describe());
    this.#input.addEventListener("blur", () => {
      this.#close();
      queueMicrotask(() => this.#describe());
    });
    this.#listbox.addEventListener("pointerdown", event => {
      if (event.target.closest('[role="option"]')) event.preventDefault();
    });
    this.#listbox.addEventListener("click", event => {
      const option = event.target.closest('[role="option"]');
      if (this.#options.includes(option) && !option.hidden) this.#commit(option);
    });
    // Readouts also follow adapter cleanup or an author edit made in DevTools.
    new MutationObserver(() => this.#describe()).observe(this.#input, {
      attributes: true,
      attributeFilter: ["aria-controls", "aria-activedescendant", "aria-expanded"],
    });
    this.#input.disabled = false;
    this.#render();
    document.getElementById("combobox-targets").dataset.ready = "ready";
  }

  /** The adapter receives intentionally public nodes, never the closed root. */
  getComboboxTargets() {
    return this.#listbox ? { listbox: this.#listbox, activeOption: this.#active } : null;
  }

  #visibleOptions() {
    const query = this.#input.value.trim().toLocaleLowerCase();
    return this.#options.filter(option => option.textContent.toLocaleLowerCase().includes(query));
  }

  #onKeyDown(event) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = this.#visibleOptions();
      const index = options.indexOf(this.#active);
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.#active = options.length
        ? options[index < 0 ? (step > 0 ? 0 : options.length - 1) : (index + step + options.length) % options.length]
        : null;
      this.#expanded = true;
      this.#render();
      this.#active?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && this.#expanded && this.#active) {
      event.preventDefault();
      this.#commit(this.#active);
    } else if (event.key === "Escape" && this.#expanded) {
      event.preventDefault();
      this.#close();
    } else if (event.key === "Tab") {
      // Preserve the browser's normal Tab behavior and form text editing keys.
      this.#close();
    }
  }

  #commit(option) {
    this.#input.value = option.textContent;
    document.getElementById("cb-status").textContent = `Selected: ${option.textContent}.`;
    this.#input.focus({ preventScroll: true });
    this.#close();
  }

  #close() {
    this.#active = null;
    this.#expanded = false;
    this.#render();
  }

  #render() {
    const visible = this.#visibleOptions();
    if (!visible.includes(this.#active)) this.#active = null;
    for (const option of this.#options) {
      option.hidden = !visible.includes(option);
      option.setAttribute("aria-selected", String(this.#expanded && option === this.#active));
    }
    this.#listbox.hidden = !this.#expanded;
    this.#input.setAttribute("aria-expanded", String(this.#expanded));
    this.querySelector("#cb-empty").hidden = !this.#expanded || visible.length > 0;
    const count = document.getElementById("cb-count");
    const countText = this.#expanded
      ? `${visible.length} matching ${visible.length === 1 ? "topic" : "topics"}.`
      : "Suggestions closed.";
    if (count.textContent !== countText) count.textContent = countText;
    // A model change must be synchronized before the next input event. The
    // bootstrap installed the selected adapter before importing this module.
    refreshReferenceTargets();
    this.#describe();
  }

  #describe() {
    const describeReference = attribute => {
      const id = this.#input.getAttribute(attribute);
      if (!id) return "none";
      const target = document.getElementById(id);
      return `#${id} [${target?.getAttribute("role") ?? "no role"}]`;
    };
    const activeId = this.#input.getAttribute("aria-activedescendant");
    const active = activeId ? document.getElementById(activeId) : null;
    const contained = active?.getAttribute("role") === "option" && this.#listbox.contains(active);
    const text = [
      `aria-controls → ${describeReference("aria-controls")}`,
      `aria-activedescendant → ${describeReference("aria-activedescendant")}`,
      `active option inside listbox: ${active ? String(contained) : "—"}`,
      `DOM focus: ${document.activeElement === this.#input ? "combobox input" : "elsewhere"}`,
      `expanded: ${this.#input.getAttribute("aria-expanded")}`,
    ].join("\n");
    const output = document.getElementById("cb-relations");
    if (output.textContent !== text) output.textContent = text;
  }
}

customElements.define("rt-topic-picker", TopicPicker);
