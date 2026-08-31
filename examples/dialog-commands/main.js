import { bootstrap } from "../shared/bootstrap.js";

await bootstrap({
  loadFallback: () => import("./reference-target.setup.js"),
  loadApp: () => import("./app.js"),
});
