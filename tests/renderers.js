const examplesURL = new URL("../examples/", import.meta.url);
const renderers = [
  { id: "lit", title: "Lit" },
  { id: "fast", title: "FAST" },
  { id: "stencil", title: "Stencil" },
  { id: "preact", title: "Preact" },
  { id: "vue", title: "Vue" },
  { id: "svelte", title: "Svelte" },
  // The default Angular Elements strategy does not support reusing a host
  // after its disconnected component has been destroyed.
  { id: "angular", title: "Angular Elements", supportsReconnection: false },
];

/** Exercise the generated pages with each library's actual renderer. */
export function registerRendererTests({ test, assert, equal, requirePrimitive, captureAsynchronousErrors }) {
  const nextTask = page => new Promise(resolve => page.realm.setTimeout(resolve, 0));
  const hasPopovers = realm => typeof realm.HTMLElement.prototype.showPopover === "function"
    && typeof realm.HTMLElement.prototype.hidePopover === "function";

  function waitFor(page, predicate, message) {
    return new Promise((resolve, reject) => {
      const observed = new WeakSet();
      const observer = new page.realm.MutationObserver(check);
      const timer = setTimeout(() => finish(new Error(message)), 10000);
      let finished = false;
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        observer.disconnect();
        if (error) reject(error);
        else resolve();
      }
      function observe(root) {
        if (!observed.has(root)) {
          observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
          observed.add(root);
        }
        for (const host of root.querySelectorAll("*")) {
          if (host.shadowRoot) observe(host.shadowRoot);
        }
      }
      function check() {
        try {
          // Document observers do not enter shadow roots. Watch the actual
          // renderer output too, including roots discovered after a mutation.
          observe(page.document);
          if (predicate()) finish();
        } catch (error) { finish(error); }
      }
      check();
    });
  }

  async function loadPage(fixture, renderer, requestedMode = "fallback") {
    const url = new URL(`${renderer.id}/`, examplesURL);
    url.searchParams.set("mode", requestedMode);
    const frame = document.createElement("iframe");
    frame.title = `Built ${renderer.title} renderer: ${requestedMode}`;
    frame.src = url.href;
    const page = await new Promise((resolve, reject) => {
      let observer;
      let finished = false;
      const timer = setTimeout(() => finish(new Error(`Renderer did not become ready: ${url.pathname} (${requestedMode})`)), 10000);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        observer?.disconnect();
        frame.removeEventListener("load", loaded);
        frame.removeEventListener("error", failed);
        if (error) reject(error);
        else resolve({ frame, realm: frame.contentWindow, document: frame.contentDocument });
      }
      function failed() { finish(new Error(`Could not load renderer page: ${url.pathname}`)); }
      function check() {
        const document = frame.contentDocument;
        const state = document.documentElement.dataset;
        if (state.referenceTargetReady === "error" || state.referenceTargetMode === "error") {
          finish(new Error(`Renderer setup failed: ${document.getElementById("load-error")?.textContent}`));
        } else if (state.referenceTargetReady === "true") {
          finish();
        }
      }
      function loaded() {
        if (frame.contentWindow.location.pathname !== url.pathname) return;
        captureAsynchronousErrors(frame.contentWindow);
        observer?.disconnect();
        observer = new frame.contentWindow.MutationObserver(check);
        observer.observe(frame.contentDocument.documentElement, {
          attributes: true,
          attributeFilter: ["data-reference-target-ready", "data-reference-target-mode"],
        });
        check();
      }
      frame.addEventListener("load", loaded);
      frame.addEventListener("error", failed);
      fixture.append(frame);
    });
    const state = page.document.documentElement.dataset;
    const nativeSurface = "referenceTarget" in page.realm.ShadowRoot.prototype;
    const expectedMode = requestedMode === "auto"
      ? (nativeSurface ? "native-unverified" : "fallback") : requestedMode;
    equal(state.referenceTargetRequestedMode, requestedMode);
    equal(state.referenceTargetMode, expectedMode);
    equal(state.referenceTargetReady, "true");
    equal(state.referenceTargetSurface, String(nativeSurface));
    equal(state.bundlePath, expectedMode === "fallback" ? "total" : "baseline");
    const selected = expectedMode === "fallback"
      ? ["labels", ...(hasPopovers(page.realm) ? ["popover-targets"] : [])] : [];
    equal(state.referenceTargetAdapters.split(",").filter(Boolean).sort().join(","), selected.sort().join(","));
    if (expectedMode === "fallback") {
      const statuses = JSON.parse(state.referenceTargetAdapterStatuses);
      equal(Object.keys(statuses).sort().join(","), "labels,popover-targets", "The renderer installs only its two selected adapters");
    }
    assert(page.document.getElementById("ready-status")?.textContent.includes("Ready"));
    equal(page.document.querySelectorAll("iframe").length, 0, "Renderer examples run in their own standalone page");
    for (const [kind, target] of [["checkbox", "control"], ["popover", "panel"]]) {
      const host = page.document.getElementById(`renderer-${kind}`);
      equal(host?.localName, `rt-${renderer.id}-${kind}`);
      assert(host.shadowRoot?.getElementById(target), `Readiness must include the first ${renderer.title} ${kind} render`);
    }
    assert(!control(page).disabled, "The rendered checkbox is usable in every loading mode");
    return page;
  }

  function checkbox(page) { return page.document.getElementById("renderer-checkbox"); }
  function control(page) { return checkbox(page).shadowRoot.getElementById("control"); }
  function observation(page, { checked, replacements, changes }) {
    const output = page.document.getElementById("renderer-checkbox-observation")?.textContent ?? "";
    return output.includes(`checked: ${checked}`)
      && new RegExp(`replacements: ${replacements}\\b`).test(output)
      && new RegExp(`changes: ${changes}\\b`).test(output);
  }

  async function checkActivation(page, replacements, changes, activate) {
    const input = control(page);
    const checked = !input.checked;
    let clicks = 0;
    let changeEvents = 0;
    const onClick = () => clicks++;
    const onChange = () => changeEvents++;
    input.addEventListener("click", onClick);
    input.addEventListener("change", onChange);
    try {
      activate();
      equal(input.checked, checked);
      await waitFor(page, () => observation(page, { checked, replacements, changes }), "The renderer did not report the checkbox change");
      await nextTask(page);
      equal(clicks, 1, "One activation produces one internal click");
      equal(changeEvents, 1, "One activation produces one native change event");
      equal(input.checked, checked, "A pending renderer update must not undo the checkbox change");
    } finally {
      input.removeEventListener("click", onClick);
      input.removeEventListener("change", onChange);
    }
  }

  function checkNoFallback(page, { nativeProbe = false } = {}) {
    const state = page.document.documentElement.dataset;
    equal(state.referenceTargetAdapters, "");
    equal(state.bundlePath, "baseline");
    assert(/\[native code\]/.test(page.realm.Function.prototype.toString.call(page.realm.Element.prototype.attachShadow)),
      "A browser-only load must preserve native attachShadow");
    const fallbackFiles = [...page.document.querySelectorAll("[data-file-path][data-delivery='fallback']")];
    assert(fallbackFiles.length > 0, "The generated size report identifies the optional fallback artifacts");
    const fetched = new Set(page.realm.performance.getEntriesByType("resource").map(entry => entry.name));
    for (const row of fallbackFiles) {
      assert(!fetched.has(new URL(row.dataset.filePath, examplesURL).href), `Browser-only mode fetched fallback artifact ${row.dataset.filePath}`);
    }
    const probeFiles = [...page.document.querySelectorAll("[data-file-path][data-delivery='native-probe']")];
    assert(probeFiles.length > 0, "The generated size report identifies the conditional native probe");
    for (const row of probeFiles) {
      const wasFetched = fetched.has(new URL(row.dataset.filePath, examplesURL).href);
      equal(wasFetched, nativeProbe,
        `${nativeProbe ? "Native-unverified" : "Off"} mode ${nativeProbe ? "fetches" : "omits"} ${row.dataset.filePath}`);
    }
    const routeSharedFiles = [...page.document.querySelectorAll("[data-file-path][data-delivery='route-shared']")];
    assert(routeSharedFiles.length > 0, "The generated size report identifies probe/fallback shared chunks");
    for (const row of routeSharedFiles) {
      const wasFetched = fetched.has(new URL(row.dataset.filePath, examplesURL).href);
      equal(wasFetched, nativeProbe,
        `${nativeProbe ? "Native-unverified" : "Off"} mode ${nativeProbe ? "fetches" : "omits"} ${row.dataset.filePath}`);
    }
  }

  for (const renderer of renderers) {
    const supportsReconnection = renderer.supportsReconnection !== false;
    const labelBehavior = `labels activate once after two replacements${supportsReconnection ? " and reconnection" : ""}`;
    test(`Built ${renderer.title} renderer: ${labelBehavior}`, async ({ fixture }) => {
      const page = await loadPage(fixture, renderer);
      const host = checkbox(page);
      const label = page.document.getElementById("renderer-label");
      const replace = page.document.getElementById("renderer-replace");
      equal(host.shadowRoot.referenceTarget, "control");
      equal(label?.htmlFor, host.id);
      assert(replace && !replace.disabled);
      equal(control(page).type, "checkbox");
      assert(observation(page, { checked: false, replacements: 0, changes: 0 }));
      await checkActivation(page, 0, 1, () => label.click());

      const previousInputs = [];
      for (const revision of [1, 2]) {
        const previous = control(page);
        previousInputs.push(previous);
        replace.click();
        await waitFor(page, () => control(page) && control(page) !== previous
          && observation(page, { checked: false, replacements: revision, changes: revision }),
        `${renderer.title} did not replace its native input at revision ${revision}`);
        equal(host.getAttribute("revision"), String(revision));
        assert(!previous.isConnected, "The previous native control must actually leave the DOM");
        equal(control(page).checked, false, "A replacement starts with a new unchecked native input");
        await checkActivation(page, revision, revision + 1, () => label.click());
        for (const oldInput of previousInputs) {
          equal(oldInput.checked, true, "Label activation must leave detached inputs untouched");
        }
      }

      if (!supportsReconnection) return;
      // Let the disconnected callback run, change an observed attribute while
      // detached, and then check that reconnection renders and forwards again.
      const previous = control(page);
      const position = page.document.createComment("renderer reconnect position");
      host.before(position);
      host.remove();
      host.setAttribute("revision", "3");
      await nextTask(page);
      position.replaceWith(host);
      await waitFor(page, () => control(page) && control(page) !== previous && control(page).isConnected
        && observation(page, { checked: false, replacements: 3, changes: 3 }),
      `${renderer.title} did not render its changed attribute after reconnection`);
      await checkActivation(page, 3, 4, () => label.click());
    });

    const popoverBehavior = supportsReconnection
      ? "external targets and internal popover controls survive reconnection"
      : "external targets and internal controls open and close its native popover";
    test(`Built ${renderer.title} renderer: ${popoverBehavior}`, async ({ fixture }) => {
      requirePrimitive(hasPopovers(window), "Popover primitives unavailable");
      const page = await loadPage(fixture, renderer);
      const host = page.document.getElementById("renderer-popover");
      const root = host.shadowRoot;
      const panel = root.getElementById("panel");
      const show = page.document.getElementById("renderer-open");
      const hide = page.document.getElementById("renderer-hide");
      const output = page.document.getElementById("renderer-popover-observation");
      async function openCurrentPanel() {
        const current = root.getElementById("panel");
        show.click();
        assert(current.matches(":popover-open"));
        await waitFor(page, () => output.textContent.includes("popover: open"),
          "The renderer did not report the current native popover opening");
      }
      async function closeCurrentPanel() {
        const current = root.getElementById("panel");
        const close = current.querySelector("button");
        assert(close && !close.disabled);
        equal(close.type, "button");
        equal(close.getAttribute("popovertarget"), "panel");
        equal(close.getAttribute("popovertargetaction"), "hide");
        close.click();
        assert(!current.matches(":popover-open"));
        await waitFor(page, () => output.textContent.includes("popover: closed"),
          "The renderer did not report its internal button closing the current popover");
      }
      equal(root.referenceTarget, "panel");
      assert(panel.hasAttribute("popover"));
      assert(show && hide && !show.disabled && !hide.disabled);
      assert(!panel.matches(":popover-open"));
      await openCurrentPanel();
      hide.click();
      assert(!panel.matches(":popover-open"));
      await waitFor(page, () => output.textContent.includes("popover: closed"),
        "The renderer did not report the native popover closing");
      await openCurrentPanel();
      await closeCurrentPanel();

      if (!supportsReconnection) return;
      const position = page.document.createComment("popover reconnect position");
      host.before(position);
      host.remove();
      await nextTask(page);
      position.replaceWith(host);
      await waitFor(page, () => root.getElementById("panel")?.isConnected,
        `${renderer.title} did not render its popover after reconnection`);
      if (renderer.id === "preact") {
        assert(root.getElementById("panel") !== panel, "Preact unmounts and recreates its popover on reconnection");
      }
      await openCurrentPanel();
      await closeCurrentPanel();
    });

    test(`Built ${renderer.title} renderer: off mode renders and updates without fetching or installing the fallback`, async ({ fixture }) => {
      const page = await loadPage(fixture, renderer, "off");
      checkNoFallback(page);
      await checkActivation(page, 0, 1, () => control(page).click());
      const previous = control(page);
      checkbox(page).setAttribute("revision", "1");
      await waitFor(page, () => control(page) && control(page) !== previous
        && observation(page, { checked: false, replacements: 1, changes: 1 }),
      `${renderer.title} did not respond to an attribute update in off mode`);
      assert(!previous.isConnected);
      await checkActivation(page, 1, 2, () => control(page).click());
      checkNoFallback(page);
    });

    test(`Built ${renderer.title} renderer: auto mode selects a load path and finishes its first render`, async ({ fixture }) => {
      const page = await loadPage(fixture, renderer, "auto");
      await checkActivation(page, 0, 1, () => control(page).click());
      if (page.document.documentElement.dataset.referenceTargetMode === "native-unverified") {
        checkNoFallback(page, { nativeProbe: true });
      }
      // This checks initialization and ordinary input behavior. API detection
      // alone is not proof of native forwarding or assistive-technology output.
    });
  }
}
