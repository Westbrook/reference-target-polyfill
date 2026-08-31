import { Component, Element, Fragment, h, Prop } from "@stencil/core";

@Component({
  tag: "rt-stencil-checkbox",
  shadow: true,
  styleUrl: "../../../shared/components.css",
})
export class StencilCheckbox {
  @Element() host!: HTMLElement;
  @Prop() revision: number = 0;

  componentDidLoad() {
    const root = this.host.shadowRoot as ShadowRoot & { referenceTarget: string };
    root.referenceTarget = "control";
    this.host.setAttribute("data-renderer-ready", "");
    this.host.dispatchEvent(new CustomEvent("renderer-ready"));
  }

  render() {
    return (
      <Fragment>
        <div class="component-preview">
          <input key={this.revision} id="control" type="checkbox" data-revision={this.revision} />
          <span aria-hidden="true">Native checkbox</span>
        </div>
        <p class="hint">Render revision {this.revision}</p>
      </Fragment>
    );
  }
}
