<svelte:options customElement={{
  shadow: "open",
  props: { revision: { type: "Number", reflect: true } },
  extend: Base => class extends Base {
    constructor() {
      super();
      this.shadowRoot.referenceTarget = "control";
    }
  },
}} />

<script>
  import { onMount } from "svelte";
  import componentStyles from "../shared/components.css";

  let { revision = 0 } = $props();

  onMount(() => {
    const host = $host();
    host.setAttribute("data-renderer-ready", "");
    host.dispatchEvent(new Event("renderer-ready"));
    return () => host.removeAttribute("data-renderer-ready");
  });
</script>

<svelte:element this={"style"}>{componentStyles}</svelte:element>
<div class="component-preview">
  {#key revision}
    <input id="control" type="checkbox" data-revision={revision}>
  {/key}
  <span aria-hidden="true">Native checkbox</span>
</div>
<p class="hint">Render revision {revision}</p>
