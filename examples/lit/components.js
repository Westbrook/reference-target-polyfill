import { LitElement, html, unsafeCSS } from "lit";
import { keyed } from "lit/directives/keyed.js";
import componentStyles from "../shared/components.css";
import { withRendererTimeout } from "../shared/renderer-readiness.js";

class ReferenceTargetLitElement extends LitElement {
  static styles = unsafeCSS(componentStyles);

  createRenderRoot() {
    const root = super.createRenderRoot();
    root.referenceTarget = this.constructor.referenceTarget;
    return root;
  }
}

class LitCheckbox extends ReferenceTargetLitElement {
  static referenceTarget = "control";
  static properties = { revision: { type: Number, reflect: true } };

  constructor() {
    super();
    this.revision = 0;
  }

  render() {
    return html`
      <div class="component-preview">
        ${keyed(this.revision, html`
          <input id="control" type="checkbox" data-revision=${this.revision}>
        `)}
        <span aria-hidden="true">Native checkbox</span>
      </div>
      <p class="hint">Render revision ${this.revision}</p>
    `;
  }
}

class LitPopover extends ReferenceTargetLitElement {
  static referenceTarget = "panel";

  render() {
    return html`
      <div id="panel" popover="auto" role="dialog" aria-labelledby="panel-title">
        <p class="eyebrow">LitElement · shadow DOM</p>
        <h2 id="panel-title">Rendered with Lit</h2>
        <p>This native popover lives inside a LitElement shadow root.</p>
        <button type="button" popovertarget="panel" popovertargetaction="hide" autofocus>Close popover</button>
      </div>
    `;
  }
}

customElements.define("rt-lit-checkbox", LitCheckbox);
customElements.define("rt-lit-popover", LitPopover);

export async function whenReady() {
  await withRendererTimeout(Promise.all([
    document.getElementById("renderer-checkbox").updateComplete,
    document.getElementById("renderer-popover").updateComplete,
  ]), "Lit");
}
