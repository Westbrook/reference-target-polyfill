import { createCompiler, loadConfig } from "@stencil/core/compiler";
import { createNodeLogger, createNodeSys } from "@stencil/core/sys/node";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildStencilExamples() {
  const logger = createNodeLogger(process);
  const sys = createNodeSys(process);
  const validated = await loadConfig({
    configPath: join(projectRoot, "examples/stencil/stencil.config.ts"),
    logger,
    sys,
  });
  logger.printDiagnostics(validated.diagnostics);
  if (validated.diagnostics.some(diagnostic => diagnostic.level === "error")) {
    throw new Error("Stencil example configuration failed");
  }

  const compiler = await createCompiler(validated.config);
  try {
    const results = await compiler.build();
    if (results.hasError) throw new Error("Stencil example compilation failed");
  } finally {
    await compiler.destroy();
  }
}
