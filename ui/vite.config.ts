import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiTarget = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
