import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 探针页与后续正式前端统一走同源 /api，由 Vite 转发到 server
      "/api": "http://localhost:3001",
    },
  },
});
