import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// https://vite.dev/config/
export default defineConfig({
  // root: 'src',
  // build: {
  //   outDir: '../dist',
  //   rollupOptions: {
  //     input: 'src/index.html'
  //   },
  //   emptyOutDir: true
  // },
  // resolve: {
  //   alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }]
  // },
  // publicDir: '../public',
  // envDir: '..', // Use this dir for env vars, not 'src'.
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
