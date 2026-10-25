import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// slskd listens on 5030 by default. In development, requests to /api and /hub
// are proxied there, so the browser never has to deal with CORS.
const SLSKD = process.env.SLSKD_URL ?? 'http://localhost:5030';

export default defineConfig(({ mode }) => ({
  // Relative paths, so the same build works at / (slskd) and under /ssk/ (luniceOS).
  base: './',
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  define: {
    __DEMO__: JSON.stringify(mode === 'demo'),
    // The version in package.json, which is also the release's: About shows it.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SLSKD, changeOrigin: true },
      '/hub': { target: SLSKD, changeOrigin: true, ws: true },
    },
  },
}));
