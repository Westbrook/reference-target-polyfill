const galleryURL = new URL("../examples/", import.meta.url);
const capabilities = [
  { id: "labels", directory: "labels" },
  { id: "popover-targets", directory: "popover-targets" },
  { id: "dialog-commands", directory: "dialog-commands" },
  { id: "popover-commands", directory: "popover-commands" },
  { id: "text-names", directory: "text-names" },
  { id: "form-targets", directory: "forms" },
];

/** Integration tests use generated pages and their real module entry points. */
export function registerGalleryTests({ test, assert, equal, requirePrimitive }) {
  let manifestPromise;

  function requireDSD() {
    requirePrimitive("shadowRootMode" in HTMLTemplateElement.prototype, "Declarative shadow DOM unavailable");
  }

  function requirePopovers() {
    requirePrimitive(typeof HTMLElement.prototype.showPopover === "function", "Popover primitives unavailable");
  }

  function requireDialogs() {
    requirePrimitive(typeof HTMLDialogElement?.prototype.showModal === "function", "Dialog primitives unavailable");
  }

  function requireForms() {
    requirePrimitive(typeof HTMLFormElement.prototype.requestSubmit === "function", "requestSubmit primitive unavailable");
  }

  function waitFor(document, predicate, message) {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => finish(new Error(message)), 8000);
      function finish(error) {
        clearTimeout(timer);
        observer.disconnect();
        if (error) reject(error);
        else resolve();
      }
      function check() {
        try { if (predicate()) finish(); } catch (error) { finish(error); }
      }
      observer.observe(document.documentElement, {
        attributes: true, childList: true, characterData: true, subtree: true,
      });
      check();
    });
  }

  async function loadPage(fixture, directory = "", mode = "fallback") {
    requireDSD();
    const url = new URL(directory ? `${directory}/` : "", galleryURL);
    url.searchParams.set("mode", mode);
    const frame = document.createElement("iframe");
    frame.title = `Built gallery ${directory || "all"}: ${mode}`;
    frame.src = url.href;
    const page = await new Promise((resolve, reject) => {
      let observer;
      const timer = setTimeout(() => finish(new Error(`Built gallery did not become ready: ${url.pathname} (${mode})`)), 10000);
      function finish(error) {
        clearTimeout(timer);
        observer?.disconnect();
        frame.removeEventListener("load", loaded);
        frame.removeEventListener("error", failed);
        if (error) reject(error);
        else resolve({ frame, realm: frame.contentWindow, document: frame.contentDocument });
      }
      function failed() { finish(new Error(`Could not load built gallery page: ${url.pathname}`)); }
      function check() {
        const document = frame.contentDocument;
        const state = document.documentElement.dataset;
        if (state.referenceTargetMode === "error" || state.referenceTargetReady === "error") {
          finish(new Error(`Gallery setup failed: ${document.getElementById("load-error")?.textContent}`));
        } else if (state.referenceTargetReady === "true") {
          finish();
        }
      }
      function loaded() {
        if (frame.contentWindow.location.pathname !== url.pathname) return;
        observer?.disconnect();
        observer = new MutationObserver(check);
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
    equal(state.referenceTargetReady, "true");
    equal(state.referenceTargetMode, mode);
    equal(state.referenceTargetRequestedMode, mode);
    equal(state.referenceTargetSurface, String("referenceTarget" in page.realm.ShadowRoot.prototype));
    assert(page.document.getElementById("ready-status")?.textContent.includes("Ready"));
    assert(page.document.getElementById("mode-status")?.textContent.toLowerCase().includes(mode));
    return page;
  }

  function exactIDs(actual, expected, message) {
    equal([...actual].sort().join(","), [...expected].sort().join(","), message);
  }

  function checkCapabilities(page, expected) {
    const sections = [...page.document.querySelectorAll("section[data-capability]")];
    exactIDs(sections.map(section => section.dataset.capability), expected, "The page renders exactly its selected capabilities");
    const active = page.document.documentElement.dataset.referenceTargetAdapters.split(",").filter(Boolean);
    exactIDs(active, expected, "Only the selected adapters are active");
    equal(page.document.querySelectorAll("iframe").length, 0, "The gallery renders its own examples without embedding other pages");
  }

  function shadowRoot(page, id) {
    const host = page.document.getElementById(id);
    assert(host?.shadowRoot, `Expected a parsed open shadow root on #${id}`);
    return host.shadowRoot;
  }

  async function manifest() {
    manifestPromise ??= fetch(new URL("bundle-sizes.json", galleryURL), { cache: "no-store" }).then(async response => {
      assert(response.ok, "The generated bundle manifest must be served");
      const data = await response.json();
      equal(data.version, 1);
      equal(data.unit, "KB");
      equal(data.bytesPerKB, 1000);
      return data;
    });
    return manifestPromise;
  }

  async function checkSizeReport(page, id, adapters) {
    const report = await manifest();
    const entry = report.pages.find(item => item.id === id);
    assert(entry, `Manifest must contain ${id}`);
    exactIDs(entry.adapters, adapters, "Manifest selections match the page");
    const panel = page.document.querySelector(`[data-bundle-id="${id}"]`);
    assert(panel, "The built page must include its generated size summary");
    equal(panel.querySelectorAll(".size-card[data-size-kind]").length, 3);
    for (const kind of ["baseline", "fallback", "total"]) {
      const card = panel.querySelector(`.size-card[data-size-kind="${kind}"]`);
      assert(card, `Missing ${kind} size card`);
      const bytes = Number(card.dataset.bytes);
      const gzipBytes = Number(card.dataset.gzipBytes);
      assert(Number.isInteger(bytes) && bytes > 0, `${kind} raw bytes must be positive`);
      assert(Number.isInteger(gzipBytes) && gzipBytes > 0, `${kind} gzip bytes must be positive`);
      equal(bytes, entry[kind].bytes, `${kind} displayed raw bytes match the manifest`);
      equal(gzipBytes, entry[kind].gzipBytes, `${kind} displayed gzip bytes match the manifest`);
      for (const size of ["bytes", "gzip"]) {
        const number = card.querySelector(`[data-size="${size}"]`);
        assert(number && /\d+(?:\.\d+)?\s*KB/.test(number.textContent), `${kind} needs a visible ${size} KB measurement`);
      }
    }
    equal(entry.total.bytes, entry.baseline.bytes + entry.fallback.bytes);
    equal(entry.total.gzipBytes, entry.baseline.gzipBytes + entry.fallback.gzipBytes);
    const rows = [...page.document.querySelectorAll(".files-table [data-file-path]")];
    exactIDs(rows.map(row => row.dataset.filePath), entry.files.map(file => file.path), "The displayed file list matches the manifest");
    for (const row of rows) {
      const file = entry.files.find(item => item.path === row.dataset.filePath);
      const link = row.querySelector("a[data-bundle-file]");
      assert(link, `Missing generated-file link for ${file.path}`);
      equal(link.dataset.bundleFile, file.path);
      equal(link.href, new URL(file.path, galleryURL).href, "File links must resolve to the generated artifacts");
      equal(row.dataset.delivery, file.delivery);
    }
    return entry;
  }

  async function individual(fixture, id) {
    const capability = capabilities.find(item => item.id === id);
    const page = await loadPage(fixture, capability.directory);
    checkCapabilities(page, [id]);
    await checkSizeReport(page, id, [id]);
    return page;
  }

  test("Built gallery: all six capabilities, boundaries, and generated bundle comparisons share one page", async ({ fixture }) => {
    requirePopovers();
    requireDialogs();
    requireForms();
    const page = await loadPage(fixture);
    checkCapabilities(page, capabilities.map(item => item.id));
    assert(page.document.querySelector("aside#boundaries"), "The all-capabilities page includes the boundaries comparison");
    await checkSizeReport(page, "all", capabilities.map(item => item.id));
    const rows = [...page.document.querySelectorAll(".size-table [data-capability-size]")];
    exactIDs(rows.map(row => row.dataset.capabilitySize), capabilities.map(item => item.id));
    for (const capability of capabilities) {
      const row = rows.find(item => item.dataset.capabilitySize === capability.id);
      const link = row.querySelector("a[href]");
      assert(link, `Comparison must link to ${capability.id}`);
      equal(new URL(link.href).pathname, new URL(`${capability.directory}/`, galleryURL).pathname);
    }
    const report = await manifest();
    assert(report.pages.find(item => item.id === "all").fallback.bytes > report.pages.find(item => item.id === "labels").fallback.bytes,
      "The labels-only fallback must be smaller than the all-adapter fallback");
  });

  test("Built gallery: separate syntax highlighting colors plain-text samples without touching live observations", async ({ fixture }) => {
    requirePopovers();
    requireDialogs();
    requireForms();
    const page = await loadPage(fixture);
    requirePrimitive(page.realm.CSS?.highlights && typeof page.realm.Highlight === "function", "CSS Highlight API unavailable");
    const state = page.document.documentElement.dataset;
    await waitFor(page.document, () => ["ready", "unsupported", "unavailable"].includes(state.codeHighlighting), "Code highlighting did not finish initialization");
    equal(state.codeHighlighting, "ready");
    equal(state.referenceTargetReady, "true");
    checkCapabilities(page, capabilities.map(item => item.id));

    const response = await fetch(page.realm.location.href, { cache: "no-store" });
    assert(response.ok, "The built HTML is available for a plain-text comparison");
    const original = new page.realm.DOMParser().parseFromString(await response.text(), "text/html");
    const selector = "pre > code[data-code-sample]";
    const samples = [...page.document.querySelectorAll(selector)];
    const originalSamples = [...original.querySelectorAll(selector)];
    equal(samples.length, originalSamples.length);
    assert(samples.length > 0);
    samples.forEach((sample, index) => {
      equal(sample.textContent, originalSamples[index].textContent, "Highlighting preserves the authored sample text");
      equal(sample.childElementCount, 0, "CSS highlighting must not insert token element wrappers");
    });

    function ranges() {
      return [...page.realm.CSS.highlights.values()].flatMap(highlight => [...highlight]);
    }
    function intersects(range, node) {
      const copy = page.document.createRange();
      copy.setStart(range.startContainer, range.startOffset);
      copy.setEnd(range.endContainer, range.endOffset);
      return !copy.collapsed && copy.intersectsNode(node);
    }
    const highlightedRanges = ranges();
    assert(highlightedRanges.length > 0, "Microlighter must register actual CSS highlight ranges");
    for (const language of ["html", "javascript"]) {
      const matching = samples.filter(sample => sample.classList.contains(`language-${language}`));
      assert(matching.length > 0, `The gallery includes a ${language} sample`);
      assert(matching.some(sample => highlightedRanges.some(range => intersects(range, sample))), `${language} sample text must intersect a registered highlight`);
    }

    const live = page.document.getElementById("submission-output");
    assert(live?.localName === "pre");
    equal(live.textContent, original.getElementById("submission-output").textContent);
    equal(live.childElementCount, 0);
    assert(!live.matches("[data-code-sample]"));
    assert(!highlightedRanges.some(range => intersects(range, live)), "Live observation text is outside the highlighted samples");
    const root = shadowRoot(page, "profile-form");
    const save = page.document.getElementById("save-draft");
    assert(!save.disabled, "The application remains usable after highlighting");
    root.getElementById("display-name").value = "Highlight check";
    save.click();
    await waitFor(page.document, () => page.document.getElementById("form-status").textContent.includes("Draft captured"), "Live form observation stopped updating after highlighting");
    const submission = JSON.parse(live.textContent);
    equal(Object.fromEntries(submission.entries).displayName, "Highlight check");
    equal(submission.submitter.value, "draft");
    equal(live.childElementCount, 0, "Updated observation JSON stays plain text");
    assert(!ranges().some(range => intersects(range, live)));
    equal(state.referenceTargetReady, "true");

    assert([...page.document.scripts].some(script => new URL(script.src || page.realm.location.href).pathname.endsWith("/shared/code-highlighting.js")), "Highlighting loads as a separate demo asset");
    const entry = (await manifest()).pages.find(item => item.id === "all");
    assert(entry.files.every(file => !/code-highlighting|microlighter/i.test(file.path)), "The highlighting assets must stay outside the measured application and fallback bundles");
  });

  test("Built labels page: only its adapter loads and an external label activates once", async ({ fixture }) => {
    const page = await individual(fixture, "labels");
    const root = shadowRoot(page, "lj-checkbox-host");
    const control = root.getElementById("control");
    const label = page.document.getElementById("lj-checkbox-label");
    assert(control && label && !control.disabled);
    equal(root.referenceTarget, "control");
    let clicks = 0;
    control.addEventListener("click", () => clicks++);
    const initial = control.checked;
    label.click();
    equal(control.checked, !initial);
    equal(clicks, 1);
    label.click();
    equal(control.checked, initial);
    equal(clicks, 2);
  });

  test("Built popover-targets page: attribute actions open and hide the selected internal panel", async ({ fixture }) => {
    requirePopovers();
    const page = await individual(fixture, "popover-targets");
    const panel = shadowRoot(page, "pt-host").getElementById("pt-panel");
    const show = page.document.getElementById("pt-show");
    const hide = page.document.getElementById("pt-hide");
    assert(panel && show && hide && !show.disabled && !hide.disabled);
    assert(!panel.matches(":popover-open"));
    show.click();
    assert(panel.matches(":popover-open"));
    await waitFor(page.document, () => page.document.getElementById("pt-observation").textContent.includes("panel: open"), "Popover readout did not report opening");
    hide.click();
    assert(!panel.matches(":popover-open"));
  });

  test("Built popover-commands page: commands toggle the panel and honor cancellation", async ({ fixture }) => {
    requirePopovers();
    const page = await individual(fixture, "popover-commands");
    const panel = shadowRoot(page, "pc-host").getElementById("pc-panel");
    const show = page.document.getElementById("pc-show");
    const hide = page.document.getElementById("pc-hide");
    const cancellation = page.document.getElementById("pc-cancel");
    assert(panel && show && hide && cancellation && !show.disabled);
    cancellation.checked = true;
    show.click();
    assert(!panel.matches(":popover-open"));
    await waitFor(page.document, () => page.document.getElementById("pc-observation").textContent.includes("canceled commands: 1"), "Command cancellation was not observed");
    show.click();
    assert(panel.matches(":popover-open"));
    hide.click();
    assert(!panel.matches(":popover-open"));
  });

  test("Built dialog-commands page: a public command opens its closed-root dialog and updates the readout", async ({ fixture }) => {
    requireDialogs();
    const page = await individual(fixture, "dialog-commands");
    const host = page.document.getElementById("dc-host");
    const show = page.document.getElementById("dc-show");
    const output = page.document.getElementById("dc-observation");
    assert(host && show && output && !show.disabled);
    equal(host.shadowRoot, null);
    assert(output.textContent.includes("dialog: closed"));
    show.click();
    await waitFor(page.document, () => /dialog: (modal|open)\b/.test(output.textContent), "Dialog readout did not report the opened dialog");
    assert(output.textContent.includes("commands: 1"));
    assert(output.textContent.includes("root: closed"));
    // Removing the iframe at fixture cleanup also removes this modal. The test
    // never reaches into the component's private shadow root to close it.
  });

  test("Built text-names page: explicit label and description proxies track component updates", async ({ fixture }) => {
    const page = await individual(fixture, "text-names");
    const input = page.document.getElementById("tn-input");
    const labelHost = page.document.getElementById("tn-label-host");
    const descriptionHost = page.document.getElementById("tn-description-host");
    const update = page.document.getElementById("tn-update");
    assert(input && labelHost && descriptionHost && update && !input.disabled && !update.disabled);
    function proxy(attribute) {
      const id = input.getAttribute(attribute);
      const result = page.document.getElementById(id);
      assert(result?.hasAttribute("data-reference-target-text"), `${attribute} must name a text proxy`);
      assert(result.hidden);
      return result;
    }
    equal(proxy("aria-labelledby").textContent, "Delivery preference");
    equal(proxy("aria-describedby").textContent, "Tell us where the parcel should be left.");
    update.click();
    await waitFor(page.document, () =>
      proxy("aria-labelledby").textContent === labelHost.dataset.labelText &&
      proxy("aria-describedby").textContent === descriptionHost.dataset.descriptionText,
    "The name and description proxies did not follow the component's published text");
    equal(proxy("aria-labelledby").textContent, "Collection preference");
    equal(proxy("aria-describedby").textContent, "Tell us when you would like to collect the parcel.");
    // Proxy DOM state is an integration check, not an accessibility-tree or
    // assistive-technology assertion.
  });

  test("Built forms page: Save draft captures native form data and Reset restores defaults", async ({ fixture }) => {
    requireForms();
    const page = await individual(fixture, "form-targets");
    const root = shadowRoot(page, "profile-form");
    const name = root.getElementById("display-name");
    const email = root.getElementById("email");
    const digest = root.getElementById("digest");
    const updates = root.getElementById("updates");
    const save = page.document.getElementById("save-draft");
    const reset = page.document.getElementById("reset-profile");
    requirePrimitive(!save.disabled && !reset.disabled, "The browser lacks the form primitives used by this demo");
    name.value = "Gallery tester";
    email.value = "";
    digest.value = "monthly";
    updates.checked = false;
    save.click();
    await waitFor(page.document, () => page.document.getElementById("form-status").textContent.includes("Draft captured"), "Draft submission was not captured");
    const submission = JSON.parse(page.document.getElementById("submission-output").textContent);
    const entries = Object.fromEntries(submission.entries);
    equal(entries.displayName, "Gallery tester");
    equal(entries.email, "");
    equal(entries.digest, "monthly");
    equal(entries.intent, "draft");
    equal(entries.updates, undefined);
    equal(submission.submitter.formNoValidate, true);
    equal(submission.submitter.fallbackProxy, true);
    equal(root.querySelectorAll("[data-reference-target-submitter]").length, 0, "Temporary submitters must be removed after dispatch");
    reset.click();
    await waitFor(page.document, () => page.document.getElementById("reset-output").textContent.includes("Observed after reset"), "The demo did not observe native reset");
    equal(name.value, "Alex Morgan");
    equal(email.value, "");
    equal(digest.value, "weekly");
    equal(updates.checked, true);
  });

  test("Built gallery: off mode initializes all examples without installing the fallback", async ({ fixture }) => {
    const page = await loadPage(fixture, "", "off");
    equal(page.document.documentElement.dataset.referenceTargetAdapters, "");
    equal(page.document.documentElement.dataset.bundlePath, "baseline");
    equal(page.document.querySelectorAll("section[data-capability]").length, 6);
    equal(page.document.querySelectorAll("[data-reference-target-text]").length, 0);
    assert(/\[native code\]/.test(page.realm.Function.prototype.toString.call(page.realm.Element.prototype.attachShadow)));
    const labelRoot = shadowRoot(page, "lj-checkbox-host");
    equal(Object.getOwnPropertyDescriptor(labelRoot, "referenceTarget"), undefined);
    assert(!labelRoot.getElementById("control").disabled, "Application module initialization must complete in off mode too");
    equal(page.document.getElementById("tn-input").getAttribute("aria-labelledby"), "tn-label-host");
    equal(page.document.getElementById("tn-input").getAttribute("aria-describedby"), "tn-description-host");
  });
}
