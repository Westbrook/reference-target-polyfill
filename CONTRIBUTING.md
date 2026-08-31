# Contributing

Use Node.js 22 or newer; `.nvmrc` selects Node.js 24. Install development
dependencies with `npm ci`.

```sh
npm start                 # Build and serve the demos on port 4173
npm test                  # Node/package and build-tool checks
npm run build:pages       # Generate the complete static site in dist/site
npm run check             # Tests, Pages build, and package-content preview
```

Open `/tests/browser.html` on the local server for the browser suite. Check
affected demos with automatic loading, forced fallback, and fallback off.
Browser and assistive-technology validation are separate from Node tests.
Use `RT_PORT=4187 npm start` to choose another port.

Runtime modules live in `src/`. Keep adapter imports opt-in and installation
behind the asynchronous setup boundary. Importing a package module must not
patch the browser. Preserve closed-root privacy and document limitations rather
than implying full native equivalence.

Edit shared demo content in `examples/shared/demos/`, behavior in
`examples/shared/features/`, and page selections in `examples/pages.js`.
Consumption documentation lives in `docs/`. Builds regenerate the displayed
sizes; do not edit `dist/` by hand or commit it to `main`.

Renderer examples live in `examples/lit/`, `examples/fast/`, `examples/stencil/`,
and `examples/preact/`. Their shared cases are in `examples/shared/demos/renderer.html`
and observation controls in `examples/shared/renderer-demo.js`. Keep framework
imports inside each renderer’s application boundary. The build and package tests
compile Stencil’s TSX into `dist/stencil` before bundling its custom elements;
Stencil’s generated `src/components.d.ts` is ignored. Browser tests cover initial
rendering, target replacement, reconnection, popovers, and the three loading modes.

## Publishing the site

The `main` branch contains source. The `gh-pages` branch contains only the
generated site and is the GitHub Pages publishing source at `/`.

After committing source changes:

```sh
npm run prepare:pages
git push origin main gh-pages
```

The preparation command rebuilds `dist/site` and creates a local commit on
`gh-pages` only if its contents changed. It preserves publication history and
does not switch or clean your source checkout. Push explicitly after reviewing
the generated site. Configure **Settings → Pages → Deploy from a branch →
gh-pages → /(root)** when setting up a fork.

CI checks pull requests and pushes to `main`; it does not publish packages or
silently update the Pages branch. GitHub publishes the site when a maintainer
pushes the prepared `gh-pages` branch.
