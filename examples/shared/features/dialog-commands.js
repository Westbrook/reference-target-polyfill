const section = document.getElementById("dialog-commands");
const host = document.getElementById("dc-host");
if (!host) throw new Error("The dialog-commands example needs its dialog host.");

// The component owns its closed root. Its application code does not import or
// call the fallback; setup must have run before this module was evaluated.
const root = host.attachShadow({ mode: "closed", referenceTarget: "dc-dialog" });
root.innerHTML = `
  <div class="component-preview">
    <button id="dc-preview" type="button" disabled>Open the component’s non-modal preview</button>
  </div>
  <dialog id="dc-dialog" aria-labelledby="dc-dialog-title" aria-describedby="dc-dialog-description" hidden>
    <p class="eyebrow">Inside a closed shadow root</p>
    <h2 id="dc-dialog-title">A moment of focus</h2>
    <p id="dc-dialog-description">The outside Show modal button reaches this dialog through the host’s Reference Target.</p>
    <p>In a modal, the rest of the page is inert. Close this dialog, then use the component’s non-modal preview to try the two outside close commands.</p>
    <div class="button-row">
      <button id="dc-internal-close" type="button" disabled autofocus>Close dialog</button>
      <button id="dc-internal-request" type="button" disabled>Request close</button>
    </div>
  </dialog>
`;
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
// The HTML build supplies a page-relative asset path, which stays correct even
// when a bundler moves this module to a shared JavaScript chunk.
stylesheet.href = new URL(host.getAttribute("data-components-styles"), document.baseURI).href;
root.prepend(stylesheet);

const dialog = root.getElementById("dc-dialog");
const output = document.getElementById("dc-observation");
const cancellation = document.getElementById("dc-cancel");
const supported = typeof dialog.showModal === "function" && typeof dialog.close === "function";
const canRequestClose = typeof dialog.requestClose === "function";
const canInspectModal = globalThis.CSS?.supports("selector(:modal)") ?? false;
let commands = 0;
let canceled = 0;

function update() {
  const state = !supported ? "Dialog API unavailable"
    : !dialog.open ? "closed"
    : canInspectModal ? dialog.matches(":modal") ? "modal" : "non-modal" : "open";
  const message = `dialog: ${state} · commands: ${commands} · canceled close requests: ${canceled} · return value: ${dialog.returnValue || "(empty)"} · root: closed${canRequestClose ? "" : " · requestClose unavailable"}`;
  if (output.textContent !== message) output.textContent = message;
}

dialog.addEventListener("command", () => { commands += 1; queueMicrotask(update); });
dialog.addEventListener("cancel", (event) => {
  if (cancellation.checked) {
    event.preventDefault();
    cancellation.checked = false;
    canceled += 1;
  }
  queueMicrotask(update);
});
dialog.addEventListener("close", update);
dialog.addEventListener("toggle", update);

// These controls are inside the component and use ordinary component methods.
// Every outside action button above relies solely on its forwarded commandfor.
root.getElementById("dc-preview").addEventListener("click", () => {
  if (!dialog.open) dialog.show();
  update();
});
root.getElementById("dc-internal-close").addEventListener("click", () => dialog.close("closed-inside"));
root.getElementById("dc-internal-request").addEventListener("click", () => dialog.requestClose("requested-inside"));
section.addEventListener("click", () => queueMicrotask(update));
root.addEventListener("click", () => queueMicrotask(update));

dialog.hidden = !supported;
for (const control of section.querySelectorAll("button, input")) control.disabled = !supported;
for (const button of root.querySelectorAll("button")) button.disabled = !supported;
document.getElementById("dc-request").disabled = !(supported && canRequestClose);
root.getElementById("dc-internal-request").disabled = !(supported && canRequestClose);
update();
