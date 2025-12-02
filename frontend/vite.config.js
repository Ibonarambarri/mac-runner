import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['macbook-pro-de-ibon.tail171eca.ts.net', 'mac-mini-de-ibon.tail171eca.ts.net'],
    proxy: {
      // Proxy API requests to backend during development
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      // Proxy WebSocket requests
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  }
})
