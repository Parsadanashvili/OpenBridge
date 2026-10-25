import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "frontend",
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./frontend", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": process.env.OPENBRIDGE_API_URL || "http://127.0.0.1:4000",
      "/t/": process.env.OPENBRIDGE_API_URL || "http://127.0.0.1:4000",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./frontend/index.html", import.meta.url)),
        studio: fileURLToPath(
          new URL("./frontend/studio.html", import.meta.url),
        ),
      },
    },
  },
});
