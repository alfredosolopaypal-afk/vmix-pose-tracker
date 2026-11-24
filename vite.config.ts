import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig(({ command }) => ({
  // Rutas relativas: funciona igual en la raíz (Netlify) y en subcarpetas (GitHub Pages /repo/).
  base: './',
  // Certificado autofirmado SOLO en desarrollo, para poder probar la cámara desde el móvil en la LAN.
  plugins: command === 'serve' ? [basicSsl()] : [],
  // Worker clásico (IIFE): máxima compatibilidad (Safari/iOS) y permite importScripts para el WASM.
  worker: { format: 'iife' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { main: page('index.html'), receiver: page('receiver.html') },
    },
  },
  server: { host: true, port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
