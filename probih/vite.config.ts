/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative base so the bundle works from the Capacitor WebView (file/https://localhost).
  base: './',
  plugins: [react(), tailwindcss()],
  // The bundle ships inside the APK (no network download), so a single ~550 kB chunk is fine.
  build: { chunkSizeWarningLimit: 800 },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
