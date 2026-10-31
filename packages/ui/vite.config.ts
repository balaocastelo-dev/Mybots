import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.MYBOTS_HUB_HTTP ?? "http://127.0.0.1:8790";
const base = process.env.MYBOTS_UI_BASE ?? "/mybots/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": hub,
      "/mybots/api": { target: hub, rewrite: (p) => p.replace(/^\/mybots/, "") },
      "/ws": { target: hub.replace(/^http/, "ws"), ws: true },
      "/mybots/ws": { target: hub.replace(/^http/, "ws"), ws: true, rewrite: (p) => p.replace(/^\/mybots/, "") },
      "/pc": hub,
      "/android": hub,
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
