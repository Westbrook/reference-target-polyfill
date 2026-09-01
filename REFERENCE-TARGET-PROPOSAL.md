# Reference Target: research and fallback proposal

Research date: 31 August 2026. This document preserves the research and design rationale. A partial implementation is now available in this repository; see [README.md](./README.md) for its actual API, supported behaviors, and validation. The package is not published. Browser findings below come from release records, source code, specification changes, and checked-in test expectations; they are distinct from the implementation's own browser tests and do not establish assistive-technology conformance.

## Recommendation

Build a small synchronous shim with application-selected adapters. Conditionally import the selected setup module when the required native behavior is absent, await installation, then dynamically import the ordinary application module. This avoids downloading fallback code where the selected behavior is native while keeping application initialization unchanged. The package can route supported interactions and provide carefully scoped naming fallbacks. A transparent polyfill that reproduces native cross-shadow accessibility relationships, form ownership, and event dispatch is not achievable with the currently exposed JavaScript APIs. Chrome's own [feature assessment](https://chromestatus.com/feature/5188237101891584) identifies this polyfill limitation; its [public data](https://chromestatus.com/api/v0/features/5188237101891584) includes the detailed activation-risk assessment.

## Implementation status on 1 September 2026

The recommendations below led to the checked-in `0.1.0` prototype. This is a research record, so some later sections deliberately retain proposal tense and discuss ideas that are not public API. [README.md](./README.md) is the canonical current contract. In particular:

| Area | Implemented contract |
| --- | --- |
| Delivery | Side-effect-free ESM subpaths for `detect/surface`, full `detect`, `core`, and six opt-in adapters. TypeScript declarations ship for every public export. Built-in adapter descriptors are opaque; their privileged installation protocol is not a public custom-adapter API. |
| Loading | Statically import the tiny surface check, dynamically import the full probe only when a native surface exists, and load core plus selected adapters only when it does not. `modulepreload` can fetch the always-needed application in parallel without evaluating it before the setup barrier. The minified `browser/` distribution is the production no-bundler path; raw `src/` URLs are for debugging and evaluation. |
| Native routing | A detected native surface is `native-unverified`, not a conformance claim. Partial probe results are `unsupported`; the package does not combine fallback activation with a partial native implementation. `force` exists for tests, not production override. |
| Lifecycle | `hydrate(container)` discovers accessible pre-existing/open or declarative roots in that container with one traversal. `refresh()` initiates no scan, but first drains queued mutation records and any bounded added-subtree discovery they carry. `register()` is explicit cooperation for a root the caller already holds. `dispose()` clears owned state and transitions a live handle and its formerly active adapter statuses to `disposed`. |
| Updates | Relevant mutation records are coalesced and routed only to adapters that own those mutation types. Metadata removal clears a target only when hydration still owns that assignment. Provider/model and unobservable property changes require one explicit reconciliation after batching. |
| Privacy and telemetry | Providers and diagnostics receive public host/source metadata, never a resolved private target. Diagnostics are synchronous and have stable codes documented in the README; details may grow additively during `0.x`. |
| Forms and text | Form actions stay disabled until setup and application listeners are ready. Temporary submitter values are visible to code in the form's tree and require a shared trust boundary. Text proxies are visually hidden, not secret, and remain visible to same-tree code and accessibility computation. |

Executable minified composition budgets independently cap the surface entry, full detection, core, each core-plus-one-adapter path, and all public runtime modules in raw, gzip, and Brotli bytes. Generated browser and demo manifests report release-current files and functional JavaScript separately from complete-page transfer. These byte gates are not load-time or render/update benchmarks. Runtime claims require a recorded browser/device/fixture, cold and warm runs, 1/100/1,000-host fixtures where applicable, deterministic work counters, and separately reported median and p95 values.

## What the MDN request and its links establish

I reviewed all four substantive resources linked directly from [MDN issue #832](https://github.com/mdn/mdn/issues/832), as well as the relevant follow-on discussions, implementation records, and tests. The MDN issue has no comments and remains a placeholder; its statement that no browser ships the feature is now out of date.

| Directly linked resource | Significance for this proposal |
| --- | --- |
| [Reference Target explainer](https://github.com/WICG/webcomponents/blob/gh-pages/proposals/reference-target-explainer.md) | Describes the single-target first phase and broader future possibilities. `referenceTargetMap`, per-attribute targets, and exported-ID syntax must not be presented as Chrome 152 features. |
| [WICG tracking issue #1086](https://github.com/WICG/webcomponents/issues/1086) | Connects the design questions about invalid targets, naming, types, reflection, attribute scope, and event propagation. |
| [DOM PR #1353](https://github.com/whatwg/dom/pull/1353) | Defines nullable `ShadowRoot.referenceTarget`, its initialization option, and related shadow-root plumbing. Still open when inspected. |
| [HTML PR #10995](https://github.com/whatwg/html/pull/10995) | Connects reference resolution with HTML behavior, declarative parsing, reflection, forms, and events. Still open and under review when inspected; the current diff is more useful than older explainer examples for fine details. |

The linked design trail includes [invalid IDs #1071](https://github.com/WICG/webcomponents/issues/1071), [form/list getters #1072](https://github.com/WICG/webcomponents/issues/1072), [naming #1087](https://github.com/WICG/webcomponents/issues/1087), [nullable type #1093](https://github.com/WICG/webcomponents/issues/1093), [IDL-set references #1089](https://github.com/WICG/webcomponents/issues/1089), [attribute scope #1091](https://github.com/WICG/webcomponents/issues/1091), and [event propagation #1098](https://github.com/WICG/webcomponents/issues/1098). The later [reflection reconsideration #1114](https://github.com/WICG/webcomponents/issues/1114) is especially important: writable element-reference getters remain shallow, even when the effective internal target is invalid.

The [Cross-root ARIA Reflection proposal](https://github.com/Westbrook/cross-root-aria-reflection/blob/main/cross-root-aria-reflection.md) is historical design context with broader delegation ideas. [Export ID](https://github.com/WICG/aom/blob/gh-pages/exportid-explainer.md) explicitly says it has been replaced. [TPAC discussion](https://www.w3.org/2024/09/25-webcomponents-minutes.html) also explains the special concern around `aria-owns`. None of these is a reason to add speculative syntax to a first fallback release.

The associated [ARIA PR #2474](https://github.com/w3c/aria/pull/2474) remains a draft aligning terminology with HTML. The [WPT promotion PR #51213](https://github.com/web-platform-tests/wpt/pull/51213) also remains a draft; the relevant tests still reside in the [tentative Reference Target directory](https://github.com/web-platform-tests/wpt/tree/master/shadow-dom/reference-target/tentative). “Tentative” describes their standards status, not an absence of implementation testing.

## Browser status

| Engine | Verified position on 31 August 2026 |
| --- | --- |
| Chrome / Blink | Shipped in Chrome **152**, whose stable release date was **25 August 2026**. The release notes cover Android, ChromeOS, Linux, macOS, and Windows; ChromeStatus also records Android WebView milestone 152. [Release notes](https://developer.chrome.com/release-notes/152#reference_target_for_cross-root_aria), [feature data](https://chromestatus.com/api/v0/features/5188237101891584). |
| Firefox / Gecko | Substantial implementation behind `dom.shadowdom.referenceTarget.enabled`, which is **false by default**. Early work landed for milestone 144 and broader work for 149; these are implementation milestones, not default availability. [Preference source](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml), [tracker](https://bugzilla.mozilla.org/show_bug.cgi?id=1952585), [initial API](https://bugzilla.mozilla.org/show_bug.cgi?id=1981341), [label implementation](https://bugzilla.mozilla.org/show_bug.cgi?id=1981349). |
| Safari / WebKit | Implementation landed in February 2025, but `ShadowRootReferenceTargetEnabled` remains **testable, default false**. The proposed move to preview remains open. No confirmed default Safari release follows from those landings. [Landing](https://github.com/WebKit/WebKit/pull/39742), [preferences](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml), [preview PR](https://github.com/WebKit/WebKit/pull/46205). |

Chrome 152's tagged implementation has an important exception: `aria-owns` forwarding is separately gated and disabled. Do not interpret broad “all ID references” descriptions literally. I checked the [152.0.7977.64 runtime configuration](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/platform/runtime_enabled_features.json5) and the corresponding [element resolution code](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/dom/element.cc).

Gecko's remaining tracker dependencies include [accessibility cache/reverse-relation updates](https://bugzilla.mozilla.org/show_bug.cgi?id=1983819), [explicit-reference mutation notifications](https://bugzilla.mozilla.org/show_bug.cgi?id=1997286), and [labeled-descendant observation](https://bugzilla.mozilla.org/show_bug.cgi?id=2015796). A July 2026 [spec discussion](https://github.com/whatwg/html/pull/10995#issuecomment-4894261636) explicitly calls out missing `aria-labelledby` behavior in Gecko. Its test configuration enables the preference in CI, so CI results and a default Nightly browser can differ. [Test directory configuration](https://github.com/mozilla-firefox/firefox/blob/main/testing/web-platform/meta/shadow-dom/reference-target/tentative/__dir__.ini).

WebKit still declares a nonnullable string in [ShadowRoot.idl](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ShadowRoot.idl), whereas current Blink, Gecko, and the proposed DOM changes use a nullable string. Its [basic-test expectations](https://github.com/WebKit/WebKit/blob/main/LayoutTests/imported/w3c/web-platform-tests/shadow-dom/reference-target/tentative/reference-target-basics-expected.txt) record that mismatch. Other [form expectations](https://github.com/WebKit/WebKit/blob/main/LayoutTests/imported/w3c/web-platform-tests/shadow-dom/reference-target/tentative/form-expected.txt) show remaining gaps. These expectation files are evidence of known work, not fresh execution results.

Mozilla's [positive standards position](https://github.com/mozilla/standards-positions/issues/1035) and WebKit's [still-open position issue](https://github.com/WebKit/standards-positions/issues/356) should be distinguished from product availability. I found no committed Firefox or Safari shipping date in the inspected records.

## The native contract to target

The API has four related entry points: `attachShadow({ referenceTarget: "control", mode: "open" })`, mutable `root.referenceTarget`, the `shadowrootreferencetarget` template attribute, and `HTMLTemplateElement.shadowRootReferenceTarget`. It works with ordinary shadow hosts as well as custom elements, and with open or closed roots. [Chrome 152 ShadowRoot IDL](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/dom/shadow_root.idl), [initialization IDL](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/dom/shadow_root_init.idl), [template IDL](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/html/html_template_element.idl).

Resolve the original reference within the referring element's permitted scope, then follow each participating host's target ID within its own shadow tree. `null` stops forwarding at the host. An empty or missing target ID produces no effective target. Nested hosts can form a forwarding chain; duplicate IDs select the first match in tree order. These are live relationships. [HTML resolution change](https://github.com/whatwg/html/pull/10995/files), [Blink resolver](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/dom/element.cc).

References *to* a host are forwarded. Attributes *on* the host are not copied to its internal control. CSS selectors and `document.getElementById()` continue identifying the host. Merely placing a component inside a form does not make its enclosed input participate in that form. [Explainer](https://github.com/WICG/webcomponents/blob/gh-pages/proposals/reference-target-explainer.md), [Microsoft's native examples and non-goals](https://microsoftedge.github.io/Demos/reference-target/).

The browser uses an internal effective target while preserving public encapsulation. Writable ARIA element-reference getters and `commandForElement`/`popoverTargetElement` retain the host. Read-only `label.control`, `.list`, and `.form` first need a valid relationship and then return an appropriately retargeted host. A library should not replace those getters with ones exposing private shadow elements. [Reflection discussion](https://github.com/WICG/webcomponents/issues/1114), [label bindings](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/html/forms/html_label_element.cc), [input bindings](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.64/third_party/blink/renderer/core/html/forms/html_input_element.cc).

## What the fallback should promise

This table is an engineering recommendation derived from the platform constraints, not a statement of native conformance.

| Capability | Fallback approach | Practical limit |
| --- | --- | --- |
| Target configuration and nested lookup | Private root registry; exact ID lookup; resolve when used | Only registered roots and explicitly integrated operations participate. |
| External label activating an inner input | Component-owned focus/activation adapter; outward ARIA labeling where supported | Does not create native `label.control`, `input.labels`, or identical default-action behavior. |
| External name/description referencing inner text | Opt-in component text provider and a proxy in the source's tree | Plain-text naming approximation; not general accessible-name computation. |
| `commandfor` / `popovertarget` | Route supported actions to native dialog/popover methods | Event paths, source handling, default-action ordering, and accessibility links can differ. |
| Submit/reset invokers with `form="host"` | Opt-in `formTargets()` routes to an inner native form, using a temporary native submitter for submission | Validation and data come from the form's actual controls. The original external invoker does not acquire a native form owner; submitter identity and event paths differ. |
| `aria-owns`, arbitrary cross-root ARIA, rich details/relationships | Real accessible targets in light DOM, or a component designed around host semantics | No generic JavaScript repair for relationships to arbitrary internal accessible nodes. |
| `form` ownership | Form-associated custom-element integration or a real light-DOM control | Do not claim cross-root form ownership from event forwarding or hidden value mirrors. |
| `list` | Optional component-managed datalist copy in the input's tree | Copies suggestions; does not reproduce native target identity/reflection. |
| `headers`, `itemref`, interest behavior, serialization/cloning | Defer from the first version; use explicit feature-specific solutions | A general resolver alone does not modify these platform algorithms. |

The main blocker is that ordinary reflected element references can point within their tree or outward to an allowed ancestor tree; they do not provide a universal inward reference mechanism. Assigning `externalInput.ariaControlsElements = [privateListbox]` is therefore not a solution. Replacing that getter in JavaScript would not change what the accessibility engine consumes. [HTML reflection rules](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes).

`ElementInternals` can help a cooperating custom-element source, including engine-specific relaxed scope behavior, but cannot be attached to arbitrary native inputs/buttons or serve as a general access mechanism for another component's internals. Its authoring model also supplies defaults that author ARIA can override. Treat it as a separate, tested adapter. [Scope discussion](https://github.com/whatwg/html/issues/8544), [ElementInternals reflection tests](https://github.com/web-platform-tests/wpt/blob/master/custom-elements/element-internals-aria-element-reflection.html).

## Package and loading contract

The local package is named `reference-target-fallback`; it has not been published to npm. It provides a synchronous core and separate adapter entry points. The application selects its adapter modules through static imports inside one setup module, loaded according to the required capability. The bootstrap awaits that module before importing the application, which can initialize at module top level without exporting `start()`. Adapters retain native Reference Target syntax. The design discussion includes possible extensions; [README.md](./README.md) documents the implemented API.

```js
// reference-target.setup.js
import { installReferenceTarget } from "reference-target-fallback/core";
import { popoverTargets } from "reference-target-fallback/adapters/popover-targets";
import { dialogCommands } from "reference-target-fallback/adapters/dialog-commands";

export const referenceTarget = installReferenceTarget({
  adapters: [
    popoverTargets(),
    dialogCommands(),
  ],
});
```

```js
// main.js — client entry point; assumes native Shadow DOM is available.
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
    document.documentElement.dataset.referenceTargetSupport = "partial";
  }
}

// app.js runs its normal top-level initialization; it needs no exports.
await import("./app.js");
```

```html
<link rel="modulepreload" href="./app.js">
<script type="module" src="./main.js"></script>
```

The first dynamic import resolves after the setup module and its dependencies have evaluated, including the synchronous installation call. The application is imported only afterward. If setup ever starts asynchronous initialization, it must await that work at module top level, or expose a readiness promise that the bootstrap explicitly awaits. A detached promise does not extend module readiness. Import or installation failure prevents the subsequent application import. [Dynamic import semantics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import), [top-level await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#top_level_await).

Keep setup independent of the application module graph. Do not replace `await import("./app.js")` with a static `import "./app.js"` below the conditional: static imports are dependencies evaluated before the importing module's body. Likewise, sibling static imports of an asynchronous setup module and the application do not establish this barrier. No other script or import path should initialize the application earlier. The bootstrap can run ordinary application top-level code without a `startApplication()` refactor.

The fallback chunk includes the core, selected adapters, and their shared dependencies. Preserve that dynamic import boundary in the production build and avoid unconditional fallback preloads when avoiding its download is the goal. Do not statically import setup or its adapters from the application elsewhere; if application code needs the installation handle, pass it through a separate lightweight state/facade module rather than pulling setup back into its eager dependency graph. This also gives hot-module replacement one place to dispose the previous handle before installing another. The core does not import an all-adapters registry. Adapter modules and factories define behavior without installing listeners, observers, or patches during import; `installReferenceTarget()` performs those effects. The package exports adapter subpaths explicitly and marks only the example setup modules as side-effectful. [Package entry points](https://nodejs.org/api/packages.html#package-entry-points), [bundler tree shaking and side effects](https://webpack.js.org/guides/tree-shaking/).

A runtime option such as `features: { labels: true, dialogs: false }` does not guarantee a smaller bundle if the library imports every adapter anyway. Prefer passing imported adapter descriptors. A build-time generator could turn a list of feature names into the same static setup module, but it should not be required for the initial package. Verify the resulting production bundles instead of promising byte sizes before implementation.

| Implemented adapter entry point | Selected behavior | Shared dependencies or required policy |
| --- | --- | --- |
| `adapters/labels` | Supported external-label naming and activation approximations | Label policy selects focus/activation and handles existing form-associated behavior; naming has its own capability checks. |
| `adapters/popover-targets` | `popovertarget` actions | Shared activation dispatch and native popover operations. |
| `adapters/dialog-commands` | Supported dialog actions through `commandfor` | Shared command dispatch and native dialog operations. |
| `adapters/popover-commands` | Supported popover actions through `commandfor` | Reuses command dispatch and the same popover operations. |
| `adapters/text-names` | Opt-in plain-text approximation for inward `aria-labelledby` and `aria-describedby` | Component text providers and shared proxy/binding ownership utilities. |
| `adapters/form-targets` | Submit/reset activation referencing a host that exposes a native form | Native `requestSubmit()`/`reset()`, temporary submitter, authored overrides, and explicit limits around external control ownership. |

These are coherent behavior groups rather than a promise to implement every IDREF independently. An adapter named `aria-controls` or `aria-owns` must not imply that the unsolved accessibility relationship is available. Shared command and activation dispatch must enforce precedence and select one operation when a button has overlapping attributes; adapters cannot each independently activate it. Shared utilities are ordinary static imports, not a hidden dependency on every adapter.

`installReferenceTarget()` performs capability checks before changing anything, installs the wrapper once per realm, and activates the selected adapters synchronously before returning. Importing modules does not itself claim support. Where a native Reference Target surface exists, installation reports `native-unverified` and installs no patches or observers. API presence alone is insufficient for preview implementations: for example, an isolated label and ordinary shadow host with an inner input should make `label.control === host`, becoming `null` after an invalid target assignment. Check nullable setters and the specific selected behaviors as well. Writable ARIA getter roundtrips cannot prove forwarding. The implementation does not layer fallback activation over partially working native activation; it reports `unsupported`, leaving an application to choose an isolated structural fallback.

The wrapper calls the original `attachShadow()`, captures its returned root and initial target synchronously, and returns the real root immediately. This captures closed roots too. Install a root-instance accessor for later `referenceTarget` assignments without adding a misleading global signal to `ShadowRoot.prototype`. Roots with no configured target remain inert until a relevant assignment. Normalize `string | null` values deliberately, preserve native exceptions, and keep root references private. An async `attachShadow()` replacement is incompatible with native callers.

```js
// Component code remains native-shaped in either mode.
const root = this.attachShadow({
  mode: "closed",
  referenceTarget: "control",
});

// Rendering inserts the component's real control with id="control".
// Later updates use the native property too.
root.referenceTarget = "another-control";
```

The installation handle exposes truthful `mode`, `reason`, per-adapter `statuses`, `activeAdapters`, `register()`, `hydrate()`, `refresh()`, and `dispose()`. Its states distinguish `fallback`, `native-unverified`, `unsupported`, `inactive`, and `disposed`. Component hooks for label policies and text providers remain opt-in; selecting an adapter cannot supply an unknown component's semantics. Component callbacks never receive private elements belonging to another component further along a nested forwarding chain. Disposal removes owned subscriptions/proxies and restores patches only if they still belong to this installation. The core owns root lifecycle, target resolution, mutation batching, binding ownership, and service deduplication; optional services start only when selected adapters need them.

Adapter selection is complete before component construction and cannot be extended on a live handle. `register()` adds a root, not an adapter, and is not a way to recover missed interactions. Duplicate adapter IDs are rejected. The wrapper cannot recover previously-created inaccessible closed roots or intercept code calling a cached original method or another realm's prototype. Declarative roots still need the hydration contract below.

For removal, delete the capability check, conditional setup import, and setup module; the application can keep its dynamic import or become the direct module entry point. Components using native initialization and assignment remain unchanged. Component-specific structural fallbacks and declarative metadata have separate retirement paths. Eagerly bundling setup remains an alternative where avoiding the extra network boundary matters more than saving the selected fallback bytes in native browsers. In either deployment, `attachShadow()` itself remains synchronous.

The core lookup is small. This is internal pseudocode for the registered-root subset, not an exported DOM-piercing API:

```js
const registrations = new WeakMap(); // host -> { root, referenceTarget, ... }

function resolveRegisteredTarget(element) {
  const seen = new Set();
  while (element) {
    if (seen.has(element)) return null;
    seen.add(element);

    const entry = registrations.get(element);
    if (!entry || entry.referenceTarget === null) return element;
    if (entry.referenceTarget === "") return null;

    element = entry.root.getElementById(entry.referenceTarget);
  }
  return null;
}
```

Before calling this resolver, an adapter must obtain the original host correctly. Content IDREFs use the source's actual node tree, not a document-wide search and not the composed tree. Multi-ID attributes require ASCII-whitespace tokenization and order preservation. Explicit element references have their own allowed-scope rules; they cannot be reconstructed from the attribute string after a setter has cleared it. Bindings need a separate explicit-reference path. A root registration missing from the chain means the fallback cannot see that component's intended forwarding.

Resolve at activation time to handle synchronous ID/DOM changes. The implementation observes participating roots and source trees where bindings change; a document observer cannot see through shadow roots. Mutation interests are declared by adapters, unrelated records are ignored, and affected adapters reconcile after coalescing. `refresh()` initiates no unconditional document/root scan, but synchronously drains already-queued records and their bounded added-subtree discovery; `hydrate(container)` deliberately performs one supplied-container traversal. Observer callbacks cannot provide all native synchronous behavior. Avoid intercepting every DOM mutation method in an attempt to hide that difference.

## How the adapters work

For labels, resolve the participating control, then let the component select the correct focus and activation operation. When the label is in a permitted ancestor tree, `innerControl.ariaLabelledByElements = externalLabels` can provide the name because this reference points outward. Merge intentionally with authored/internal labels and respect name precedence. This requires its own updates and does not recreate native label association. Interactive descendants, canceled events, disabled/inert controls, reentrancy, clicks already coming from the target, and existing FACE behavior all need explicit handling. A document capture listener calling `.click()` before later handlers can cancel is insufficient. [Native label behavior](https://html.spec.whatwg.org/multipage/forms.html#the-label-element).

For inward text references, require an explicit component text provider, rather than blindly reading `textContent`. Allocate a hidden text proxy with a unique ID in the referring element's own tree, and bind the source's name/description to it. Preserve reference ordering and the original binding mode: an attribute string or an explicitly assigned element-reference list. Track subsequent author changes and restore only values still owned by the adapter. Restoring attributes alone loses relationships originally assigned through IDL setters. Updating only `aria-label` while leaving an effective `aria-labelledby` does not override the latter. Accessible names can depend on alternate text, embedded values, slots, hidden content, and CSS; generic copying loses those rules. [Accessible Name and Description Computation](https://w3c.github.io/accname/).

For dialogs/popovers, route a supported command to `showModal()`, `close()`, `requestClose()`, or the native popover methods as appropriate and available. Use `showPopover({ source: invoker })`/the supported toggle equivalent when available to retain native invoker behavior. Preserve cancelability and distinguish `close` from `request-close`; do not make arbitrary commands mean “toggle.” Unsupported underlying dialog/popover APIs need separate fallbacks. Native methods are preferable to just toggling attributes because top-layer and focus behavior matter. The adapter still cannot promise exact trusted events, event paths, or default-action ordering. [Popover algorithms](https://html.spec.whatwg.org/multipage/popover.html#dom-showpopover), [Reference Target event tests](https://github.com/web-platform-tests/wpt/blob/master/shadow-dom/reference-target/tentative/event-path.html).

For actual accessible relationships, prefer a structural fallback. A real input or listbox option can remain in light DOM and be rendered through a slot; references within its actual tree then remain native. Alternatively, design the host as the semantic control and implement its role, state, keyboard, and form behavior coherently. These choices require component cooperation and may change the authoring contract. A hidden clone of an active option cannot generally stand in for the real accessible node.

## Declarative Shadow DOM requires an explicit server contract

A browser can support declarative shadow DOM while ignoring `shadowrootreferencetarget`. Its parser consumes the template, leaving no template for a late script to scan for that unknown attribute. Patching `attachShadow()` does not intercept the parser's internal operation. [Template parsing behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template#declarative_shadow_dom).

Either register the target ID from component code during hydration or emit surviving metadata, such as:

```html
<x-field data-reference-target="control">
  <template shadowrootmode="open" shadowrootreferencetarget="control">
    <input id="control">
  </template>
</x-field>
```

`data-reference-target` is a proposed library convention, not a platform attribute. An open root can be registered using that metadata. A closed root still needs the component to provide its saved root or its own `ElementInternals.shadowRoot` where available. Reattaching just to retrieve a declarative root can clear its contents. If declarative shadow DOM itself is unsupported, that requires a separate hydration strategy. [ElementInternals shadow-root access](https://html.spec.whatwg.org/multipage/custom-elements.html#dom-elementinternals-shadowroot), [attachShadow behavior](https://dom.spec.whatwg.org/#dom-element-attachshadow).

## Validation and documentation contract

Extend the existing brief MDN entries rather than assuming there is no documentation: the [template page](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template#shadowrootreferencetarget) already mentions the attribute, and [mdn/content #43453](https://github.com/mdn/content/issues/43453) tracks the API documentation and compatibility work. Document the four native entry points, direction of forwarding, null/invalid semantics, observable getters, live updates, supported relations, and the difference between flags and default support. The dialog sample in issue #832 needs an actual action, for example `command="show-modal"`, as well as a visible button label; `commandfor` alone does not identify a dialog action.

Use the upstream WPT scenarios as behavioral requirements, while publishing a separate fallback support matrix. Cover nested roots, missing/empty/null targets, duplicate and changing IDs, content versus explicit-element references, cancellation, implicit labels, FACE interactions, and teardown. Native DSD, already-created closed roots, cloning/serialization, and different realms need explicit expectations. Run each adapter with native support absent and compare with Chrome 152. Independently inspect accessible names and real relationships using browser accessibility tooling and screen readers; DOM getter assertions cannot establish accessibility parity.

The implementation covers registration/resolution, selected label interactions, dialog/popover actions, opt-in plain-text names/descriptions, and submit/reset actions referencing an inner native form. The [current README](./README.md) documents all six adapters and their limits. Arbitrary private cross-shadow active-descendant, ownership, and full native form association remain outside its scope.
