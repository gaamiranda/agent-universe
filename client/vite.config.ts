import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../server/src/shared', import.meta.url)) },
  },
  server: {
    port: 4243,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4242', changeOrigin: true },
    },
  },
  build: { outDir: fileURLToPath(new URL('../server/public', import.meta.url)), emptyOutDir: true },
})
