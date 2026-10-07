import { defineConfig } from "tsup";

export default defineConfig([
  // The SDK, for import and require
  { entry: { index: "src/index.ts" }, format: ["esm", "cjs"], dts: true, target: "node18", clean: true, sourcemap: false },
  // The CLI, run by `npx breakreach`
  { entry: { cli: "src/cli.ts" }, format: ["esm"], target: "node18", banner: { js: "#!/usr/bin/env node" } },
]);
