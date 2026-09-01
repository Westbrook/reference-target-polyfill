# Reference Target polyfill

A `0.1.0` prototype that supplies selected Reference Target behaviors when the browser lacks the API. It uses native Shadow DOM and has no runtime dependencies. It is a partial, component-aware fallback: JavaScript cannot recreate the browser's accessibility relationships, form association, event paths, or encapsulated reflection in full.

[Consumption guide](https://westbrook.github.io/reference-target-polyfill/) · [Live demos](https://westbrook.github.io/reference-target-polyfill/examples/) · [Contributing](https://github.com/Westbrook/reference-target-polyfill/blob/main/CONTRIBUTING.md) · [MIT license](./LICENSE)

The package exports separate ESM modules. Importing them does not install anything; call `installReferenceTarget()` with the adapters your application needs. There is no package-root or “all adapters” entry point. See [the research and design proposal](https://github.com/Westbrook/reference-target-polyfill/blob/main/REFERENCE-TARGET-PROPOSAL.md) for specification and implementation context; it lives in the repository rather than the installed package.

## Install from GitHub

The package is not published to npm. Install it from this repository:

```sh
npm install git+https://github.com/Westbrook/reference-target-polyfill.git#main
```

The installed package name is `reference-target-fallback`; use that name in imports. Replace `main` with a reviewed commit SHA for a pinned dependency and commit your application's lockfile. This prototype follows semantic-versioning rules within the limits of `0.x`: minor releases can still contain breaking changes, so review the release notes and migration section before updating.

For production without a bundler, check out a reviewed commit, run `npm ci && npm run build:browser`, and vendor the complete generated `dist/browser/` module directory. Its deployed stable entry URLs include [`browser/detect/surface.js`](https://westbrook.github.io/reference-target-polyfill/browser/detect/surface.js), [`browser/detect.js`](https://westbrook.github.io/reference-target-polyfill/browser/detect.js), [`browser/core.js`](https://westbrook.github.io/reference-target-polyfill/browser/core.js), and [`browser/adapters/labels.js`](https://westbrook.github.io/reference-target-polyfill/browser/adapters/labels.js); copy the whole directory because entries can share hashed chunks. The generated [`browser/manifest.json`](https://westbrook.github.io/reference-target-polyfill/browser/manifest.json) records every entry, imported chunk, and raw/gzip/Brotli byte count.

The hosted files follow this repository rather than a versioned CDN, so pin and self-host them when repeatability matters. Raw unminified modules remain available under [the site's `src/` directory](https://westbrook.github.io/reference-target-polyfill/src/detect.js) for debugging and source-level evaluation; do not use that larger, multi-request graph as the production delivery recommendation.

## Load before components

The fallback must install before component constructors call `attachShadow()`. Keep its setup in a separate dynamic-import boundary, but allow the browser to fetch the always-needed application module in parallel:

```html
<link rel="modulepreload" href="./app.js">
<script type="module" src="./bootstrap.js"></script>
```

When a bundler hashes or splits the application graph, emit its equivalent preload rather than copying this literal URL. `modulepreload` fetches the app; it does not evaluate it before the awaited setup barrier.

```js
// bootstrap.js
import { hasNativeReferenceTarget } from
  "reference-target-fallback/detect/surface";

if (!hasNativeReferenceTarget()) {
  await import("./reference-target.setup.js");
} else {
  const { probeReferenceTarget } = await import(
    "reference-target-fallback/detect"
  );
  const support = probeReferenceTarget();
  if (!support.nullable || !support.labels) {
    // Choose an application-specific structural fallback or unsupported state.
    // The library deliberately does not layer fallback over a partial native API.
    document.documentElement.dataset.referenceTargetSupport = "partial";
  }
}

// app.js defines components and performs its initialization when evaluated.
await import("./app.js");
```

Every browser downloads only the tiny surface check. The full probe is requested only when that surface exists, and the core plus selected adapters only when it does not. The probe above is useful for an application that needs label forwarding. It does not certify popovers, commands, forms, text naming, accessible output, or assistive-technology behavior. A native surface that passes the basic probes remains native-unverified for those selected capabilities; make that decision from the application's browser test matrix.

Keep the installation handle in a tiny module that does not import the setup graph. Application code can then request reconciliation or dispose during hot replacement without making the fallback eager:

```js
// reference-target.state.js
let current = null;
export function publishReferenceTarget(handle) { current = handle; }
export function getReferenceTarget() { return current; }
export function disposeReferenceTarget() {
  const previous = current;
  current = null;
  previous?.dispose();
}
```

```js
// reference-target.setup.js
import { installReferenceTarget } from "reference-target-fallback/core";
import { labels } from "reference-target-fallback/adapters/labels";
import { dialogCommands } from "reference-target-fallback/adapters/dialog-commands";
import { publishReferenceTarget } from "./reference-target.state.js";

export const referenceTarget = installReferenceTarget({
  adapters: [
    labels({ activation: "focus" }),
    dialogCommands(),
  ],
});

publishReferenceTarget(referenceTarget);
```

Keep the optional setup module out of the application's static import graph. Its static adapter imports make the selected features explicit, while the awaited dynamic import completes installation before component constructors run. No `start()` export is required from the application. Ordinary app code can import only `getReferenceTarget` from the state module; the hot-replacement boundary can call `disposeReferenceTarget()` before reevaluating setup. If your application's package metadata marks modules as side-effect free, explicitly preserve the setup module as side-effectful so bundling retains installation.

Do not call `hydrate()` for components created after installation: `attachShadow()` captures those roots synchronously. Call it once only when the document already contains open or declarative roots whose hosts carry fallback metadata. This avoids an unnecessary startup traversal and reconciliation.

After installation, ordinary imperative setup is captured, including closed roots:

```js
const root = this.attachShadow({ mode: "closed", referenceTarget: "control" });
root.innerHTML = '<input id="control">';

root.referenceTarget = "other-control"; // Change the target ID.
root.referenceTarget = null;            // Stop forwarding.
root.referenceTarget = "";              // Forward to no element.
```

Resolution follows nested, registered reference targets. A missing ID is unresolved. The core wraps this realm's `Element.prototype.attachShadow` and adds an accessor to captured root instances; it does not add a fake native feature flag to `ShadowRoot.prototype`.

## Detection and installation

`hasNativeReferenceTarget(realm = globalThis)` from `reference-target-fallback/detect/surface` checks only for the native property on `ShadowRoot.prototype`. It does not prove behavioral or accessibility support. `probeReferenceTarget(realm = globalThis)` from `reference-target-fallback/detect` returns `{ surface, nullable, labels }` after small DOM probes for nullable assignment and label-control forwarding, invalidation, and restoration. The full detection entry also re-exports the surface check for convenience. These probes do not certify every relation, accessible-name computation, or assistive-technology behavior.

```js
import { probeReferenceTarget } from "reference-target-fallback/detect";

const support = probeReferenceTarget();
// If support.surface is true but another result is false, treat this as a
// partial native implementation and retain an application-specific fallback.
```

The bootstrap example loads only the surface entry in every browser, then loads the full probe on the native-surface route. It skips the core, setup, and selected adapters when the native surface exists. In deployments containing experimental implementations, distinguish `absent`, `partial`, and `present but capability-unverified` rather than treating a property check as conformance.

`installReferenceTarget({ adapters = [], realm = globalThis, force = false, onDiagnostic })` requires a browser realm with a `document`, Shadow DOM, `MutationObserver`, `WeakRef`, and `queueMicrotask`. It rejects duplicate adapter IDs and a second active installation in the same realm. The package ships TypeScript declarations for its public exports. TypeScript components that author the native-shaped `referenceTarget` fields can opt into the DOM augmentation without importing runtime code:

```ts
import type {} from "reference-target-fallback/dom";

const init: ShadowRootInit = { mode: "open", referenceTarget: "control" };
const element = document.createElement("x-field");
const root = element.attachShadow(init);
root.referenceTarget = null;
```

`reference-target-fallback/dom` is type-only; do not dynamically or ordinarily import it at runtime.

| Handle member | Behavior |
| --- | --- |
| `mode` | `fallback` when adapters are installed; `native-unverified` when the native surface and basic probes pass; `unsupported` for a partial native surface or no usable selected adapters; `inactive` when no adapters were selected; `disposed` after an active fallback is released. |
| `reason` | Explanation on an inactive, unsupported, or disposed handle, when applicable. |
| `statuses` | Adapter ID → `fallback`, `unsupported`, `native-unverified`, `inactive`, or `disposed`. A native-unverified value is a routing decision, not adapter-specific certification. Missing native primitives can make individual adapters unsupported even when the handle's mode is `fallback`. |
| `activeAdapters` | IDs of adapters currently installed in fallback mode. |
| `register(root, { referenceTarget }?)` | Captures a known root from the installation's realm. Returns `{ dispose() }` to unregister and exclude that root from automatic rediscovery until it is explicitly registered again. The optional value overrides its current target in fallback mode. |
| `hydrate(container = document)` | Explicit bounded discovery for accessible pre-existing/open roots below the container. Each call traverses that container once, reads host `data-reference-target` metadata, clears metadata-owned targets when that attribute was removed, then reconciles adapters without a second document walk. |
| `refresh()` | Synchronously drains already-queued observer records, including bounded discovery for added subtrees, then reconciles adapter state. It does not initiate an unconditional document/root scan. Use once after a batch of property-only or application-model changes that cannot produce observable DOM mutations. |
| `dispose()` | Disconnects observers/listeners, releases adapter changes it still owns, unregisters roots, restores its owned `attachShadow` wrapper, and transitions the live handle to `disposed`. Repeated disposal is harmless. |

Native-unverified, unsupported, and inactive handles have no active adapters and their lifecycle methods are no-ops. On a disposed fallback handle, `hydrate()`, `refresh()`, and repeated `dispose()` are no-ops; `register()` rejects new work. The installer deliberately declines to layer fallback activation over detected partial native support. Install once per realm; during hot-module replacement, dispose the previous fallback handle before evaluating setup again.

Built-in adapter factories return opaque descriptors. Treat only the handle and factory options described here and in the package declarations as public API; adapter installation context and runtime objects are privileged internals unless a future exported type explicitly makes that extension protocol public.

### Diagnostics

`onDiagnostic`, if provided, receives `{ code, detail }`. It is synchronous telemetry: keep it fast and nonthrowing, do not mutate the DOM from it, and ignore unknown future codes. Node values are reduced to public source/host metadata rather than exposing a resolved private target. Detail fields can grow additively within `0.x`.

| Code | Meaning |
| --- | --- |
| `missing-primitive` | A selected adapter or action needs a browser method that is unavailable. |
| `labels-naming-unavailable` | The browser rejected the outward ARIA element-reference list used for opt-in label naming. |
| `unresolved-target` | A forwarded reference has no current effective target. |
| `unsupported-target` | The effective target is not valid for the selected action. |
| `invalid-action-state` | A native popover/dialog method rejected the target's current state. |
| `text-provider-value` | `getText()` returned neither a string nor `null`. |
| `text-provider-error` | `getText()` threw; that host reference was left alone. |
| `unsupported-image-submitter` | An image submitter's selected coordinates cannot be reproduced. |
| `disabled-submitter-proxy` | An enclosing disabled fieldset disabled the temporary internal submitter. |
| `root-discovery-error` | Initial or mutation-driven automatic discovery could not capture one accessible root. It reports sanitized public host/error metadata and continues with later roots; explicit `register()` and `hydrate()` errors still throw to their caller. |
| `activation-errors` | An internal adapter click handler threw. This safety diagnostic contains sanitized failures without exposing a private target. |
| `refresh-errors` | An internal adapter refresh or change callback threw. Automatic reconciliation reports sanitized errors without creating an uncaught observer-task error; synchronous install, `hydrate()`, or `refresh()` also throws an `AggregateError` to its caller. |

`force: true` is for testing. It suppresses native Reference Target forwarding on captured roots while exercising the fallback, then restores the captured value when released. Do not use it to automatically override partially implemented native behavior in production.

## Choose adapters

| Module and factory | Supported approximation |
| --- | --- |
| `adapters/labels` → `labels({ activation, naming = false })` | External `label[for]` and wrapping-label activation for a forwarded native labelable control. `activation` must explicitly be `"focus"` or `"focus-and-click"`. Optional outward label naming uses native `ariaLabelledByElements`. |
| `adapters/popover-targets` → `popoverTargets()` | Forwarded `popovertarget` and `popoverTargetElement` activation using native popover methods; supports show, hide, and toggle. |
| `adapters/dialog-commands` → `dialogCommands()` | Forwarded button `commandfor`/`commandForElement` with `show-modal`, `close`, and `request-close`, using native dialog methods. |
| `adapters/popover-commands` → `popoverCommands()` | Forwarded button commands `show-popover`, `hide-popover`, and `toggle-popover`, using native popover methods. |
| `adapters/text-names` → `textNames({ getText })` | Approximates inward `aria-labelledby` and `aria-describedby` references using component-provided plain text and hidden proxies in the source's own tree. |
| `adapters/form-targets` → `formTargets()` | External submit/reset buttons and inputs with `form="host"` act on an inner native form. Submission uses a temporary native submitter; this does not establish cross-root form ownership. |

**Labels:** choose the activation policy for your controls and platform expectations. `focus-and-click` calls `.click()` and can change checkbox/radio state; this is synthetic activation. Existing native label associations are skipped, including form-associated custom elements (FACE), to avoid duplicate activation. Interactive descendants and unavailable controls are guarded. This adapter does not implement native `.control`, `.labels`, form association, or native label event behavior.

Naming is separately opt-in with `naming: true`. It needs working outward ARIA element references from the inner control to labels in an ancestor tree. Existing author-provided `aria-label` or `aria-labelledby` relationships take precedence. The adapter retains existing internal native labels when constructing its explicit list and releases ownership when the author replaces the relationship. Browsers rejecting the outward list report `labels-naming-unavailable`; successful property readback still requires accessibility testing.

**Popover and dialog actions:** popover adapters require native `showPopover()` and `hidePopover()`. Dialog commands require native `showModal()` and `close()`; `request-close` also needs native `requestClose()` at activation time. The package does not polyfill these primitives, top-layer behavior, arbitrary commands, or `CommandEvent` fully. Use explicit `type="button"` for popover/dialog invokers belonging to a form. Form actions take precedence over command/popover actions, and command precedence is preserved over popover-target activation.

Command adapters dispatch a cancelable synthetic `command` event before invoking the native method. They use `CommandEvent` when available, otherwise an `Event` with `command` and `source` properties. These events are untrusted and do not reproduce Reference Target's native event paths or source retargeting. Actions run during bubbling: cancellation already observed is respected, but a later listener cannot undo a performed action. Passing `source` to `showPopover()` depends on browser support; hiding cannot supply it through `hidePopover()`.

**Text names:** the provider receives the publicly referenced host, never its resolved private target. Hosts inside an enclosing closed root are skipped to keep that tree private; a public host can still forward to its own closed target. Return a string to opt in, including `""` for empty text; return `null` to leave that host reference alone.

```js
import { textNames } from "reference-target-fallback/adapters/text-names";

const names = textNames({
  getText(host, kind) { // kind is "label" or "description"
    return host.getAttribute(
      kind === "label" ? "data-label-text" : "data-description-text",
    );
  },
});
// Include names in the adapters array when installing.
```

Provide text through a component's public contract. `getText()` runs synchronously during reconciliation and can run again after relevant mutations or an explicit refresh; keep it pure, fast, and free of DOM writes. This is not the Accessible Name and Description Computation algorithm: rich content, nested naming rules, localization, and model-derived values remain the component's responsibility. No generic `textContent` scraping is performed. Generic forwarding for `aria-controls`, `aria-activedescendant`, `aria-owns`, and other cross-root ARIA relations remains outside this package.

The text adapter temporarily rewrites the source relation to hidden text proxies, preserving its original IDREF or supported native element-list binding. The proxies live in the source's own tree: they are visually hidden but remain visible to same-tree scripts, developer tools, DOM observers, and accessibility computation. Do not put secrets in provider text or treat proxy IDs as an application API. The adapter removes obsolete proxies and restores the original binding on release only while it still owns the applied value.

Invalid forwarded targets are omitted. For later native ARIA element-list assignments or provider-model changes, call `refresh()` once after batching updates; mutation observation cannot detect every such update. Reconciliation following relevant ordinary DOM mutations is asynchronous and coalesced. Author updates should supply public IDs or elements instead of extending the adapter's temporary proxy references. An author reassignment identical to the current value cannot be distinguished from an unchanged binding.

### Form actions

`formTargets()` is a separate opt-in adapter. Keep the data controls inside a native form and reference its component host from outside submit/reset controls:

```html
<x-profile id="profile" data-reference-target="form">
  <template shadowrootmode="open" shadowrootreferencetarget="form">
    <form id="form">
      <label>Email <input name="email" type="email" required></label>
    </form>
  </template>
</x-profile>
<button type="submit" form="profile" name="intent" value="save" disabled>Save</button>
<input type="reset" form="profile" value="Reset" disabled>
```

```js
// reference-target.setup.js — use the same conditional bootstrap shown above.
import { installReferenceTarget } from "reference-target-fallback/core";
import { formTargets } from "reference-target-fallback/adapters/form-targets";

export const referenceTarget = installReferenceTarget({ adapters: [formTargets()] });
// The form above is parser-created declarative markup, so hydrate it once.
referenceTarget.hydrate();
```

The adapter calls native `HTMLFormElement.prototype.requestSubmit` and `.reset`, preserving validation, cancelable submit/reset events, and native form-data handling for the form's own controls. Prototype calls avoid methods being shadowed by controls named `requestSubmit` or `reset`. Existing native form ownership is left alone.

For submission, it temporarily appends a hidden submitter matching the external control's element type, snapshots its authored `name`, `value`, `formaction`, `formmethod`, `formenctype`, `formtarget`, and `formnovalidate` attributes at activation, and removes the proxy when `requestSubmit()` returns. Later changes to the outside control do not update that snapshot. Absent overrides stay absent, so the form's settings continue to apply. Image submitters are suppressed with an `unsupported-image-submitter` diagnostic because their selected coordinates cannot be reproduced. A proxy disabled by an enclosing fieldset produces `disabled-submitter-proxy` and no submission.

Use explicit button types. With a valid forwarded form, a button with an omitted/invalid type and a command attribute performs neither submission nor command activation. An explicit `type="button"` remains eligible for a selected command adapter.

Listen inside the component containing the form. If handling submission with JavaScript, collect data synchronously, before the temporary submitter is removed:

```js
// Inside the component's initialization, after its shadow root is available:
const form = this.shadowRoot.getElementById("form");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form, event.submitter);
  // data includes the external submitter's copied name/value.
  // Hand the snapshot to an application-owned secure transport; do not log it.
  saveProfile(data);
});
for (const control of document.querySelectorAll('[form="profile"]')) {
  control.disabled = false;
}
```

Keep external form actions disabled until installation and the form's own submit/reset handlers are ready. This closes the interval between setup evaluation and application initialization, when fallback activation could otherwise submit before the application can cancel navigation.

In fallback mode `event.submitter` is the temporary internal proxy, not the outside control; the proxy and its copied authored values are briefly visible to code inside the form component and in the form's collection. Treat the component and outside invoker as one trust boundary. Submit/reset events retain their native shadow boundaries rather than acquiring Reference Target's cross-root event path. Activation runs during click bubbling, so a later click listener cannot cancel an already performed form action; cancel submission in the form's own `submit` listener.

This adapter does not associate external data controls, synthesize `.form` or `.elements`, patch reflected getters, reproduce implicit Enter submission rules, or bridge form-associated custom elements. The outside submitter's `.form` remains `null`; calling `innerForm.requestSubmit(outsideSubmitter)` still throws because it is not natively owned by that form. An external text input with `form="profile"` is not included merely because the submit button works. A full form-ownership polyfill remains outside this package's scope.

## Declarative and existing roots

A browser that understands declarative Shadow DOM but lacks Reference Target may consume the `<template>` before JavaScript can recover `shadowrootreferencetarget`. Preserve fallback metadata on the host:

```html
<label for="email">Email</label>
<x-email id="email" data-reference-target="control">
  <template shadowrootmode="open" shadowrootreferencetarget="control">
    <input id="control" type="email">
  </template>
</x-email>
```

Call `referenceTarget.hydrate()` once after that markup is available. It scans the supplied container once, discovers open roots including nested roots, reads `data-reference-target`, and reconciles known adapter state; it does not implement the declarative Shadow DOM parser. Call it again only after adding pre-existing roots or changing this fallback metadata. Removing metadata clears a target previously owned by hydration, but does not overwrite a later programmatic `root.referenceTarget` assignment. Automatic mutation discovery does not interpret host metadata.

Imperative closed roots created after installation are captured by the wrapper. A preexisting closed root, including a declarative one, requires component cooperation and an actual root reference:

```js
const registration = referenceTarget.register(rootKnownToTheComponent, {
  referenceTarget: "control",
});

// When this component no longer participates:
registration.dispose();
```

The public installation handle does not expose a raw target resolver. Scripts must not rely on obtaining a private target through it. Native reflection, shadow-root cloning/serialization, full form ownership, `list`/`headers` association, and exact synchronous native mutation behavior are outside this implementation's scope. The optional form adapter covers submit/reset actions only.

## Compatibility and operating model

| Area | Requirement or policy |
| --- | --- |
| Module loading | ESM is required; optimized direct-browser modules target ES2022. The recommended bootstrap uses dynamic import, top-level `await`, and optional `modulepreload`. A bundler must preserve the setup boundary. Under Content Security Policy, allow the self-hosted module URLs in `script-src`; no `eval` is required. Wrap the bootstrap in an async function when the application's output target cannot emit top-level await. |
| Browser realm | Installation requires a browser `Window` with a `document`, native Shadow DOM, `MutationObserver`, `WeakRef`, and `queueMicrotask`. Importing modules is side-effect free and server-safe; calling the installer during SSR is not. Run it in the client entry point before hydration constructs components. |
| Frames | Install once for each same-origin realm that creates participating roots, passing that frame's `window` as `realm`. Roots passed to `register()` must come from that realm. The package cannot inspect a cross-origin frame. |
| Declarative Shadow DOM | Optional and not polyfilled. `hydrate()` can discover an already-parsed open root when the host retains `data-reference-target`; a pre-existing closed root requires component cooperation. |
| Labels and naming | Activation uses ordinary focus/click primitives. `naming: true` additionally needs working outward `ariaLabelledByElements`; successful readback is not an accessibility guarantee. |
| Popovers and dialogs | Popover adapters need native `showPopover()`/`hidePopover()`. Dialog commands need native `showModal()`/`close()`; `request-close` needs `requestClose()` when invoked. |
| Forms | `formTargets()` needs native `requestSubmit()` and `reset()`. It routes actions only and does not create form ownership. |
| Native Reference Target | The exported probe covers the surface, nullable assignment, and basic label forwarding only. Other selected behaviors remain native-unverified until the application's browser and assistive-technology tests establish them. |

The framework demos are client-rendered integration examples, not SSR or hydration certification. There is no CommonJS or package-root entry point. Consumers that need older syntax can transpile their own bundle, but transpilation cannot supply the required DOM primitives.

## Examples

| Page | Selected adapters |
| --- | --- |
| [Demo gallery](https://westbrook.github.io/reference-target-polyfill/examples/) | Six adapters, with every demo on the page and additional reference-boundary comparisons. |
| [Labels](https://westbrook.github.io/reference-target-polyfill/examples/labels/) | `labels({ activation: "focus-and-click", naming: true })` only |
| [Popover targets](https://westbrook.github.io/reference-target-polyfill/examples/popover-targets/) | `popoverTargets()` only |
| [Dialog commands](https://westbrook.github.io/reference-target-polyfill/examples/dialog-commands/) | `dialogCommands()` only |
| [Popover commands](https://westbrook.github.io/reference-target-polyfill/examples/popover-commands/) | `popoverCommands()` only |
| [Text names and descriptions](https://westbrook.github.io/reference-target-polyfill/examples/text-names/) | `textNames({ getText })` only |
| [Form actions](https://westbrook.github.io/reference-target-polyfill/examples/forms/) | `formTargets()` only |
| [Lit custom elements](https://westbrook.github.io/reference-target-polyfill/examples/lit/) | Labels and popover targets |
| [FAST custom elements](https://westbrook.github.io/reference-target-polyfill/examples/fast/) | Labels and popover targets |
| [Stencil custom elements](https://westbrook.github.io/reference-target-polyfill/examples/stencil/) | Labels and popover targets |
| [Preact custom element base class](https://westbrook.github.io/reference-target-polyfill/examples/preact/) | Labels and popover targets |
| [Vue custom elements](https://westbrook.github.io/reference-target-polyfill/examples/vue/) | Labels and popover targets |
| [Svelte custom elements](https://westbrook.github.io/reference-target-polyfill/examples/svelte/) | Labels and popover targets |
| [Angular Elements](https://westbrook.github.io/reference-target-polyfill/examples/angular/) | Labels and popover targets |
| [Original six-scenario companion](https://westbrook.github.io/reference-target-polyfill/examples/scenarios/) | Labels, popover targets, and text names for the retained declarative comparisons. |

The main page contains working examples for six adapters. Each demonstrated capability also has an independent page and bundle, allowing behavior and functional JavaScript transfer size to be compared with only that adapter selected. These byte totals are not load-time or runtime benchmarks. The boundary comparisons use existing adapters.

The demos pair a short capability description with working controls and live observations. Browser details, behavior limits, and implementation notes are expandable; code samples and measured file sizes remain available on each page. Shared styles follow the system’s light or dark preference without a theme switch. Syntax highlighting is separate demo decoration and is excluded from the functional bundle figures.

Every page supports `?mode=auto`, `?mode=fallback`, and `?mode=off`. Automatic mode loads its selected setup when the native surface is absent; a skipped fallback means only that a native surface was found, not that every selected behavior was verified. Forced mode exercises the fallback; off mode loads no fallback and leaves native browser behavior available. Each mode still imports the application after selection. The observations report DOM state, not computed accessibility results.

The form demo keeps native inputs, a checkbox, and a select inside its declarative form. Outside Submit, Save draft (`formnovalidate`), and Reset buttons exercise validation, submitter data, and native defaults. Its component-local listeners cancel navigation, capture `FormData` synchronously, and display events and actual `.form` getters; the example sends no form data.

The seven renderer pages use the actual [Lit](https://lit.dev/), [FAST](https://fast.design/), [Stencil](https://stenciljs.com/), [Preact](https://preactjs.com/), [Vue](https://vuejs.org/guide/extras/web-components.html), [Svelte](https://svelte.dev/docs/svelte/custom-elements), and [Angular Elements](https://angular.dev/guide/elements) libraries. Each demonstrates an outside label, a checkbox replaced by a reactive attribute update, and an outside popover invoker. Components set `referenceTarget` on their framework-created shadow roots and wait for their first render before the page becomes ready. The fallback observes subsequent target replacements; the application does not forward actions itself. These are client-rendered examples, not server-rendering or hydration tests.

Lit uses `LitElement` and `keyed`; FAST uses `FASTElement` and a non-recycling `repeat`; Stencil compiles keyed JSX into custom elements. The Preact page includes a small `PreactElement` base class that owns the shadow root, batches attribute updates, unmounts on disconnection, and renders again on reconnection. Expand Component source on a built page to inspect the actual source, including the Preact base class and Stencil TSX.

Vue uses `defineCustomElement`, a numeric prop, and keyed render functions from its runtime-only entry point. Svelte compiles `.svelte` files into custom elements, with a numeric prop and keyed block. Angular uses `createCustomElement`, `ViewEncapsulation.ShadowDom`, and a tracked block driven by a signal input; its templates and package code are compiled and linked before bundling. Neither template compilers nor Zone.js are delivered to the new pages.

Renderer lifecycle limits are separate from forwarding behavior. Vue 3.5.42 remounts after a full disconnect/reconnect but stops observing subsequent attribute updates; create a fresh element after teardown. Angular Elements has a [documented same-instance reconnection limitation](https://angular.dev/guide/elements#limitations) after destruction. Its tests cover connected target replacement and popovers without claiming reconnection support. The pages retain the standard framework lifecycles and document these limits instead of modifying framework internals.

The retained six-scenario companion contains original examples inspired by [Microsoft Edge's Reference Target demos](https://microsoftedge.github.io/Demos/reference-target/). All six use parser-created Declarative Shadow DOM and retained `data-reference-target` metadata:

1. An external label activates an internal checkbox, with opt-in outward naming.
2. An external popover invoker targets an internal panel.
3. An external input references selected internal label text, approximated through the component's public text-provider contract.
4. A host's `aria-label` stays on the host; it is not copied to an inner button.
5. A host's `popovertarget` is not copied inward, and an inner string ID reference cannot look outward.
6. An explicit outward `popoverTargetElement` assignment connects an inner button to an outer popover using the browser's element-reflection capability, independently of Reference Target.

### Shared examples, separate builds

`examples/pages.js` is the build-time page catalog. The gallery and capability pages have HTML shells containing `<!-- demo:... -->` and bundle-size markers. The build expands these using `examples/shared/demos/*.html` and embeds the size reports in the resulting static HTML. The browser receives actual demo markup, including declarative shadow templates.

Capability application modules import only their selected `examples/shared/features/*.js` initializers. Renderer application modules import their own components and shared observation controls. A page's `main.js` awaits its optional setup and then its application; the shared bootstrap imports no adapters. Each renderer has an independent bundle; visiting the gallery or another renderer never loads that library. The package API and application initialization contract are unchanged.

Code samples use [Microlighter](https://davatron5000.github.io/microlighter/) with its GitHub theme. It highlights HTML, JavaScript, TypeScript, Stencil TSX, and Svelte using the CSS Custom Highlight API without adding token elements to the samples. The build copies the pinned development dependency, required grammars, theme, and MIT license into a separate shared demo asset directory. Highlighting runs independently of application setup; browsers without that API keep readable plain-text samples. The highlighter is neither a polyfill dependency nor part of the size figures below.

## Functional bundle sizes and performance budgets

The built pages show generated functional JavaScript sizes, including the baseline, additional fallback, total with fallback, and individual emitted files. The gallery also compares the independent capability builds. Figures come from the build output, rather than hand-maintained estimates, and are available in [the deployed size manifest](https://westbrook.github.io/reference-target-polyfill/examples/bundle-sizes.json) or locally at `dist/examples/bundle-sizes.json`.

| Measurement | Included JavaScript |
| --- | --- |
| Baseline (shown as "Page JavaScript") | The measured functional graph: bootstrap, application, selected demo initializers, renderer runtime and embedded styles (on renderer pages), and their shared dependencies. It is not every script requested by the complete demo page. |
| "Fallback additional" | The selected setup, installer, adapters, and dependencies that are not already in the baseline. |
| Total with fallback | The union of baseline and fallback files. Each shared chunk is counted once. |

Sizes are shown in decimal KB (`1 KB = 1,000 bytes`). Raw figures measure emitted minified JavaScript; gzip figures sum the separately compressed size of each JavaScript file. They exclude Microlighter and its eagerly requested demo highlighting script/grammars, HTML, separate CSS files, JSON, source maps, and HTTP headers. Component styles embedded in JavaScript are included. Use the browser Network and Resource Timing views for full-page request count, transfer, cache, and timing analysis.

The local server can serve the measured JavaScript gzip sidecars, so its compressed bodies correspond to the reported functional files. Production compression, Brotli, caching, latency, and bundler chunking can change actual delivery. The optimized `browser/` distribution is minified and split into shared chunks; direct imports of raw `src/` modules make more, larger requests and are a debug/evaluation path, not a comparable production bundle.

An independent capability's fallback cost includes the core installer and its required shared utilities. Adding the six independent costs does not predict the gallery's cost: the gallery shares code and is bundled as its own graph. Rebuild after changing a feature, selection, or build setting to regenerate the visible report and manifest.

### Review budgets

These are engineering gates, not claims that every device meets a timing result:

| Area | Budget |
| --- | --- |
| Package compositions | Surface detection, full detection, core, each core-plus-one-adapter path, and all public runtime modules have independent minified/raw, gzip, and Brotli caps in the executable package-size test. |
| Native-surface automatic path | No core, setup, adapter, or internal fallback module request. The surface check, optional probe, and application remain baseline. |
| Discovery | `installReferenceTarget()` does one initial discovery. `hydrate(container)` traverses its supplied container once. `refresh()` initiates no scan, but drains queued mutation records and may discover only their added subtrees before reconciliation. |
| Mutation work | Irrelevant attributes/text must not reconcile adapters. A relevant mutation burst schedules at most one reconciliation microtask per installation before additional reentrant work. |
| Selected services | Action-only selections do not run label/text query scans; adapters and listeners that fail capability checks do not remain active. |
| Teardown | A disposed handle reports no active adapters and leaves no active owned observers, listeners, temporary proxies, or patched method. |

The executable current caps live in [`tests/package-sizes.test.js`](https://github.com/Westbrook/reference-target-polyfill/blob/main/tests/package-sizes.test.js); generated browser-module and demo sizes stay in their build-managed manifests rather than being copied into prose before a release build. An increase above a byte cap needs a checked-in budget change and explanation. The runtime work budgets should be asserted with counters as well as wall-clock measurements, because elapsed time alone is noisy.

### Runtime measurement method

No p50/p95 load, install, render, or update result is claimed by the current size report. The fallback does not render component UI; framework render timings on the demo pages must be reported separately from fallback installation, reconciliation, and action work. Before making such a claim, record the commit, browser/build, operating system, CPU/device, power mode, cache state, sample count, and DOM fixture. Measure at least:

1. cold and warm navigation, request waterfalls, parse/evaluation, installation, application-ready time, and full-page transfer;
2. installation and hydration with 1, 100, and 1,000 hosts across open, closed, and nested roots;
3. irrelevant mutation bursts, relevant target/ID changes, one explicit `refresh()`, text-provider updates, and action latency;
4. label/text reconciliation at increasing source counts, with a pure provider and a representative application provider; and
5. retained roots/proxies/listeners after removal and disposal.

Report medians and p95 values separately. Demos and their permissive readiness timeouts establish eventual behavior, not performance. Set numeric time thresholds only from a reproducible reference run and fail regressions against that baseline.

## Stability, upgrades, and native retirement

This is a `0.x` Git-installed prototype. Use reviewed tags or commit SHAs rather than mutable `main` in production. Each tagged change should record API/status/diagnostic changes, browser validation, functional size deltas, and any metadata/provider migration. Deprecate a public option or diagnostic code before removing it when practical, but review every minor update for breaking changes.

During hot-module replacement or a same-realm reinstall, dispose the previous live fallback before evaluating setup again and clear the state bridge. A stale disposed handle is safe to retain for inspection but has no active adapters.

Retire the fallback per selected capability, not just when a surface property appears:

1. validate the native behavior, cancellation/order differences, accessible output, and assistive-technology result in every supported browser;
2. compare native automatic, forced-fallback, and off modes for the application's cases;
3. remove component text-provider hooks and `data-reference-target` metadata only after their native replacements are verified;
4. dispose the fallback, remove the conditional setup import and state bridge, then remove detection when it is no longer part of capability monitoring; and
5. retain or simplify the dynamic application import according to the application's latency and bundling needs.

Native label activation, command events, event paths, submitter identity, and naming computation can differ from the fallback even when both appear to work. Treat that as a migration requiring tests, not a dead-code deletion.

## Run locally

For repository example builds, use Node.js 24.15+ on the 24.x line (`.nvmrc` selects 24), or 22.22.3+ on the 22.x line, to meet Angular 22’s compiler requirements. This is a contributor-toolchain constraint, not a browser-package runtime requirement. Package runtime modules use only browser APIs. The rendering libraries, their compilers and build tools, esbuild, and Microlighter are development dependencies; the packaged fallback has no third-party runtime package dependencies.

```sh
npm ci
npm start
npm test
npm run build:example
```

`npm start` builds the complete site through `prestart`, then serves the consumption guide at `/`, the gallery and capability pages under `/examples/`, and the [browser tests](http://127.0.0.1:4173/tests/browser.html). `/dist/examples/` is an alias for the same built output. Set `RT_PORT` to change the default port of 4173.

`npm run build:example` first compiles Stencil sources into `dist/stencil` and Angular sources into `dist/angular`, then builds every cataloged page independently into `dist/examples`. Svelte components compile through an esbuild plugin; Angular’s package code passes through its official linker. The generated runtime code is included in the relevant page’s size report, with no browser-time compilers or CDN imports. The build generates static demo HTML, component source samples, current size reports, gzip JavaScript sidecars, `bundle-sizes.json`, and a combined esbuild dependency report in `dist/metafile.json`. Run it again after edits; the server does not automatically rebuild.

For source inspection, `/source/examples/` serves the original files and `/source/src/` maps their runtime imports. The gallery and capability source HTML are unexpanded templates, so those debug URLs are not the complete interactive pages. Use `/examples/` for the rendered demos and measured bundles.

The development server serves JavaScript gzip sidecars when the request accepts gzip, varies the response by `Accept-Encoding`, and disables caching so reloads reflect the current build. The size report counts compressed bodies rather than HTTP headers.

## GitHub Pages

`main` contains source, documentation, and build tools. `gh-pages` contains the generated static site, including the consumption guide, demo bundles, optimized browser modules, and debug ESM source. The site uses relative URLs so it works under the repository's `/reference-target-polyfill/` prefix.

```sh
npm run build:pages       # Build dist/site for inspection
npm run prepare:pages     # Rebuild and commit generated changes to local gh-pages
git push origin main gh-pages
```

The preparation command leaves the source checkout in place and preserves Pages history. GitHub Pages publishes from the root of `gh-pages`; CI validates source changes but does not publish npm packages or update that branch. See [the contribution guide](https://github.com/Westbrook/reference-target-polyfill/blob/main/CONTRIBUTING.md) for setup and maintenance.

## Validation

`npm test` runs Node checks for import behavior, API validation, and the bundles' dependency graphs; it does not launch a browser or screen reader. Use the browser harness and each page's loading modes to check activation, behavior, and conditional loading in the browsers you support.

Native-surface tests may be skipped where that API is absent; force-mode simulations do not establish native interoperability. Browser behavior and accessibility outcomes require browser and assistive-technology validation. No cross-browser conformance claim is made here.

The checked-in suites verify package exports and declarations, explicit size/request budgets, setup isolation, the six adapters, lifecycle and rollback behavior, targeted invalidation, renderer integration, and automatic/forced/off loading. Test counts and measured bytes change as cases and builds evolve, so use the current command output, generated manifests, and CI run rather than a frozen README snapshot. Firefox, Safari, and assistive-technology behavior remain separate validation responsibilities unless the corresponding run records them.
