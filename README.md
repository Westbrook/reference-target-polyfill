# Reference Target polyfill

A `0.1.0` prototype that supplies selected Reference Target behaviors when the browser lacks the API, plus a cooperative combobox adapter for public listbox/options. It uses native Shadow DOM and has no runtime dependencies. It is a partial, component-aware fallback: JavaScript cannot recreate the browser's accessibility relationships, form association, event paths, or encapsulated reflection in full.

[Consumption guide](https://westbrook.github.io/reference-target-polyfill/) · [Live demos](https://westbrook.github.io/reference-target-polyfill/examples/) · [Contributing](./CONTRIBUTING.md) · [MIT license](./LICENSE)

The package exports separate ESM modules. Importing them does not install anything; call `installReferenceTarget()` with the adapters your application needs. There is no package-root or “all adapters” entry point. See [the research and design proposal](./REFERENCE-TARGET-PROPOSAL.md) for specification and implementation context.

## Install from GitHub

The package is not published to npm. Install it from this repository:

```sh
npm install git+https://github.com/Westbrook/reference-target-polyfill.git#main
```

The installed package name is `reference-target-fallback`; use that name in imports. Replace `main` with a reviewed commit SHA for a pinned dependency and commit your application's lockfile. The raw ESM source is also available under [the site's `src/` directory](https://westbrook.github.io/reference-target-polyfill/src/detect.js); copy the complete source directory into an application when self-hosting.

## Load before components

Use the local source paths below in this repository. Package consumers using a local package link can substitute `reference-target-fallback/detect`, `reference-target-fallback/core`, and `reference-target-fallback/adapters/labels`, for example. The package has not been published to npm.

```js
// bootstrap.js
import { hasNativeReferenceTarget } from "./src/detect.js";

if (!hasNativeReferenceTarget()) {
  await import("./reference-target.setup.js");
}

// app.js defines components and performs its initialization when evaluated.
await import("./app.js");
```

```js
// reference-target.setup.js
import { installReferenceTarget } from "./src/core.js";
import { labels } from "./src/adapters/labels.js";
import { dialogCommands } from "./src/adapters/dialog-commands.js";

export const referenceTarget = installReferenceTarget({
  adapters: [
    labels({ activation: "focus" }),
    dialogCommands(),
  ],
});

referenceTarget.hydrate();
```

Keep the optional setup module out of the application's static import graph. Its static adapter imports make the selected features explicit, while the awaited dynamic import completes installation before component constructors run. No `start()` export is required from the application. If your application's package metadata marks modules as side-effect free, explicitly preserve the setup module as side-effectful so bundling retains installation.

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

`hasNativeReferenceTarget(realm = globalThis)` checks only for the native property on `ShadowRoot.prototype`. It does not prove behavioral or accessibility support. `probeReferenceTarget(realm = globalThis)` returns `{ surface, nullable, labels }` after small DOM probes for nullable assignment and label-control forwarding, invalidation, and restoration. These probes do not certify every relation, accessible-name computation, or assistive-technology behavior.

```js
import { probeReferenceTarget } from "./src/detect.js";

const support = probeReferenceTarget();
// If support.surface is true but another result is false, treat this as a
// partial native implementation and retain an application-specific fallback.
```

The bootstrap example skips loading this package whenever the native surface exists. For deployments including experimental browser implementations, inspect the probe results as part of your application's capability policy. The [combobox adapter](#combobox-relationships) has a different loading policy: Phase 1's single target does not replace its two-target provider contract, so keep that selected setup loaded even on native Phase 1 browsers.

`installReferenceTarget({ adapters = [], realm = globalThis, force = false, onDiagnostic })` requires a browser realm with Shadow DOM, `MutationObserver`, and `WeakRef`. It rejects duplicate adapter IDs and a second active installation in the same realm. `onDiagnostic`, if provided, receives `{ code, detail }`; built-in diagnostics use public source/host metadata rather than exposing the resolved private target.

| Handle member | Behavior |
| --- | --- |
| `mode` | `fallback` when installed; `native` when the surface and both basic probes pass; `unsupported` when the native surface exists but those probes fail; `inactive` when no adapters were selected. |
| `reason` | Explanation on an inactive or unsupported handle, when applicable. |
| `statuses` | Adapter ID → `fallback`, `unsupported`, `native`, or `inactive`. Missing native primitives can make individual adapters unsupported even when the handle's mode is `fallback`. |
| `activeAdapters` | IDs of adapters currently installed in fallback mode. |
| `register(root, { referenceTarget }?)` | Captures a known root from the installation's realm. Returns `{ dispose() }` to unregister that root. The optional value overrides its current target in the regular fallback. Native cooperation only observes roots and preserves native target values. |
| `hydrate(container = document)` | Discovers accessible roots below the container, then refreshes adapters. The regular fallback also reads host `data-reference-target` metadata; native cooperation preserves native configuration. |
| `refresh()` | Synchronously reconciles adapter state. Use after property-only or application-model changes that do not produce DOM mutations. |
| `dispose()` | Disconnects observers/listeners, releases adapter changes it still owns, unregisters roots, and restores its `attachShadow` wrapper when it still owns it. |

Native, unsupported, and inactive handles have no active adapters and their methods are no-ops. Even `mode: "native"` means only that the basic probes passed. The installer deliberately declines to layer fallback activation over detected partial native support.

The combobox adapter explicitly opts into native cooperation. When selected with a native Reference Target surface, it remains active and the handle has `mode: "fallback"`; the other selected adapters report `native` or `unsupported` according to the basic probes. This mode leaves native `attachShadow()` and root target properties intact. The public-DOM combobox contract does not depend on native cross-root forwarding.

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
| `adapters/combobox-targets` → `comboboxTargets({ getTargets })` | Connects an editable combobox's `aria-controls` and `aria-activedescendant` to a component-provided, real listbox and active option in the input's own DOM tree. |

**Labels:** choose the activation policy for your controls and platform expectations. `focus-and-click` calls `.click()` and can change checkbox/radio state; this is synthetic activation. Existing native label associations are skipped, including form-associated custom elements (FACE), to avoid duplicate activation. Interactive descendants and unavailable controls are guarded. This adapter does not implement native `.control`, `.labels`, form association, or native label event behavior.

Naming is separately opt-in with `naming: true`. It needs working outward ARIA element references from the inner control to labels in an ancestor tree. Existing author-provided `aria-label` or `aria-labelledby` relationships take precedence. The adapter retains existing internal native labels when constructing its explicit list and releases ownership when the author replaces the relationship. Browsers rejecting the outward list report `labels-naming-unavailable`; successful property readback still requires accessibility testing.

**Popover and dialog actions:** popover adapters require native `showPopover()` and `hidePopover()`. Dialog commands require native `showModal()` and `close()`; `request-close` also needs native `requestClose()` at activation time. The package does not polyfill these primitives, top-layer behavior, arbitrary commands, or `CommandEvent` fully. Use explicit `type="button"` for popover/dialog invokers belonging to a form. Form actions take precedence over command/popover actions, and command precedence is preserved over popover-target activation.

Command adapters dispatch a cancelable synthetic `command` event before invoking the native method. They use `CommandEvent` when available, otherwise an `Event` with `command` and `source` properties. These events are untrusted and do not reproduce Reference Target's native event paths or source retargeting. Actions run during bubbling: cancellation already observed is respected, but a later listener cannot undo a performed action. Passing `source` to `showPopover()` depends on browser support; hiding cannot supply it through `hidePopover()`.

**Text names:** the provider receives the publicly referenced host, never its resolved private target. Hosts inside an enclosing closed root are skipped to keep that tree private; a public host can still forward to its own closed target. Return a string to opt in, including `""` for empty text; return `null` to leave that host reference alone.

```js
import { textNames } from "./src/adapters/text-names.js";

const names = textNames({
  getText(host, kind) { // kind is "label" or "description"
    return host.getAttribute(
      kind === "label" ? "data-label-text" : "data-description-text",
    );
  },
});
// Include names in the adapters array when installing.
```

Provide text through a component's public contract. This is not the Accessible Name and Description Computation algorithm: rich content, nested naming rules, localization, and model-derived values remain the component's responsibility. No generic `textContent` scraping is performed. The separate combobox adapter covers a cooperative subset of `aria-controls` and `aria-activedescendant`; arbitrary cross-root ARIA relations and `aria-owns` remain outside this package.

The text adapter temporarily rewrites the source relation to hidden text proxies, preserving its original IDREF or supported native element-list binding. It observes author replacements, removes obsolete proxies, and restores the original binding on release only while it still owns the applied value. Invalid forwarded targets are omitted. For later native ARIA element-list assignments or provider-model changes, call `refresh()`; mutation observation cannot detect every such update. Reconciliation following ordinary DOM mutations is asynchronous. Author updates should supply public IDs or elements instead of extending the adapter's temporary proxy references. An author reassignment identical to the current value cannot be distinguished from an unchanged binding.

### Combobox relationships

The explainer's [combobox example](https://github.com/WICG/webcomponents/blob/gh-pages/proposals/reference-target-explainer.md#aria-activedescendant-and-comboboxes) needs two destinations: the popup listbox and its current option. A single `ShadowRoot.referenceTarget` cannot select both through the same host. The broader [Phase 2 design](https://github.com/WICG/webcomponents/blob/gh-pages/proposals/reference-target-explainer.md#phase-2-referring-to-specific-elements-within-a-shadow-root) remains separate from Phase 1.

`comboboxTargets()` provides a structural fallback for cooperating components. Keep the actual listbox and options in the input's DOM tree, optionally rendered through a slot in the component's shadow root. Supply those public elements through a synchronous callback:

```js
// reference-target.setup.js
import { installReferenceTarget } from "reference-target-fallback/core";
import { comboboxTargets } from "reference-target-fallback/adapters/combobox-targets";

export const referenceTarget = installReferenceTarget({
  adapters: [comboboxTargets({
    getTargets(host) {
      // An application-defined public component method; null declines opt-in.
      return host.getComboboxTargets?.() ?? null;
    },
  })],
});
referenceTarget.hydrate();
```

```js
// bootstrap.js — this provider contract is also needed with native Phase 1.
await import("./reference-target.setup.js");
await import("./app.js");
```

The selected setup stays behind an asynchronous readiness boundary, and `app.js` still initializes when imported. Do not skip this setup based on `hasNativeReferenceTarget()` alone. Other adapters selected in the same setup retain their normal native checks.

```html
<label for="city">City</label>
<input id="city" type="text" role="combobox" aria-autocomplete="list"
       aria-expanded="false" aria-controls="cities" aria-activedescendant="cities">
<x-cities id="cities">
  <!-- Real light-DOM content; the component may render it through a slot. -->
  <div id="city-options" role="listbox" aria-label="Cities" hidden>
    <div id="city-oslo" role="option" aria-selected="false">Oslo</div>
    <div id="city-tokyo" role="option" aria-selected="false">Tokyo</div>
  </div>
</x-cities>
```

The component's `getComboboxTargets()` returns `{ listbox, activeOption }`, where `activeOption` is an option element or `null`. The adapter accepts `input[type="text"]` and `input[type="search"]` with `role="combobox"` and a single host ID in `aria-controls`. The public host and listbox must be connected in the input's actual DOM tree; the listbox must be a descendant of that host with `role="listbox"` and a unique ID. An active option must have `role="option"`, a unique ID, and be a DOM descendant of that listbox. Private shadow descendants and hosts inside closed roots are not provider targets.

The adapter binds `aria-controls` to the supplied listbox ID. It manages `aria-activedescendant` only when its authored value is the same host ID: while expanded with a usable, visible active option, the value becomes that option's ID; otherwise the effective attribute is removed. An absent active-descendant attribute or a direct author-provided option reference is left alone. The adapter handles content attributes, not explicit `ariaControlsElements` or `ariaActiveDescendantElement` assignments.

The component owns rendering, filtering, `aria-expanded`, `aria-selected`, focus, keyboard and pointer interaction, and scrolling the active option into view. Call `referenceTarget.refresh()` synchronously after changes to the active option or popup state; DOM observation alone cannot meet the timing of every keyboard interaction. Keep the input focused while moving the active option. See the [combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) and [active-descendant requirements](https://w3c.github.io/aria/#aria-activedescendant).

No hidden option copies, private-node reflection, `aria-owns`, or `referenceTargetMap` API are supplied. This does not transparently repair a component whose only listbox/options live in a private shadow tree. Author replacements are respected, and disposal restores only attributes still owned by the adapter. Return `null` to withdraw the provider. To retire this bridge, change the component's public reference contract to direct native relationships or a future supported multi-target API, then remove its setup; Phase 1 support by itself is insufficient.

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
<button type="submit" form="profile" name="intent" value="save">Save</button>
<input type="reset" form="profile" value="Reset">
```

```js
// reference-target.setup.js — use the same conditional bootstrap shown above.
import { installReferenceTarget } from "./src/core.js";
import { formTargets } from "./src/adapters/form-targets.js";

export const referenceTarget = installReferenceTarget({ adapters: [formTargets()] });
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
  // Start asynchronous work only after this snapshot has been taken.
});
```

In fallback mode `event.submitter` is the temporary internal proxy, not the outside control; the proxy is briefly visible in the form's collection. Submit/reset events retain their native shadow boundaries rather than acquiring Reference Target's cross-root event path. Activation runs during click bubbling, so a later click listener cannot cancel an already performed form action; cancel submission in the form's own `submit` listener.

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

Call `referenceTarget.hydrate()` after that markup is available. It discovers open roots, including nested roots, and reads `data-reference-target`; it does not implement the declarative Shadow DOM parser. Call it again after changing this fallback metadata. Automatic discovery without hydration does not interpret the host metadata.

Imperative closed roots created after installation are captured by the wrapper. A preexisting closed root, including a declarative one, requires component cooperation and an actual root reference:

```js
const registration = referenceTarget.register(rootKnownToTheComponent, {
  referenceTarget: "control",
});

// When this component no longer participates:
registration.dispose();
```

The public installation handle does not expose a raw target resolver. Scripts must not rely on obtaining a private target through it. Native reflection, shadow-root cloning/serialization, full form ownership, `list`/`headers` association, and exact synchronous native mutation behavior are outside this implementation's scope. The optional form adapter covers submit/reset actions only.

## Examples

| Page | Selected adapters |
| --- | --- |
| [Demo gallery](http://127.0.0.1:4173/examples/) | Six adapters, with every demo on the page and additional reference-boundary comparisons. |
| [Labels](http://127.0.0.1:4173/examples/labels/) | `labels({ activation: "focus-and-click", naming: true })` only |
| [Popover targets](http://127.0.0.1:4173/examples/popover-targets/) | `popoverTargets()` only |
| [Dialog commands](http://127.0.0.1:4173/examples/dialog-commands/) | `dialogCommands()` only |
| [Popover commands](http://127.0.0.1:4173/examples/popover-commands/) | `popoverCommands()` only |
| [Text names and descriptions](http://127.0.0.1:4173/examples/text-names/) | `textNames({ getText })` only |
| [Form actions](http://127.0.0.1:4173/examples/forms/) | `formTargets()` only |
| [Original six-scenario companion](http://127.0.0.1:4173/examples/scenarios/) | Labels, popover targets, and text names for the retained declarative comparisons. |

The main page contains working examples for six adapters. Each demonstrated capability also has an independent page and bundle, allowing behavior and loading cost to be compared with only that adapter selected. The boundary comparisons use existing adapters.

The demos pair a short capability description with working controls and live observations. Browser details, behavior limits, and implementation notes are expandable; code samples and measured file sizes remain available on each page. Shared styles follow the system’s light or dark preference, including shadow-root controls and syntax highlighting, with no theme switch or additional JavaScript.

Every page supports `?mode=auto`, `?mode=fallback`, and `?mode=off`. Automatic mode loads its selected setup when the native surface is absent. Forced mode exercises the fallback; off mode loads no fallback and leaves native browser behavior available. Each mode still imports the application after selection. The observations report DOM state, not computed accessibility results.

The form demo keeps native inputs, a checkbox, and a select inside its declarative form. Outside Submit, Save draft (`formnovalidate`), and Reset buttons exercise validation, submitter data, and native defaults. Its component-local listeners cancel navigation, capture `FormData` synchronously, and display events and actual `.form` getters; the example sends no form data.

The retained six-scenario companion contains original examples inspired by [Microsoft Edge's Reference Target demos](https://microsoftedge.github.io/Demos/reference-target/). All six use parser-created Declarative Shadow DOM and retained `data-reference-target` metadata:

1. An external label activates an internal checkbox, with opt-in outward naming.
2. An external popover invoker targets an internal panel.
3. An external input references selected internal label text, approximated through the component's public text-provider contract.
4. A host's `aria-label` stays on the host; it is not copied to an inner button.
5. A host's `popovertarget` is not copied inward, and an inner string ID reference cannot look outward.
6. An explicit outward `popoverTargetElement` assignment connects an inner button to an outer popover using the browser's element-reflection capability, independently of Reference Target.

### Shared examples, separate builds

`examples/pages.js` is the build-time page catalog. The gallery and capability pages have HTML shells containing `<!-- demo:... -->` and bundle-size markers. The build expands these using `examples/shared/demos/*.html` and embeds the size reports in the resulting static HTML. The browser receives actual demo markup, including declarative shadow templates.

Application modules import only their selected `examples/shared/features/*.js` initializers. A page's `main.js` awaits its optional setup and then its application; the shared bootstrap imports no adapters. This lets the gallery reuse the same examples while each capability page retains its own adapter selection. The package API and application initialization contract are unchanged.

Code samples use [Microlighter](https://davatron5000.github.io/microlighter/) with its GitHub theme. It highlights HTML and JavaScript using the CSS Custom Highlight API without adding token elements to the samples. The build copies the pinned development dependency, required grammars, theme, and MIT license into a separate shared demo asset directory. Highlighting runs independently of application setup; browsers without that API keep readable plain-text samples. The highlighter is neither a polyfill dependency nor part of the size figures below.

## JavaScript sizes

The built pages show current JavaScript sizes, including the baseline, additional fallback, total with fallback, and individual emitted files. The gallery also compares the independent capability builds. Figures come from the build output, rather than hand-maintained estimates, and are also available in [the generated size manifest](http://127.0.0.1:4173/examples/bundle-sizes.json) at `dist/examples/bundle-sizes.json`.

| Measurement | Included JavaScript |
| --- | --- |
| Baseline ("Page JavaScript") | The bootstrap, application, selected demo initializers, and their shared dependencies, loaded even when the fallback is skipped. |
| "Fallback additional" | The selected setup, installer, adapters, and dependencies that are not already in the baseline. |
| Total with fallback | The union of baseline and fallback files. Each shared chunk is counted once. |

Sizes are shown in decimal KB (`1 KB = 1,000 bytes`). Raw figures measure emitted minified JavaScript; gzip figures sum the separately compressed size of each JavaScript file. They exclude Microlighter and its demo highlighting script/grammars, HTML, CSS, JSON, source maps, and HTTP headers. The local server can serve the measured JavaScript gzip sidecars, so its compressed bodies correspond to the reported per-file figures; browser caching and other servers' compression can change actual network transfer.

An independent capability's fallback cost includes the core installer and its required shared utilities. Adding the six independent costs does not predict the gallery's cost: the gallery shares code and is bundled as its own graph. Rebuild after changing a feature, selection, or build setting to regenerate the visible report and manifest.

## Run locally

Use Node.js 22 or newer (`.nvmrc` selects 24). Runtime modules use only browser APIs; esbuild and Microlighter are development dependencies for the examples.

```sh
npm install
npm start
npm test
npm run build:example
```

`npm start` builds the complete site through `prestart`, then serves the consumption guide at `/`, the gallery and capability pages under `/examples/`, and the [browser tests](http://127.0.0.1:4173/tests/browser.html). `/dist/examples/` is an alias for the same built output. Set `RT_PORT` to change the default port of 4173.

`npm run build:example` builds every cataloged page independently into `dist/examples`, including its capability subdirectories and the original scenarios companion. It generates the static demo HTML, current size reports, gzip JavaScript sidecars, `bundle-sizes.json`, and a combined esbuild dependency report in `dist/metafile.json`. Run it again after edits; the server does not automatically rebuild.

For source inspection, `/source/examples/` serves the original files and `/source/src/` maps their runtime imports. The gallery and capability source HTML are unexpanded templates, so those debug URLs are not the complete interactive pages. Use `/examples/` for the rendered demos and measured bundles.

The development server serves JavaScript gzip sidecars when the request accepts gzip, varies the response by `Accept-Encoding`, and disables caching so reloads reflect the current build. The size report counts compressed bodies rather than HTTP headers.

## GitHub Pages

`main` contains source, documentation, and build tools. `gh-pages` contains the generated static site, including the consumption guide, demo bundles, and browser-consumable ESM source. The site uses relative URLs so it works under the repository's `/reference-target-polyfill/` prefix.

```sh
npm run build:pages       # Build dist/site for inspection
npm run prepare:pages     # Rebuild and commit generated changes to local gh-pages
git push origin main gh-pages
```

The preparation command leaves the source checkout in place and preserves Pages history. GitHub Pages publishes from the root of `gh-pages`; CI validates source changes but does not publish npm packages or update that branch. See [the contribution guide](./CONTRIBUTING.md) for setup and maintenance.

## Validation

`npm test` runs Node checks for import behavior, API validation, and the bundles' dependency graphs; it does not launch a browser or screen reader. Use the browser harness and each page's loading modes to check activation, behavior, and conditional loading in the browsers you support.

Native-surface tests may be skipped where that API is absent; force-mode simulations do not establish native interoperability. Browser behavior and accessibility outcomes require browser and assistive-technology validation. No cross-browser conformance claim is made here.

Validation on 31 August 2026: **16 Node/package tests passed** and the Chromium 151 browser suite reported **98 passed, 0 failed, 1 skipped**. The skipped test needs a native Reference Target surface. The gallery tests cover all six individual pages, their shared gallery, conditional loading, interactions, displayed size/file reports, and separate syntax highlighting that preserves sample text and live form observations. Combobox adapter checks cover public relationships, ownership and cleanup, scope/privacy guards, and simulated native Phase 1 coexistence. Pages checks also cover project-relative links and branch preparation that preserves source work and publication history. The demos were checked in light and dark palettes at desktop and narrow widths. Firefox, Safari, and assistive-technology behavior remain unverified by this run.
