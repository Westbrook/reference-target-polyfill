import { render } from "preact";

// The custom element owns its lifecycle and shadow root; Preact owns rendering.
export class PreactElement extends HTMLElement {
  static referenceTarget = null;

  constructor() {
    super();
    this.renderRoot = this.attachShadow({ mode: "open" });
    this.renderRoot.referenceTarget = this.constructor.referenceTarget;
    this.updateComplete = Promise.resolve(false);
    this.updatePending = false;
  }

  connectedCallback() {
    this.requestUpdate();
  }

  disconnectedCallback() {
    render(null, this.renderRoot);
  }

  attributeChangedCallback(name, previousValue, value) {
    if (previousValue !== value) this.requestUpdate();
  }

  requestUpdate() {
    if (this.updatePending) return this.updateComplete;
    this.updatePending = true;
    this.updateComplete = Promise.resolve().then(() => {
      this.updatePending = false;
      // A queued update may outlive a removal. Reconnection schedules a new one.
      if (!this.isConnected) return false;
      render(this.render(), this.renderRoot);
      return true;
    });
    return this.updateComplete;
  }

  render() {
    return null;
  }
}
