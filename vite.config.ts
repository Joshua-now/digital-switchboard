import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/webhook': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

