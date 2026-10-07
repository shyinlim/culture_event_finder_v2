import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'production' ? '/static/' : '/',
  server: {
    // Listen on 0.0.0.0 so the host browser can access Vite inside the container.
    host: '0.0.0.0',
    port: 8790,
    // Fail immediately if the port is already in use.
    strictPort: true,
    // Keep Host header as localhost:8790 so Django matches ALLOWED_HOSTS.
    proxy: {
      '/api': { target: 'http://backend:8789' },
      '/healthz': { target: 'http://backend:8789' },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
}));
