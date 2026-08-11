import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Both packages read the single .env at the repo root.
  envDir: path.resolve(__dirname, '..'),
  server: {
    port: 5173,
    // Front loads the plugin in an iframe, so the dev server must accept it.
    cors: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
