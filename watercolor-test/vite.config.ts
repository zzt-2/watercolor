import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
  worker: {
    format: "es", // 使用 ES 模块格式
  },
  optimizeDeps: {
    include: ["vue"], // 明确包含 Vue 依赖
    exclude: [""], // 防止某些依赖被过度优化导致 Worker 加载问题
  },
  publicDir: "public",
});
