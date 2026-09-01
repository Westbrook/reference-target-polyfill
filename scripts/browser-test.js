import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import process from "node:process";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browserName = readOption("browser") ?? "chromium";
const timeoutMs = Number(readOption("timeout") ?? 180000);

if (!["chromium", "firefox"].includes(browserName)) {
  throw new Error(`Unsupported browser ${browserName}; expected chromium or firefox`);
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
  throw new Error("--timeout must be at least 1000 milliseconds");
}

function readOption(name) {
  const prefix = `--${name}=`;
  const direct = process.argv.find(argument => argument.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function executable(candidates) {
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const candidate of candidates.filter(Boolean)) {
    const paths = candidate.includes("/") ? [candidate] : directories.map(directory => join(directory, candidate));
    for (const pathname of paths) {
      try {
        await access(pathname, constants.X_OK);
        return pathname;
      } catch {}
    }
  }
  return null;
}

async function browserExecutable() {
  if (browserName === "chromium") {
    return executable([
      process.env.BROWSER_EXECUTABLE,
      process.env.CHROME_BIN,
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  }
  return executable([
    process.env.BROWSER_EXECUTABLE,
    process.env.FIREFOX_BIN,
    "firefox",
    "/Applications/Firefox.app/Contents/MacOS/firefox",
  ]);
}

function outputBuffer(child) {
  let output = "";
  const append = chunk => {
    output += chunk;
    if (output.length > 50000) output = output.slice(-50000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => output;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let forceTimer;
  try {
    await Promise.race([
      once(child, "exit"),
      new Promise(resolveDelay => {
        forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          resolveDelay();
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(forceTimer);
  }
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(url, child, output) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early (${child.exitCode})\n${output()}`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Test server did not become ready within 30 seconds\n${output()}`);
}

function resultServer(token) {
  let settle;
  const result = new Promise((resolveResult, rejectResult) => { settle = { resolveResult, rejectResult }; });
  let received = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    const requestURL = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "POST" || requestURL.pathname !== "/result" || requestURL.searchParams.get("token") !== token) {
      response.writeHead(404).end("Not found");
      return;
    }
    if (received) {
      response.writeHead(409).end("Result already received");
      return;
    }
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 10_000_000) throw new Error("Browser-test result exceeded 10 MB");
        chunks.push(chunk);
      }
      const summary = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      received = true;
      response.writeHead(204).end();
      settle.resolveResult(summary);
    } catch (error) {
      response.writeHead(400).end("Invalid result");
      settle.rejectResult(error);
    }
  });
  return { server, result };
}

function browserArguments(profile, url) {
  if (browserName === "chromium") {
    return [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      `--user-data-dir=${profile}`,
      url,
    ];
  }
  return ["--headless", "--no-remote", "--profile", profile, url];
}

function expectedSkip(summary, result) {
  if (result.skipCode !== "missing-primitive") return false;
  const capabilities = summary.environment?.capabilities ?? {};
  const reason = result.skipReason ?? "";
  const expectations = [
    [/native Reference Target surface/i, () => !summary.environment?.nativeReferenceTarget],
    [/Declarative shadow DOM unavailable/i, () => !capabilities.declarativeShadowDOM],
    [/Dialog and popover primitives unavailable/i, () => !capabilities.dialog || !capabilities.popover],
    [/Dialog primitives unavailable/i, () => !capabilities.dialog],
    [/requestClose primitive unavailable/i, () => !capabilities.requestClose],
    [/Popover (?:element )?reflection unavailable/i,
      () => !capabilities.popover || !capabilities.popoverElementReflection],
    [/Popover primitives unavailable/i, () => !capabilities.popover],
    [/requestSubmit primitive unavailable/i, () => !capabilities.forms],
    [/browser lacks the form primitives/i, () => !capabilities.forms],
    [/requestSubmit cannot be wrapped/i, () => !capabilities.configurableRequestSubmit],
    [/ARIA element reflection unavailable/i, () => !capabilities.ariaElementReflection],
    [/CSS Highlight API unavailable/i, () => !capabilities.cssHighlights],
  ];
  const expectation = expectations.find(([pattern]) => pattern.test(reason));
  return !!expectation?.[1]();
}

function quantile(values, percentile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)];
}

function validate(summary, wallTimeMs) {
  if (!summary || typeof summary !== "object") throw new Error("Browser returned no structured test summary");
  if (summary.harnessError) throw new Error(`Browser harness failed:\n${summary.harnessError}`);
  const failed = summary.results?.filter(result => result.outcome === "fail") ?? [];
  const skipped = summary.results?.filter(result => result.outcome === "skip") ?? [];
  const unexpectedSkips = skipped.filter(result => !expectedSkip(summary, result));
  if (failed.length || unexpectedSkips.length || summary.failed) {
    const details = [
      ...failed.map(result => `FAIL: ${result.name}\n${result.error ?? ""}`),
      ...unexpectedSkips.map(result => `UNEXPECTED SKIP: ${result.name}\n${result.skipReason ?? result.error ?? ""}`),
    ];
    throw new Error(details.join("\n\n") || `${summary.failed} browser tests failed`);
  }
  const durations = summary.results?.map(result => result.durationMs).filter(Number.isFinite) ?? [];
  const metrics = {
    browser: browserName,
    passed: summary.passed,
    skipped: summary.skipped,
    total: summary.total,
    suiteDurationMs: Math.round(summary.durationMs),
    wallTimeMs: Math.round(wallTimeMs),
    medianTestMs: Math.round(quantile(durations, 0.5)),
    p95TestMs: Math.round(quantile(durations, 0.95)),
    maxTestMs: Math.round(Math.max(0, ...durations)),
  };
  // This is deliberately generous: it catches hangs and order-of-magnitude
  // regressions while per-operation work-count tests provide the precise gates.
  if (summary.durationMs > 150000 || metrics.p95TestMs > 18000) {
    throw new Error(`Browser performance smoke budget exceeded: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

let serverProcess;
let browserProcess;
let reportServer;
let profile;
let timeoutTimer;

try {
  const executablePath = await browserExecutable();
  if (!executablePath) throw new Error(`Could not find an installed ${browserName} executable`);
  const applicationPort = await availablePort();
  const token = randomUUID();
  const receiver = resultServer(token);
  reportServer = receiver.server;
  reportServer.listen(0, "127.0.0.1");
  await once(reportServer, "listening");
  const reportPort = reportServer.address().port;

  serverProcess = spawn(process.execPath, ["scripts/serve.js"], {
    cwd: projectRoot,
    env: { ...process.env, RT_PORT: String(applicationPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverOutput = outputBuffer(serverProcess);
  const baseURL = `http://127.0.0.1:${applicationPort}`;
  await waitForServer(`${baseURL}/tests/browser.html`, serverProcess, serverOutput);

  profile = await mkdtemp(join(tmpdir(), `reference-target-${browserName}-`));
  const pageURL = new URL(`${baseURL}/tests/browser.html`);
  pageURL.searchParams.set("report", `http://127.0.0.1:${reportPort}/result?token=${token}`);
  const launchedAt = Date.now();
  browserProcess = spawn(executablePath, browserArguments(profile, pageURL.href), {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const browserOutput = outputBuffer(browserProcess);
  const earlyExit = once(browserProcess, "exit").then(([code, signal]) => {
    throw new Error(`${browserName} exited before reporting results (${code ?? signal})\n${browserOutput()}`);
  });
  const timeout = new Promise((_, rejectTimeout) => {
    timeoutTimer = setTimeout(() => rejectTimeout(new Error(`${browserName} browser tests exceeded ${timeoutMs} ms\n${browserOutput()}`)), timeoutMs);
  });
  const summary = await Promise.race([receiver.result, earlyExit, timeout]);
  clearTimeout(timeoutTimer);
  const metrics = validate(summary, Date.now() - launchedAt);
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  clearTimeout(timeoutTimer);
  await stopChild(browserProcess);
  await stopChild(serverProcess);
  reportServer?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
}
