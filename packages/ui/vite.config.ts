import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.MYBOTS_HUB_HTTP ?? "http://127.0.0.1:8790";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": hub,
      "/ws": { target: hub.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
