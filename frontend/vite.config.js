import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.CACHE_API_ORIGIN || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/cache": { target, changeOrigin: true },
      "/cluster": { target, changeOrigin: true },
    },
  },
});
