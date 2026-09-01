import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const tsc = resolve(projectRoot, "node_modules/typescript/bin/tsc");

async function runNpm(args, options) {
  const npmCli = process.env.npm_execpath;
  return npmCli
    ? execFile(process.execPath, [npmCli, ...args], options)
    : execFile("npm", args, options);
}

async function write(pathname, contents) {
  await mkdir(dirname(pathname), { recursive: true });
  await writeFile(pathname, contents);
}

test("the packed package resolves runtime and strict TypeScript consumers", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "reference-target-consumer-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const cache = join(temporaryRoot, "npm-cache");
  const artifacts = join(temporaryRoot, "artifacts");
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(artifacts, { recursive: true });
  await mkdir(consumer, { recursive: true });
  const npmOptions = {
    cwd: projectRoot,
    env: { ...process.env, npm_config_cache: cache },
    maxBuffer: 10 * 1024 * 1024,
  };
  const packed = await runNpm([
    "pack", "--json", "--ignore-scripts", "--pack-destination", artifacts,
  ], npmOptions);
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(artifacts, filename);

  await write(join(consumer, "package.json"), `${JSON.stringify({
    name: "reference-target-packed-consumer",
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await runNpm([
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball,
  ], { ...npmOptions, cwd: consumer });

  const installedRoot = join(consumer, "node_modules/reference-target-fallback");
  const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.engines, undefined, "browser consumers must not inherit the contributor Node floor");
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    assert.equal(typeof conditions.types, "string", `${subpath} exposes declarations`);
    await access(join(installedRoot, conditions.types));
    if (subpath !== "./dom") {
      assert.equal(typeof conditions.default, "string", `${subpath} exposes runtime ESM`);
      await access(join(installedRoot, conditions.default));
    }
  }

  const runtimeCheck = join(consumer, "runtime-check.mjs");
  await write(runtimeCheck, `
    import assert from "node:assert/strict";
    const expected = new Map([
      ["reference-target-fallback/core", ["installReferenceTarget"]],
      ["reference-target-fallback/detect", ["hasNativeReferenceTarget", "probeReferenceTarget"]],
      ["reference-target-fallback/detect/surface", ["hasNativeReferenceTarget"]],
      ["reference-target-fallback/adapters/labels", ["labels"]],
      ["reference-target-fallback/adapters/popover-targets", ["popoverTargets"]],
      ["reference-target-fallback/adapters/dialog-commands", ["dialogCommands"]],
      ["reference-target-fallback/adapters/popover-commands", ["popoverCommands"]],
      ["reference-target-fallback/adapters/text-names", ["textNames"]],
      ["reference-target-fallback/adapters/form-targets", ["formTargets"]],
    ]);
    for (const [specifier, names] of expected) {
      const module = await import(specifier);
      assert.deepEqual(Object.keys(module).sort(), names.sort(), specifier);
    }
    const { hasNativeReferenceTarget, probeReferenceTarget } = await import("reference-target-fallback/detect");
    const throwingSurface = {
      get ShadowRoot() { throw new Error("modified realm"); },
    };
    assert.equal(hasNativeReferenceTarget(throwingSurface), false);
    assert.deepEqual(
      probeReferenceTarget(throwingSurface),
      { surface: false, nullable: false, labels: false },
    );
    class PartialShadowRoot {}
    Object.defineProperty(PartialShadowRoot.prototype, "referenceTarget", {
      configurable: true,
      get() { throw new Error("partial getter"); },
    });
    const probe = probeReferenceTarget({
      ShadowRoot: PartialShadowRoot,
      document: {
        documentElement: {},
        createElement() { throw new Error("partial DOM surface"); },
      },
    });
    assert.deepEqual(probe, { surface: true, nullable: false, labels: false });
    const throwingDocumentProbe = probeReferenceTarget({
      ShadowRoot: PartialShadowRoot,
      get document() { throw new Error("partial document"); },
    });
    assert.deepEqual(
      throwingDocumentProbe,
      { surface: true, nullable: false, labels: false },
    );
    for (const specifier of [
      "reference-target-fallback",
      "reference-target-fallback/internal/actions",
      "reference-target-fallback/src/internal/actions.js",
      "reference-target-fallback/dom",
    ]) {
      await assert.rejects(import(specifier), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    }
  `);
  await execFile(process.execPath, [runtimeCheck], { cwd: consumer });

  const bundleEntry = join(consumer, "bundle-entry.js");
  await write(bundleEntry, `
    import { installReferenceTarget } from "reference-target-fallback/core";
    import { labels } from "reference-target-fallback/adapters/labels";
    export function install(realm) {
      return installReferenceTarget({ realm, adapters: [labels({ activation: "focus" })] });
    }
  `);
  const bundled = await build({
    absWorkingDir: consumer,
    entryPoints: [bundleEntry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    metafile: true,
  });
  const bundledInputs = Object.keys(bundled.metafile.inputs);
  assert(bundledInputs.some((path) => path.endsWith("/src/core.js")));
  assert(bundledInputs.some((path) => path.endsWith("/src/adapters/labels.js")));
  assert(!bundledInputs.some((path) => path.includes("/src/adapters/text-names.js")));
  assert(!bundledInputs.some((path) => path.includes("/src/adapters/form-targets.js")));

  const unusedEntry = join(consumer, "unused-entry.js");
  await write(unusedEntry, `
    import { formTargets } from "reference-target-fallback/adapters/form-targets";
    export const consumerValue = 42;
  `);
  const unused = await build({
    absWorkingDir: consumer,
    entryPoints: [unusedEntry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    metafile: true,
  });
  const unusedPackageBytes = Object.values(unused.metafile.outputs)
    .flatMap((output) => Object.entries(output.inputs))
    .filter(([path]) => path.includes("reference-target-fallback/src/"))
    .reduce((total, [, input]) => total + input.bytesInOutput, 0);
  assert.equal(unusedPackageBytes, 0, "unused package imports contribute no emitted bytes");

  await write(join(consumer, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ["ES2022", "DOM", "DOM.Iterable"],
    },
    include: ["positive.ts", "expected-errors.ts"],
  }, null, 2)}\n`);
  await write(join(consumer, "positive.ts"), `
    import type {} from "reference-target-fallback/dom";
    import {
      installReferenceTarget,
      type ReferenceTargetAdapter,
      type ReferenceTargetDiagnostic,
      type ReferenceTargetHandle,
      type ReferenceTargetMode,
    } from "reference-target-fallback/core";
    import { hasNativeReferenceTarget, probeReferenceTarget } from "reference-target-fallback/detect";
    import { hasNativeReferenceTarget as hasNativeSurface } from "reference-target-fallback/detect/surface";
    import { labels } from "reference-target-fallback/adapters/labels";
    import { popoverTargets } from "reference-target-fallback/adapters/popover-targets";
    import { dialogCommands } from "reference-target-fallback/adapters/dialog-commands";
    import { popoverCommands } from "reference-target-fallback/adapters/popover-commands";
    import { textNames } from "reference-target-fallback/adapters/text-names";
    import { formTargets } from "reference-target-fallback/adapters/form-targets";

    const adapters: readonly ReferenceTargetAdapter[] = [
      labels({ activation: "focus-and-click", naming: true }),
      popoverTargets(), dialogCommands(), popoverCommands(),
      textNames({ getText(host, kind) {
        return host.getAttribute(kind === "label" ? "data-label" : "data-description");
      } }),
      formTargets(),
    ];
    const handle: ReferenceTargetHandle = installReferenceTarget({
      adapters,
      realm: window,
      force: false,
      onDiagnostic(entry: ReferenceTargetDiagnostic) {
        entry.code.toUpperCase();
        void entry.detail;
      },
    });
    const support: boolean = hasNativeReferenceTarget(window);
    const surface: boolean = hasNativeSurface(window);
    const probe = probeReferenceTarget(window);
    const modes: readonly ReferenceTargetMode[] = [
      "fallback", "native-unverified", "unsupported", "inactive", "disposed",
    ];
    const init: ShadowRootInit = { mode: "open", referenceTarget: "control" };
    declare const root: ShadowRoot;
    root.referenceTarget = null;
    handle.register(root, { referenceTarget: "control" }).dispose();
    handle.hydrate(document);
    handle.refresh();
    void [support, surface, probe.labels, init, modes, handle.mode, handle.statuses, handle.activeAdapters];
  `);
  await write(join(consumer, "expected-errors.ts"), `
    import type {} from "reference-target-fallback/dom";
    import { installReferenceTarget, type ReferenceTargetMode } from "reference-target-fallback/core";
    import { labels } from "reference-target-fallback/adapters/labels";
    import { textNames } from "reference-target-fallback/adapters/text-names";
    // @ts-expect-error activation policy is a closed union
    labels({ activation: "click" });
    // @ts-expect-error naming is boolean
    labels({ activation: "focus", naming: "yes" });
    // @ts-expect-error providers return plain text or null
    textNames({ getText: () => 42 });
    // @ts-expect-error force is boolean
    installReferenceTarget({ force: "false" });
    // @ts-expect-error arbitrary objects are not privileged built-in adapters
    installReferenceTarget({ adapters: [{ id: "custom", install() {} }] });
    // @ts-expect-error native capability is deliberately reported as unverified
    const oldNativeMode: ReferenceTargetMode = "native";
    void oldNativeMode;
    declare const root: ShadowRoot;
    // @ts-expect-error referenceTarget is nullable text
    root.referenceTarget = 42;
  `);
  await execFile(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: consumer });

  await write(join(consumer, "negative.ts"), `
    import { labels } from "reference-target-fallback/adapters/labels";
    labels({ activation: "invalid" });
  `);
  await assert.rejects(
    execFile(process.execPath, [
      tsc, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
      "--moduleResolution", "NodeNext", "--lib", "ES2022,DOM,DOM.Iterable",
      "--ignoreConfig", "negative.ts",
    ], { cwd: consumer }),
    (error) => {
      assert.match(`${error.stdout}\n${error.stderr}`, /activation|focus-and-click/);
      return true;
    },
  );
});
