import { FASTElement, Updates, html, repeat } from "@microsoft/fast-element";
import componentStyles from "../shared/components.css";
import { withRendererTimeout } from "../shared/renderer-readiness.js";

class FastCheckbox extends FASTElement {
  constructor() {
    super();
    this.revision = 0;
    this.shadowRoot.referenceTarget = "control";
  }
}

const checkboxDefinition = FastCheckbox.define({
  name: "rt-fast-checkbox",
  shadowOptions: { mode: "open" },
  attributes: [{
    property: "revision",
    converter: {
      fromView: value => Number(value) || 0,
      toView: value => String(value),
    },
  }],
  styles: componentStyles,
  template: html`
    <div class="component-preview">
      ${repeat(
        host => [host.revision],
        html`<input id="control" type="checkbox" data-revision=${revision => revision}>`,
        { recycle: false },
      )}
      <span aria-hidden="true">Native checkbox</span>
    </div>
    <p class="hint">Render revision ${host => host.revision}</p>
  `,
});

class FastPopover extends FASTElement {
  constructor() {
    super();
    this.shadowRoot.referenceTarget = "panel";
  }
}

const popoverDefinition = FastPopover.define({
  name: "rt-fast-popover",
  shadowOptions: { mode: "open" },
  styles: componentStyles,
  template: html`
    <div id="panel" popover="auto" role="dialog" aria-labelledby="panel-title">
      <p class="eyebrow">FASTElement · shadow DOM</p>
      <h2 id="panel-title">Rendered with FAST</h2>
      <p>This native popover lives inside a FASTElement shadow root.</p>
      <button type="button" popovertarget="panel" popovertargetaction="hide" autofocus>Close popover</button>
    </div>
  `,
});

export async function whenReady() {
  await withRendererTimeout((async () => {
    await Promise.all([checkboxDefinition, popoverDefinition]);
    await Updates.next();
  })(), "FAST");
}
