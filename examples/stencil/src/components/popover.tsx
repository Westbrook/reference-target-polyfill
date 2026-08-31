import { Component, Element, h } from "@stencil/core";

@Component({
  tag: "rt-stencil-popover",
  shadow: true,
  styleUrl: "../../../shared/components.css",
})
export class StencilPopover {
  @Element() host!: HTMLElement;

  componentDidLoad() {
    const root = this.host.shadowRoot as ShadowRoot & { referenceTarget: string };
    root.referenceTarget = "panel";
    this.host.setAttribute("data-renderer-ready", "");
    this.host.dispatchEvent(new CustomEvent("renderer-ready"));
  }

  render() {
    return (
      <div id="panel" popover="auto" aria-labelledby="panel-title">
        <p class="eyebrow">Stencil component</p>
        <h2 id="panel-title">Rendered with Stencil</h2>
        <p>This native popover lives inside a Stencil component’s shadow root.</p>
        <button type="button" popoverTarget="panel" popoverTargetAction="hide">Close popover</button>
      </div>
    );
  }
}
