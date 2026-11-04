import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// App de campo do InfraWork Web (cópia do Monito Mobile): PWA que grava direto no Supabase do InfraWork Web.
//
// HTTPS: em localhost o navegador já trata como contexto seguro (câmera, GPS, service worker). Para testar no celular
// pela rede local use CAMPO_HTTPS=1 — com `dev-cert.pem`/`dev-key.pem` do mkcert, se existirem, senão self-signed.
const CERT_PATH = path.resolve(__dirname, 'dev-cert.pem')
const KEY_PATH = path.resolve(__dirname, 'dev-key.pem')
const hasMkcert = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)
const https = process.env.CAMPO_HTTPS === '1'

export default defineConfig({
  plugins: [
    react(),
    ...(https && !hasMkcert ? [basicSsl()] : []),
    VitePWA({
      // autoUpdate: SW novo se auto-ativa (skipWaiting + clientsClaim no próprio SW).
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'service-worker.ts',
      // registro manual em main.tsx
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      // SW desligado em dev — HMR cobre e o SW só atrapalharia o debug local.
      devOptions: {
        enabled: false,
      },
      // Manifest estático em `public/manifest.webmanifest`.
      manifest: false,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // 5174 é o InfraWork Web; o app de campo fica na 5175.
    port: 5175,
    strictPort: true,
    host: true, // acesso de outros aparelhos na rede local
    ...(https && hasMkcert
      ? { https: { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) } }
      : {}),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
})
