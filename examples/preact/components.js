import { Fragment, h } from "preact";
import { PreactElement } from "./preact-element.js";
import componentStyles from "../shared/components.css";

class PreactCheckbox extends PreactElement {
  static referenceTarget = "control";
  static observedAttributes = ["revision"];

  get revision() {
    return Number(this.getAttribute("revision")) || 0;
  }

  set revision(value) {
    this.setAttribute("revision", String(value));
  }

  render() {
    return h(Fragment, null,
      h("style", null, componentStyles),
      h("div", { class: "component-preview" },
        h("input", { key: this.revision, id: "control", type: "checkbox", "data-revision": this.revision }),
        h("span", { "aria-hidden": "true" }, "Native checkbox"),
      ),
      h("p", { class: "hint" }, `Render revision ${this.revision}`),
    );
  }
}

class PreactPopover extends PreactElement {
  static referenceTarget = "panel";

  render() {
    return h(Fragment, null,
      h("style", null, componentStyles),
      h("div", { id: "panel", popover: "auto" },
        h("p", { class: "eyebrow" }, "Preact · shadow DOM"),
        h("h2", null, "Rendered with Preact"),
        h("p", null, "This native popover lives inside a custom element rendered by Preact."),
        h("button", { type: "button", popovertarget: "panel", popovertargetaction: "hide" }, "Close popover"),
      ),
    );
  }
}

customElements.define("rt-preact-checkbox", PreactCheckbox);
customElements.define("rt-preact-popover", PreactPopover);

export async function whenReady() {
  await Promise.all([
    document.getElementById("renderer-checkbox").updateComplete,
    document.getElementById("renderer-popover").updateComplete,
  ]);
}
