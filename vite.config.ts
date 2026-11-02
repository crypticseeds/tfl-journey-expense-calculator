/// <reference types="vitest/config" />
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      strictPort: true,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path, // Don't rewrite, forward as-is
        },
      },
    },
    test: {
      exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    },
    plugins: [react()],
    envPrefix: "VITE_",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
