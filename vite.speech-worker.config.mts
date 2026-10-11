import { builtinModules } from "node:module";
import path from "path";
import { defineConfig } from "vite";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "src/ipc/services/speech_worker.ts"),
      name: "speech_worker",
      fileName: "speech_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        "kokoro-js",
        "@huggingface/transformers",
        "onnxruntime-node",
        "phonemizer",
      ],
    },
  },
});
