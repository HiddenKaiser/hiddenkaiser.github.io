import { defineConfig } from "cf/config";

// sales.jackkeuler.com: a small Worker that serves the _sales/ folder of this repo, plus the projects pages it
// shares with jackkeuler.com (see src/index.js).
export default defineConfig({
  worker: {
    name: "sales-jackkeuler",
    entrypoint: "./src/index.js",
    compatibilityDate: "2026-11-01",
    domains: ["sales.jackkeuler.com"],
    workersDev: false,
  },
});
