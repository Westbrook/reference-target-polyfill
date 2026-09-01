import {
  defineCustomElement,
  h,
  nextTick,
  onMounted,
  useHost,
  useShadowRoot,
} from "vue/dist/vue.runtime.esm-bundler.js";
import componentStyles from "../shared/components.css";
import { withRendererTimeout } from "../shared/renderer-readiness.js";

const firstRenders = new WeakMap();

function firstRender(host) {
  let ready = firstRenders.get(host);
  if (!ready) {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    ready = { promise, resolve };
    firstRenders.set(host, ready);
  }
  return ready;
}

function useReferenceTarget(target) {
  useShadowRoot().referenceTarget = target;
  onMounted(firstRender(useHost()).resolve);
}

const VueCheckbox = defineCustomElement({
  name: "ReferenceTargetVueCheckbox",
  inheritAttrs: false,
  styles: [componentStyles],
  props: { revision: { type: Number, default: 0 } },

  setup(props) {
    useReferenceTarget("control");
    return () => [
      h("div", { class: "component-preview" }, [
        h("input", {
          key: props.revision,
          id: "control",
          type: "checkbox",
          "data-revision": props.revision,
        }),
        h("span", { "aria-hidden": "true" }, "Native checkbox"),
      ]),
      h("p", { class: "hint" }, `Render revision ${props.revision}`),
    ];
  },
});

const VuePopover = defineCustomElement({
  name: "ReferenceTargetVuePopover",
  inheritAttrs: false,
  styles: [componentStyles],

  setup() {
    useReferenceTarget("panel");
    return () => h("div", { id: "panel", popover: "auto", role: "dialog", "aria-labelledby": "panel-title" }, [
      h("p", { class: "eyebrow" }, "Vue · shadow DOM"),
      h("h2", { id: "panel-title" }, "Rendered with Vue"),
      h("p", null, "This native popover lives inside a Vue custom element's shadow root."),
      h("button", {
        type: "button",
        popovertarget: "panel",
        popovertargetaction: "hide",
        autofocus: true,
      }, "Close popover"),
    ]);
  },
});

customElements.define("rt-vue-checkbox", VueCheckbox);
customElements.define("rt-vue-popover", VuePopover);

export async function whenReady() {
  await withRendererTimeout((async () => {
    await Promise.all([
      firstRender(document.getElementById("renderer-checkbox")).promise,
      firstRender(document.getElementById("renderer-popover")).promise,
    ]);
    await nextTick();
  })(), "Vue");
}
