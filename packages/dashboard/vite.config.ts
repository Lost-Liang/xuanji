import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // V4: 代理到璇玑 Core API（端口 3000）
      '/api': 'http://localhost:3000',
    }
  }
})
