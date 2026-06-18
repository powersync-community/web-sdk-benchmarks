import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// https://vite.dev/config/
export default defineConfig({
  build: {
    // The wa-sqlite / PowerSync stack relies on top-level await, WASM, OPFS and
    // ES module workers — all modern-browser-only. vite-plugin-top-level-await
    // emits TLA + destructuring that esbuild cannot downcompile to Vite's default
    // es2020 target ("Transforming destructuring ... is not supported yet"), so we
    // target esnext to skip that downlevel pass.
    target: "esnext",
  },
  optimizeDeps: {
    // Don't optimize these packages as they contain web workers and WASM files.
    // https://github.com/vitejs/vite/issues/11672#issuecomment-1415820673
    exclude: ["@journeyapps/wa-sqlite", "@powersync/web"],
    include: [],
  },
  plugins: [wasm(), react(), topLevelAwait()],
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
});
