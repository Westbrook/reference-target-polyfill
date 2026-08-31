import { bootstrap } from "../shared/bootstrap.js";

await bootstrap({
  cooperativeFallback: true,
  loadFallback: () => import("./reference-target.setup.js"),
  loadApp: () => import("./app.js"),
});
