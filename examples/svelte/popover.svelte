<svelte:options customElement={{
  shadow: "open",
  extend: Base => class extends Base {
    constructor() {
      super();
      this.shadowRoot.referenceTarget = "panel";
    }
  },
}} />

<script>
  import { onMount } from "svelte";
  import componentStyles from "../shared/components.css";

  onMount(() => {
    const host = $host();
    host.setAttribute("data-renderer-ready", "");
    host.dispatchEvent(new Event("renderer-ready"));
    return () => host.removeAttribute("data-renderer-ready");
  });
</script>

<svelte:element this={"style"}>{componentStyles}</svelte:element>
<div id="panel" popover="auto">
  <p class="eyebrow">Svelte custom element · shadow DOM</p>
  <h2>Rendered with Svelte</h2>
  <p>This native popover lives inside a compiler-generated Svelte custom element.</p>
  <button type="button" popovertarget="panel" popovertargetaction="hide">Close popover</button>
</div>
