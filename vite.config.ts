import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Phones only grant camera access on secure origins, so the dev server runs
// on HTTPS (self-signed) and listens on the LAN.
export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'serve' && !process.env.NO_SSL ? [basicSsl()] : [])],
  server: { host: true },
  // allowedHosts lets the production preview be reached through a tunnel URL.
  preview: { host: true, allowedHosts: true },
  build: {
    chunkSizeWarningLimit: 4000, // MindAR bundles TensorFlow.js
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        compile: resolve(import.meta.dirname, 'compile.html'),
      },
    },
  },
}));
