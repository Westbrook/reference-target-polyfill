# Contributing

Thanks for helping improve `reference-target-fallback`.

## Set up the repository

Use Node.js 24.15 or newer on the 24.x line, or Node.js 22.22.3 or newer on the 22.x line. The repository's `.nvmrc` selects Node.js 24. These versions are contributor-tooling requirements (including Angular 22); the browser package does not require Node.js at runtime.

```bash
npm ci
```

Useful commands:

```bash
npm start                 # build and serve the local gallery
npm test                  # Node-based API, package, and size checks
npm run test:browser      # Chromium integration checks
npm run test:browser:firefox
npm run build:browser     # optimized no-bundler browser modules
npm run build:example     # bundled functional demo
npm run build:pages       # generated gallery site
npm run check             # release-oriented test/build/pack checks
```

## Documentation ownership

- `README.md` is the canonical consumer API and setup guide.
- `docs/index.html` is the deployed guide and should agree with the README.
- `REFERENCE-TARGET-PROPOSAL.md` records dated design rationale and the delta from the standards proposal. It is not a substitute for the current API reference.
- Demo pages should explain only behavior they actually exercise.

Keep API names, status values, import paths, compatibility claims, and lifecycle semantics synchronized across those surfaces. Links intended to work from an installed package must use absolute repository or deployed-site URLs when their targets are not included in the package.

## Runtime and API changes

Preserve the library's opt-in, side-effect-free design: applications explicitly select adapters, install the fallback in a realm, and dispose the returned handle. Closed shadow-root privacy is a boundary, not a discovery problem to work around.

Runtime changes should preserve these performance properties and cover them with tests:

- `hydrate()` scans one pre-existing or declarative-shadow-DOM container once.
- `refresh()` initiates no unconditional scan; it drains queued mutation records (including their bounded added-subtree discovery) before reconciling state.
- Irrelevant mutations do not run adapter work, and related records are coalesced.
- Action-only configurations do not start naming services; failed or unselected adapters do not leave services active.
- Repeated discovery is identity-deduplicated.
- `dispose()` disconnects observers, listeners, and services and clears owned runtime state.

Test difficult DOM transitions as applicable: ID changes, moves between trees, nested managed roots, metadata removal, property writes, repeated hydration, removal and reinsertion, and disposal.

Keep TypeScript declarations synchronized with the runtime. Add strict positive tests and focused `@ts-expect-error` cases for changed public contracts. Built-in adapter descriptors are opaque implementation details, and the package currently exports no custom-adapter protocol; do not forge descriptors or document the privileged runtime context as public API.

New diagnostics should be stable enough for telemetry, have a migration note when replacing an older signal, and avoid exposing private target nodes to callbacks or providers. Review callback and provider changes for reentrancy.

## Demos, forms, and safe examples

Edit source files under `examples/`; do not edit generated `dist/` output. Each renderer has a different source path and compiler pipeline, so run the applicable renderer and gallery tests after changes.

Shared demo markup lives in `examples/shared/demos/`, feature initialization in `examples/shared/features/`, and page selections in `examples/pages.js`. Renderer sources live in `examples/lit/`, `examples/fast/`, `examples/stencil/`, `examples/preact/`, `examples/vue/`, `examples/svelte/`, and `examples/angular/`; their shared case and observation controls live in `examples/shared/demos/renderer.html` and `examples/shared/renderer-demo.js`. Keep framework imports inside each renderer's application boundary and compilers out of browser bundles. Preserve documented framework lifecycle limits instead of bypassing normal cleanup.

Form demos must keep actions disabled until fallback setup and application submit handling are ready. Do not log complete `FormData`, credentials, tokens, or other sensitive values. Proxy controls are observable to code in the same tree and must not be described as a secrecy boundary.

Accessibility checks for docs and demos include:

- focusable overflow regions have an accessible name;
- skip-link targets receive visible focus;
- decorative arrows are hidden from assistive technology;
- controls work by keyboard and retain clear labels, focus, and live status text.

## Size and performance review

Run the production builds and compare the generated manifests and checked-in package size budgets before and after runtime changes. `tests/package-sizes.test.js` is authoritative for per-composition raw, gzip, and Brotli caps. The generated browser and gallery manifests report release-current files and functional bundles rather than hand-maintained prose estimates. If a change raises an executable cap, explain the user-visible benefit in the pull request rather than hiding the increase in a regenerated artifact.

Report functional JavaScript separately from the full documentation page. Full-page transfer includes the guide shell, demo UI, renderer runtime, and optional syntax highlighting; those bytes are not all required by an application using the fallback. Also check request count: the automatic native-surface route must not fetch fallback implementation modules.

For runtime measurements, record the browser, version, device, operating system, adapter set, DOM shape, and warm-up/sample counts. Measure representative 1-, 100-, and 1,000-element roots where useful. Report distributions such as p50 and p95, and pair timings with deterministic counters (adapter checks, scans, observer deliveries, and service starts). Do not publish synthetic timing claims as universal guarantees.

## Browser and accessibility validation

After building the gallery, run the automated browser suites and manually inspect `/tests/browser.html` when behavior is visual or timing-sensitive. Exercise both fallback-forced and automatic/native modes, and record the exact browser metadata for compatibility findings.

For accessibility-sensitive behavior, include the assistive technology, browser, operating system, input modality, and observed accessible-name/action result. A visual screenshot alone does not validate the accessibility tree.

## Versions, migration, and releases

The project is pre-1.0. Consumers should pin an exact version or reviewed commit. Any change to imports, statuses, diagnostics, lifecycle behavior, adapter selection, or native-retirement policy needs an explicit migration note.

Hot-module replacement must dispose the previous setup before installing another one; pass the current handle explicitly across dynamically loaded setup code instead of relying on module evaluation order. When browsers ship verified native behavior, retire only the matching adapter and keep unrelated fallback capabilities independently selectable.

Before publishing, verify the packed file list, declaration resolution, exports from a clean consumer project, version/tag consistency, build provenance, generated browser manifest, and release checklist. `npm pack --dry-run` is necessary but not sufficient.

## Publishing the site

The `main` branch contains source and the `gh-pages` branch contains only the generated site. To preview locally, run `npm start`; set a different port with `RT_PORT=4187 npm start` when needed.

After committing source changes, prepare and explicitly publish the generated branch:

```bash
npm run prepare:pages
git push origin main gh-pages
```

The preparation command rebuilds `dist/site`, creates a local `gh-pages` commit only when contents changed, and does not switch or clean the source checkout. Review the generated site before pushing. A fork should configure GitHub Pages to deploy from `gh-pages` at the repository root. CI validates changes but does not publish packages or silently update the Pages branch.

Never commit secrets or local credentials. Use the repository's normal review process for changes to workflows, package publishing, or deployed assets.
