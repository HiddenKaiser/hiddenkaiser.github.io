import { defineConfig } from "cf/config";

// sales.jackkeuler.com: a small Worker that serves the _sales/ folder of this repo (see src/index.js).
export default defineConfig({
  worker: {
    name: "sales-jackkeuler",
    entrypoint: "./src/index.js",
    compatibilityDate: "2026-11-01",
    domains: ["sales.jackkeuler.com"],
    workersDev: false,
  },
});
